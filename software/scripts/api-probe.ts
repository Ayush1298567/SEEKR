import express from "express";
import http from "node:http";
import { AddressInfo } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeIsoTimestampForFileName } from "./artifact-paths";
import { jsonBodyErrorHandler } from "../src/server/api/errors";
import { createApiRouter } from "../src/server/api/routes";
import { MissionPersistence } from "../src/server/persistence";
import { MissionStore } from "../src/server/state";

export interface ApiProbeManifest {
  schemaVersion: 1;
  generatedAt: string;
  ok: true;
  commandUploadEnabled: false;
  checked: string[];
  sessionAcceptance: {
    status: string;
    commandUploadEnabled: boolean;
    releaseChecksum?: {
      overallSha256: string;
      fileCount: number;
      totalBytes: number;
    };
    commandBoundaryScan?: {
      status: "pass";
      scannedFileCount: number;
      violationCount: 0;
      allowedFindingCount: number;
    };
  };
  readiness: {
    ok: boolean;
    blocking: number;
  };
  hardwareReadiness: {
    ok: boolean;
    commandUploadEnabled: boolean;
    blocking: number;
  };
  sourceHealth: {
    expectedSourceCount: number;
    staleThresholdMs: number;
    staleSourceIds: string[];
  };
  verify: {
    ok: boolean;
    errorCount: number;
  };
  replays: {
    count: number;
  };
  malformedJson: {
    status: number;
    code?: string;
  };
  validation: {
    ok: true;
    warnings: string[];
    blockers: string[];
  };
  limitations: string[];
}

const DEFAULT_OUT_DIR = ".tmp/api-probe";
const CHECKED = [
  "config",
  "session-acceptance",
  "session-acceptance-evidence",
  "readiness",
  "hardware-readiness",
  "source-health",
  "verify",
  "replays",
  "malformed-json"
];

export async function runApiProbe(options: {
  root?: string;
  outDir?: string;
  generatedAt?: string;
} = {}) {
  const previousProvider = process.env.SEEKR_AI_PROVIDER;
  const previousExpectedSources = process.env.SEEKR_EXPECTED_SOURCES;
  const previousStaleMs = process.env.SEEKR_SOURCE_STALE_MS;

  process.env.SEEKR_AI_PROVIDER = process.env.SEEKR_AI_PROVIDER ?? "rules";
  process.env.SEEKR_EXPECTED_SOURCES = process.env.SEEKR_EXPECTED_SOURCES ??
    "mavlink:telemetry:drone-1,ros2-slam:map,detection:spatial,lidar-slam:lidar,lidar-slam:slam,isaac-nvblox:costmap,isaac-nvblox:perception";
  process.env.SEEKR_SOURCE_STALE_MS = process.env.SEEKR_SOURCE_STALE_MS ?? "180000";

  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const context = await startProbeServer();

  try {
    const config = await api<{ safety: { commandUploadEnabled: boolean }; auth: { tokenRedacted: boolean } }>(
      context.url,
      "/api/config"
    );
    assert(config.auth.tokenRedacted, "config must redact auth token");
    assert(config.safety.commandUploadEnabled === false, "config must keep command upload disabled");

    const session = await api<{
      acceptance: ApiProbeManifest["sessionAcceptance"];
    }>(context.url, "/api/session");
    assert(typeof session.acceptance.status === "string", "session must expose acceptance status");
    assert(session.acceptance.commandUploadEnabled === false, "session acceptance evidence must keep command upload disabled");
    if (session.acceptance.status === "pass") {
      assert(
        typeof session.acceptance.releaseChecksum?.overallSha256 === "string" &&
          /^[a-f0-9]{64}$/.test(session.acceptance.releaseChecksum.overallSha256),
        "passing session acceptance must expose release checksum summary"
      );
      assert(
        Number.isInteger(session.acceptance.releaseChecksum.fileCount) &&
          session.acceptance.releaseChecksum.fileCount > 0 &&
          Number.isInteger(session.acceptance.releaseChecksum.totalBytes) &&
          session.acceptance.releaseChecksum.totalBytes > 0,
        "passing session acceptance must expose release checksum file and byte counts"
      );
      assert(
        session.acceptance.commandBoundaryScan?.status === "pass" &&
          Number.isInteger(session.acceptance.commandBoundaryScan.scannedFileCount) &&
          session.acceptance.commandBoundaryScan.scannedFileCount > 0 &&
          session.acceptance.commandBoundaryScan.violationCount === 0,
        "passing session acceptance must expose passing command-boundary scan summary"
      );
    }

    const readiness = await api<{
      ok: boolean;
      checks: Array<{ id: string; status: string }>;
      summary: { blocking: number };
    }>(context.url, "/api/readiness");
    assert(readiness.ok, "readiness should be ok with no blocking failures");
    assert(readiness.summary.blocking === 0, "readiness should have zero blocking failures");
    assert(readiness.checks.some((check) => check.id === "source-health"), "readiness must include source-health check");
    assert(readiness.checks.some((check) => check.id === "runtime-config"), "readiness must include runtime-config check");

    const hardware = await api<{
      ok: boolean;
      summary: { commandUploadEnabled: boolean; blocking: number };
      checks: Array<{ id: string; status: string }>;
    }>(context.url, "/api/hardware-readiness?target=jetson-orin-nano");
    assert(hardware.ok, "hardware readiness should be ok with no blocking failures");
    assert(hardware.summary.commandUploadEnabled === false, "hardware readiness must keep command upload disabled");
    assert(hardware.summary.blocking === 0, "hardware readiness should have zero blocking failures");
    assert(
      hardware.checks.some((check) => check.id === "safety-boundary" && check.status === "pass"),
      "hardware readiness must include safety-boundary pass"
    );

    const sourceHealth = await api<{
      summary: { expectedSourceCount: number; staleThresholdMs: number; staleSourceIds: string[] };
    }>(context.url, "/api/source-health");
    assert(sourceHealth.summary.expectedSourceCount >= 5, "source health should include expected rehearsal sources");
    assert(sourceHealth.summary.staleThresholdMs === 180_000, "source health should expose configured stale threshold");
    assert(sourceHealth.summary.staleSourceIds.includes("mavlink"), "source health should warn on missing MAVLink source");

    const verify = await api<{ ok: boolean; errors: string[] }>(context.url, "/api/verify");
    assert(verify.ok && verify.errors.length === 0, "hash-chain verification must pass");

    const replays = await api<unknown[]>(context.url, "/api/replays");
    assert(Array.isArray(replays), "replays must return an array");

    const malformedJson = await raw(context.url, "/api/commands", {
      method: "POST",
      body: "{",
      headers: { "Content-Type": "application/json" }
    });
    assert(malformedJson.status === 400, "malformed JSON must return 400");
    const malformedBody = (await malformedJson.json()) as { code?: string };
    assert(malformedBody.code === "MALFORMED_JSON", "malformed JSON must return stable error code");

    const manifest: ApiProbeManifest = {
      schemaVersion: 1,
      generatedAt,
      ok: true,
      commandUploadEnabled: false,
      checked: CHECKED,
      sessionAcceptance: session.acceptance,
      readiness: {
        ok: readiness.ok,
        blocking: readiness.summary.blocking
      },
      hardwareReadiness: {
        ok: hardware.ok,
        commandUploadEnabled: hardware.summary.commandUploadEnabled,
        blocking: hardware.summary.blocking
      },
      sourceHealth: {
        expectedSourceCount: sourceHealth.summary.expectedSourceCount,
        staleThresholdMs: sourceHealth.summary.staleThresholdMs,
        staleSourceIds: sourceHealth.summary.staleSourceIds
      },
      verify: {
        ok: verify.ok,
        errorCount: verify.errors.length
      },
      replays: {
        count: replays.length
      },
      malformedJson: {
        status: malformedJson.status,
        code: malformedBody.code
      },
      validation: {
        ok: true,
        warnings: [],
        blockers: []
      },
      limitations: [
        "This probe validates the local API surface and session-visible acceptance summaries only.",
        "It does not validate Jetson/Pi hardware, real MAVLink telemetry, real ROS 2 topics, HIL behavior, Isaac Sim capture, or hardware actuation.",
        "Real MAVLink, ROS 2, PX4, ArduPilot, mission, geofence, mode, arm, takeoff, land, RTH, terminate, and waypoint command paths remain blocked outside simulator/SITL transports."
      ]
    };

    await mkdir(outDir, { recursive: true });
    const safeTimestamp = safeIsoTimestampForFileName(generatedAt);
    const jsonPath = path.join(outDir, `seekr-api-probe-${safeTimestamp}.json`);
    const markdownPath = path.join(outDir, `seekr-api-probe-${safeTimestamp}.md`);
    await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeFile(markdownPath, renderMarkdown(manifest), "utf8");
    return { manifest, jsonPath, markdownPath };
  } finally {
    await context.close();
    restoreEnv("SEEKR_AI_PROVIDER", previousProvider);
    restoreEnv("SEEKR_EXPECTED_SOURCES", previousExpectedSources);
    restoreEnv("SEEKR_SOURCE_STALE_MS", previousStaleMs);
  }
}

async function startProbeServer() {
  const root = await mkdtemp(path.join(os.tmpdir(), "seekr-api-probe-"));
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(jsonBodyErrorHandler);
  const server = http.createServer(app);
  const persistence = new MissionPersistence(root);
  await persistence.init();
  const store = new MissionStore({ clock: () => 1_800_000_000_000, eventStore: persistence.events });
  app.use("/api", createApiRouter(store, persistence));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  };
}

async function api<T>(baseUrl: string, route: string) {
  const response = await raw(baseUrl, route);
  assert(response.ok, `${route} returned ${response.status}`);
  return (await response.json()) as T;
}

async function raw(baseUrl: string, route: string, options: RequestInit = {}) {
  return fetch(`${baseUrl}${route}`, options);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function renderMarkdown(manifest: ApiProbeManifest) {
  return `${[
    "# SEEKR API Probe Evidence",
    "",
    `Generated at: ${manifest.generatedAt}`,
    `OK: ${manifest.ok}`,
    "",
    "Command upload enabled: false",
    "",
    "Checked:",
    "",
    ...manifest.checked.map((item) => `- ${item}`),
    "",
    "Session acceptance:",
    "",
    `- Status: ${manifest.sessionAcceptance.status}`,
    `- Command upload enabled: ${manifest.sessionAcceptance.commandUploadEnabled}`,
    manifest.sessionAcceptance.releaseChecksum
      ? `- Release SHA-256: ${manifest.sessionAcceptance.releaseChecksum.overallSha256}`
      : undefined,
    manifest.sessionAcceptance.commandBoundaryScan
      ? `- Command-boundary scan: ${manifest.sessionAcceptance.commandBoundaryScan.status}, ${manifest.sessionAcceptance.commandBoundaryScan.violationCount} violations`
      : undefined,
    "",
    "Summaries:",
    "",
    `- Readiness blocking checks: ${manifest.readiness.blocking}`,
    `- Hardware readiness command upload enabled: ${manifest.hardwareReadiness.commandUploadEnabled}`,
    `- Hardware readiness blocking checks: ${manifest.hardwareReadiness.blocking}`,
    `- Expected sources configured: ${manifest.sourceHealth.expectedSourceCount}`,
    `- Stale source ids: ${manifest.sourceHealth.staleSourceIds.join(", ") || "none"}`,
    `- Hash-chain verification: ${manifest.verify.ok}`,
    `- Replay count: ${manifest.replays.count}`,
    `- Malformed JSON response: ${manifest.malformedJson.status} ${manifest.malformedJson.code ?? ""}`.trim(),
    "",
    "Validation:",
    "",
    `- OK: ${manifest.validation.ok}`,
    "- Blockers: none",
    "- Warnings: none",
    "",
    "Limitations:",
    "",
    ...manifest.limitations.map((limitation) => `- ${limitation}`),
    ""
  ].filter((line): line is string => typeof line === "string").join("\n")}\n`;
}

function parseArgs(values: string[]) {
  const parsed: Record<string, string | boolean | undefined> = {};
  for (let index = 0; index < values.length; index += 1) {
    const arg = values[index];
    if (!arg.startsWith("--")) continue;
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (typeof inlineValue === "string") parsed[rawKey] = inlineValue;
    else if (values[index + 1] && !values[index + 1].startsWith("--")) parsed[rawKey] = values[++index];
    else parsed[rawKey] = true;
  }
  return parsed;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = parseArgs(process.argv.slice(2));
  const result = await runApiProbe({
    root: typeof args.root === "string" ? args.root : undefined,
    outDir: typeof args.out === "string" ? args.out : undefined,
    generatedAt: typeof args.generatedAt === "string" ? args.generatedAt : undefined
  });
  console.log(JSON.stringify({
    ok: result.manifest.ok,
    checked: result.manifest.checked,
    jsonPath: result.jsonPath,
    markdownPath: result.markdownPath
  }, null, 2));
}
