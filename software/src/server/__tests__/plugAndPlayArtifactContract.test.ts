import { describe, expect, it } from "vitest";
import {
  REQUIRED_DOCTOR_CHECK_IDS,
  REQUIRED_PLUG_AND_PLAY_SETUP_CHECK_IDS,
  REQUIRED_RUNTIME_DEPENDENCY_EVIDENCE,
  SOFT_DOCTOR_CHECK_IDS,
  doctorCheckStatusOk,
  doctorPortWarningEvidenceOk,
  doctorRuntimeDependencyEvidenceOk,
  doctorSourceControlEvidenceOk,
  plugAndPlayDoctorOk,
  plugAndPlaySetupOk
} from "../../../scripts/plug-and-play-artifact-contract";

const GENERATED_AT = "2026-05-10T10:00:00.000Z";

describe("plug-and-play artifact contract", () => {
  it("accepts a complete local setup artifact", () => {
    expect(REQUIRED_PLUG_AND_PLAY_SETUP_CHECK_IDS).toEqual([
      "env-example",
      "env-file",
      "rehearsal-data-dir",
      "safety-boundary"
    ]);
    expect(plugAndPlaySetupOk(setupManifest())).toBe(true);
  });

  it("rejects setup artifacts that omit a required check", () => {
    const manifest = setupManifest({
      checks: setupManifest().checks.filter((check) => check.id !== "safety-boundary")
    });

    expect(plugAndPlaySetupOk(manifest)).toBe(false);
  });

  it("rejects setup artifacts with extra or reordered checks", () => {
    expect(plugAndPlaySetupOk(setupManifest({
      checks: [
        ...setupManifest().checks,
        { id: "unreviewed-extra-setup-check", status: "pass", details: "Unexpected setup row." }
      ]
    }))).toBe(false);
    expect(plugAndPlaySetupOk(setupManifest({
      checks: [
        setupManifest().checks[1],
        setupManifest().checks[0],
        ...setupManifest().checks.slice(2)
      ]
    }))).toBe(false);
  });

  it("accepts a doctor artifact with only soft warnings and current acceptance evidence", () => {
    const manifest = doctorManifest({
      summary: { pass: 7, warn: 3, fail: 0 },
      checks: doctorChecks().map((check) =>
        SOFT_DOCTOR_CHECK_IDS.has(check.id) ? { ...check, status: "warn" } : check
      )
    });

    expect(plugAndPlayDoctorOk(manifest, { generatedAt: "2026-05-10T09:59:00.000Z" })).toBe(true);
  });

  it("rejects a doctor artifact older than the latest acceptance record", () => {
    expect(plugAndPlayDoctorOk(doctorManifest(), { generatedAt: "2026-05-10T10:01:00.000Z" })).toBe(false);
  });

  it("rejects doctor artifacts missing runtime dependency evidence", () => {
    const checks = doctorChecks().map((check) =>
      check.id === "runtime-dependencies"
        ? {
            ...check,
            details: "Runtime evidence incomplete.",
            evidence: REQUIRED_RUNTIME_DEPENDENCY_EVIDENCE.slice(0, -1)
          }
        : check
    );

    expect(doctorRuntimeDependencyEvidenceOk(checks)).toBe(false);
    expect(plugAndPlayDoctorOk(doctorManifest({ checks }))).toBe(false);
  });

  it("requires doctor source-control evidence to match the packaged source-control handoff when provided", () => {
    const checks = doctorChecks(".tmp/source-control-handoff/seekr-source-control-handoff-current.json");

    expect(doctorSourceControlEvidenceOk(checks, ".tmp/source-control-handoff/seekr-source-control-handoff-current.json")).toBe(true);
    expect(plugAndPlayDoctorOk(doctorManifest({ checks }), undefined, ".tmp/source-control-handoff/seekr-source-control-handoff-current.json")).toBe(true);
    expect(plugAndPlayDoctorOk(doctorManifest({ checks }), undefined, ".tmp/source-control-handoff/seekr-source-control-handoff-newer.json")).toBe(false);
  });

  it("requires listener diagnostics when local ports are occupied by non-SEEKR listeners", () => {
    const checks = doctorChecks().map((check) =>
      check.id === "local-ports"
        ? {
            ...check,
            status: "warn",
            details: "Port(s) already in use on 127.0.0.1 by a non-SEEKR or unhealthy listener: api 8787. Listener diagnostics: api 8787 -> node pid 12345 cwd ~/Ayush/Prophet/prophet-console. Stop the existing process before starting a fresh npm run dev.",
            evidence: [
              "PORT",
              "SEEKR_API_PORT",
              "SEEKR_CLIENT_PORT",
              "http://127.0.0.1:8787/api/health",
              "lsof -nP -iTCP:8787 -sTCP:LISTEN",
              "listener 12345 cwd ~/Ayush/Prophet/prophet-console"
            ]
          }
        : check
    );

    expect(doctorPortWarningEvidenceOk(checks)).toBe(true);
    expect(plugAndPlayDoctorOk(doctorManifest({ checks, summary: { pass: 9, warn: 1, fail: 0 } }))).toBe(true);
  });

  it("accepts auto-recoverable non-SEEKR default-port pass evidence only with listener diagnostics and free-port fallback candidate proof", () => {
    const checks = doctorChecks().map((check) =>
      check.id === "local-ports"
        ? {
            ...check,
            status: "pass",
            details: "Default port(s) already in use on 127.0.0.1 by a non-SEEKR or unhealthy listener: api 8787. Listener diagnostics: api 8787 -> node pid 12345 cwd ~/Ayush/Prophet/prophet-console. npm run rehearsal:start auto-selects free local API/client ports when no explicit port variables are set; stop the existing process only if you want SEEKR to use the default port(s). Current free fallback candidate(s): API 6100, client 5173; npm run rehearsal:start prints the actual URLs it selects at startup.",
            evidence: [
              "PORT",
              "SEEKR_API_PORT",
              "SEEKR_CLIENT_PORT",
              "scripts/rehearsal-start.sh auto-selected free local API/client ports",
              "fallback API port candidate 6100",
              "http://127.0.0.1:8787/api/health",
              "lsof -nP -iTCP:8787 -sTCP:LISTEN",
              "listener 12345 cwd ~/Ayush/Prophet/prophet-console"
            ]
          }
        : check
    );

    expect(doctorPortWarningEvidenceOk(checks)).toBe(true);
    expect(plugAndPlayDoctorOk(doctorManifest({ checks }))).toBe(true);
  });

  it("rejects non-SEEKR local-port warnings that drop listener diagnostics", () => {
    const checks = doctorChecks().map((check) =>
      check.id === "local-ports"
        ? {
            ...check,
            status: "warn",
            details: "Port(s) already in use on 127.0.0.1 by a non-SEEKR or unhealthy listener: api 8787. Stop the existing process before starting a fresh npm run dev.",
            evidence: ["PORT", "SEEKR_API_PORT", "http://127.0.0.1:8787/api/health"]
          }
        : check
    );

    expect(doctorPortWarningEvidenceOk(checks)).toBe(false);
    expect(plugAndPlayDoctorOk(doctorManifest({ checks, summary: { pass: 9, warn: 1, fail: 0 } }))).toBe(false);
  });

  it("rejects auto-recoverable non-SEEKR default-port pass evidence that drops fallback candidate proof", () => {
    const checks = doctorChecks().map((check) =>
      check.id === "local-ports"
        ? {
            ...check,
            status: "pass",
            details: "Default port(s) already in use on 127.0.0.1 by a non-SEEKR or unhealthy listener: api 8787. Listener diagnostics: api 8787 -> node pid 12345 cwd ~/Ayush/Prophet/prophet-console.",
            evidence: [
              "PORT",
              "SEEKR_API_PORT",
              "http://127.0.0.1:8787/api/health",
              "lsof -nP -iTCP:8787 -sTCP:LISTEN",
              "listener 12345 cwd ~/Ayush/Prophet/prophet-console"
            ]
          }
        : check
    );

    expect(doctorPortWarningEvidenceOk(checks)).toBe(false);
    expect(plugAndPlayDoctorOk(doctorManifest({ checks }))).toBe(false);
  });

  it("rejects warning statuses on critical doctor checks", () => {
    const checks = doctorChecks().map((check) =>
      check.id === "local-ai" ? { ...check, status: "warn" } : check
    );

    expect(doctorCheckStatusOk(checks, "local-ai")).toBe(false);
    expect(plugAndPlayDoctorOk(doctorManifest({ checks }))).toBe(false);
  });

  it("rejects doctor artifacts with extra or reordered checks", () => {
    expect(plugAndPlayDoctorOk(doctorManifest({
      checks: [
        ...doctorChecks(),
        { id: "unreviewed-extra-doctor-check", status: "pass", details: "Unexpected doctor row." }
      ]
    }))).toBe(false);
    expect(plugAndPlayDoctorOk(doctorManifest({
      checks: [
        doctorChecks()[1],
        doctorChecks()[0],
        ...doctorChecks().slice(2)
      ]
    }))).toBe(false);
  });
});

function setupManifest(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: "ready-local-setup",
    commandUploadEnabled: false,
    envFilePath: ".env",
    dataDirPath: "data",
    checks: REQUIRED_PLUG_AND_PLAY_SETUP_CHECK_IDS.map((id) => ({
      id,
      status: "pass",
      details: `${id} ok`,
      evidence: [id]
    })),
    ...overrides
  };
}

function doctorManifest(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: "ready-local-start",
    commandUploadEnabled: false,
    generatedAt: GENERATED_AT,
    ai: {
      provider: "ollama",
      status: "pass"
    },
    summary: {
      pass: REQUIRED_DOCTOR_CHECK_IDS.length,
      warn: 0,
      fail: 0
    },
    checks: doctorChecks(),
    ...overrides
  };
}

function doctorChecks(sourceControlPath = ".tmp/source-control-handoff/seekr-source-control-handoff-test.json") {
  return REQUIRED_DOCTOR_CHECK_IDS.map((id) => ({
    id,
    status: "pass",
    details: id === "runtime-dependencies"
      ? `Runtime evidence: ${REQUIRED_RUNTIME_DEPENDENCY_EVIDENCE.join(", ")}`
      : id === "source-control-handoff"
        ? `Source-control handoff artifact ${sourceControlPath} is ready.`
      : `${id} ok`,
    evidence: id === "runtime-dependencies"
      ? [...REQUIRED_RUNTIME_DEPENDENCY_EVIDENCE]
      : id === "source-control-handoff"
        ? [sourceControlPath]
        : [id]
  }));
}
