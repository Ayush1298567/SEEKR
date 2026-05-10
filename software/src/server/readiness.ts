import type { MissionPlan, ReadinessCheck, ReadinessReport } from "../shared/types";
import { MavlinkAdapter } from "./adapters/mavlinkAdapter";
import { Ros2SlamAdapter } from "./adapters/ros2SlamAdapter";
import { readStrictAiSmokeEvidence } from "./ai/localAiEvidence";
import { localLlamaStatus } from "./ai/llamaProvider";
import { buildRuntimeConfig } from "./config";
import { hashValue } from "./domain/ids";
import { buildIncidentLog } from "./domain/incidentLog";
import { readFixture } from "./fixtures";
import type { MissionPersistence } from "./persistence";
import { buildMissionReportData } from "./report";
import { buildSourceHealthReport } from "./sourceHealth";
import type { MissionStore } from "./state";

const REQUIRED_FIXTURES: Array<{ kind: Parameters<typeof readFixture>[0]; name: string }> = [
  { kind: "mavlink", name: "heartbeat" },
  { kind: "ros2-map", name: "occupancy-grid" },
  { kind: "detection", name: "valid-person" },
  { kind: "spatial", name: "rubble-gaussian-splat" },
  { kind: "import", name: "rosbag-lite" },
  { kind: "import", name: "spatial-manifest" },
  { kind: "import", name: "mission-events-replay-parity" }
];

export async function buildReadinessReport(
  store: MissionStore,
  persistence: MissionPersistence,
  generatedAt = Date.now()
): Promise<ReadinessReport> {
  const state = store.snapshot();
  const events = store.allEvents();
  const verify = store.validateHashChain();
  const replays = persistence.replays.list();
  const aiStatus = await localLlamaStatus();
  const strictAiSmoke = await readStrictAiSmokeEvidence(generatedAt);
  const sourceHealth = buildSourceHealthReport(state, events, generatedAt);
  const runtimeConfig = buildRuntimeConfig(store, persistence, generatedAt);
  const checks: ReadinessCheck[] = [];

  checks.push(
    check(
      "hash-chain",
      "Hash-chain verification",
      verify.ok ? "pass" : "fail",
      verify.ok
        ? `${events.length} mission events verify from genesis to current state.`
        : verify.errors.join("; "),
      true
    )
  );

  checks.push(
    check(
      "persisted-replay",
      "Persisted replay availability",
      replays.length ? "pass" : "warn",
      replays.length
        ? `${replays.length} persisted replay manifest${replays.length === 1 ? "" : "s"} available.`
        : "No replay manifest exists yet; export one mission package before demo replay proof.",
      false
    )
  );

  checks.push(reportExportCheck(state, events, verify, generatedAt));
  checks.push(incidentLogCheck(state, events, verify, generatedAt));
  checks.push(await fixtureAvailabilityCheck());
  checks.push(sourceHealthCheck(sourceHealth));
  checks.push(runtimeConfigCheck(runtimeConfig));

  checks.push(
    check(
      "local-ai",
      "Local AI status",
      aiStatus.ok ? "pass" : "warn",
      aiStatus.ok
        ? `${aiStatus.provider} ${aiStatus.model} is available.`
        : `${aiStatus.provider} ${aiStatus.model} is not active${aiStatus.reason ? `: ${aiStatus.reason}` : "."}`,
      false
    )
  );
  checks.push(strictAiSmokeCheck(strictAiSmoke));

  checks.push(await safetyBoundaryCheck());

  const blockingFailures = checks.filter((candidate) => candidate.blocking && candidate.status === "fail");
  checks.push(
    check(
      "open-blockers",
      "Current open blockers",
      blockingFailures.length ? "fail" : "pass",
      blockingFailures.length
        ? blockingFailures.map((candidate) => candidate.label).join("; ")
        : "No blocking readiness failures are open.",
      false
    )
  );

  const summary = {
    pass: checks.filter((candidate) => candidate.status === "pass").length,
    warn: checks.filter((candidate) => candidate.status === "warn").length,
    fail: checks.filter((candidate) => candidate.status === "fail").length,
    blocking: checks.filter((candidate) => candidate.blocking && candidate.status === "fail").length,
    eventCount: events.length,
    replayCount: replays.length,
    finalStateHash: hashValue(state),
    ai: {
      ok: aiStatus.ok,
      provider: aiStatus.provider,
      model: aiStatus.model,
      reason: aiStatus.reason
    },
    sourceHealth: {
      ok: sourceHealth.ok,
      pass: sourceHealth.summary.pass,
      warn: sourceHealth.summary.warn,
      fail: sourceHealth.summary.fail,
      sourceCount: sourceHealth.summary.sourceCount,
      staleSourceIds: sourceHealth.summary.staleSourceIds
    },
    configWarnings: runtimeConfig.warnings,
    blockers: blockingFailures.map((candidate) => candidate.label)
  };

  return {
    ok: summary.blocking === 0,
    generatedAt,
    missionId: state.missionId,
    stateSeq: state.stateSeq,
    checks,
    summary
  };
}

function strictAiSmokeCheck(strictAiSmoke: Awaited<ReturnType<typeof readStrictAiSmokeEvidence>>): ReadinessCheck {
  return check(
    "local-ai-strict-smoke",
    "Strict local AI smoke",
    strictAiSmoke.ok ? "pass" : "warn",
    strictAiSmoke.ok && strictAiSmoke.status
      ? `${strictAiSmoke.status.caseCount} strict Ollama AI smoke cases passed with ${strictAiSmoke.status.model}.`
      : strictAiSmoke.reason ?? "Strict local AI smoke status is unavailable.",
    false
  );
}

function sourceHealthCheck(sourceHealth: ReturnType<typeof buildSourceHealthReport>): ReadinessCheck {
  if (sourceHealth.summary.fail) {
    return check(
      "source-health",
      "Source health",
      "fail",
      `${sourceHealth.summary.fail} source health failure${sourceHealth.summary.fail === 1 ? "" : "s"} detected: ${sourceHealth.summary.staleSourceIds.join(", ")}.`,
      true
    );
  }

  return check(
    "source-health",
    "Source health",
    sourceHealth.summary.staleSourceIds.length ? "warn" : "pass",
    sourceHealth.summary.staleSourceIds.length
      ? `Nonblocking source warning for ${sourceHealth.summary.staleSourceIds.join(", ")}. Check /api/source-health for event sequence and freshness details.`
      : `${sourceHealth.summary.sourceCount} configured or observed source${sourceHealth.summary.sourceCount === 1 ? "" : "s"} are current.`,
    false
  );
}

function runtimeConfigCheck(runtimeConfig: ReturnType<typeof buildRuntimeConfig>): ReadinessCheck {
  return check(
    "runtime-config",
    "Runtime config",
    runtimeConfig.warnings.length ? "warn" : "pass",
    runtimeConfig.warnings.length
      ? runtimeConfig.warnings.join(" ")
      : "Operator-visible runtime config is valid and secrets are redacted.",
    false
  );
}

function reportExportCheck(
  state: Parameters<typeof buildMissionReportData>[0],
  events: Parameters<typeof buildMissionReportData>[1],
  verify: Parameters<typeof buildMissionReportData>[2],
  generatedAt: number
): ReadinessCheck {
  try {
    const report = buildMissionReportData(state, events, verify, generatedAt);
    return check(
      "report-export",
      "Report export readiness",
      "pass",
      `Mission report data builds with ${report.timeline.length} timeline entries and final hash ${report.finalStateHash.slice(0, 12)}.`,
      true
    );
  } catch (error) {
    return check("report-export", "Report export readiness", "fail", formatError(error), true);
  }
}

function incidentLogCheck(
  state: Parameters<typeof buildIncidentLog>[0],
  events: Parameters<typeof buildIncidentLog>[1],
  verify: Parameters<typeof buildIncidentLog>[2],
  generatedAt: number
): ReadinessCheck {
  try {
    const log = buildIncidentLog(state, events, verify, generatedAt);
    return check(
      "incident-log",
      "Incident log readiness",
      "pass",
      `Read-only incident log builds with ${log.timeline.length} timeline entries and ${log.counts.evidenceAssets} evidence assets.`,
      true
    );
  } catch (error) {
    return check("incident-log", "Incident log readiness", "fail", formatError(error), true);
  }
}

async function fixtureAvailabilityCheck(): Promise<ReadinessCheck> {
  const missing: string[] = [];
  await Promise.all(
    REQUIRED_FIXTURES.map(async (fixture) => {
      try {
        await readFixture(fixture.kind, fixture.name);
      } catch {
        missing.push(`${fixture.kind}/${fixture.name}`);
      }
    })
  );

  return check(
    "fixture-ingest",
    "Fixture ingest availability",
    missing.length ? "fail" : "pass",
    missing.length
      ? `Missing or malformed fixture files: ${missing.join(", ")}.`
      : `${REQUIRED_FIXTURES.length} MAVLink, ROS 2, detection, spatial, and import fixtures are readable.`,
    true
  );
}

async function safetyBoundaryCheck(): Promise<ReadinessCheck> {
  const plan: MissionPlan = {
    kind: "hold-drone",
    droneId: "readiness-probe",
    reason: "Readiness safety-boundary probe"
  };
  const adapters = [new MavlinkAdapter(), new Ros2SlamAdapter()];
  const results = await Promise.all(
    adapters.flatMap((adapter) => [
      adapter.uploadMission(plan),
      adapter.hold("readiness-probe"),
      adapter.returnHome("readiness-probe")
    ])
  );
  const accepted = results.filter((result) => result.accepted);

  return check(
    "safety-boundary",
    "Safety boundary",
    accepted.length ? "fail" : "pass",
    accepted.length
      ? `${accepted.length} adapter command probe${accepted.length === 1 ? "" : "s"} unexpectedly accepted.`
      : "Real MAVLink, ROS 2, hold, RTH, and mission upload probes remain blocked.",
    true
  );
}

function check(id: string, label: string, status: ReadinessCheck["status"], details: string, blocking: boolean): ReadinessCheck {
  return { id, label, status, details, blocking };
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
