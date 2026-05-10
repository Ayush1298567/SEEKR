import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureRehearsalEvidence, writeRehearsalEvidence } from "../../../scripts/rehearsal-evidence";

describe("rehearsal evidence", () => {
  let root: string;

  beforeEach(() => {
    root = path.join(os.tmpdir(), `seekr-rehearsal-evidence-test-${process.pid}-${Date.now()}`);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes live API snapshot evidence without enabling command upload", async () => {
    const result = await writeRehearsalEvidence({
      root,
      outDir: ".tmp/rehearsal-evidence",
      baseUrl: "http://127.0.0.1:8787",
      label: "fresh operator",
      generatedAt: "2026-05-09T19:00:00.000Z",
      fetchImpl: mockFetch(responses())
    });

    expect(result.manifest.validation.ok).toBe(true);
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.observedSafety).toEqual({
      configCommandUploadEnabled: false,
      sessionAcceptanceCommandUploadEnabled: false,
      hardwareCommandUploadEnabled: false
    });
    expect(result.manifest.endpoints.map((endpoint) => endpoint.id)).toEqual([
      "session",
      "config",
      "readiness",
      "hardware-readiness",
      "source-health",
      "verify",
      "replays"
    ]);
    expect(result.jsonPath).toContain(`${path.sep}.tmp${path.sep}rehearsal-evidence${path.sep}`);
    expect(result.markdownPath).toContain("fresh-operator");
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"commandUploadEnabled\": false");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("does not validate Jetson/Pi hardware");
  });

  it("fails validation when live API safety state is unsafe", async () => {
    const unsafeResponses = responses({
      config: {
        safety: {
          commandUploadEnabled: true,
          realAdaptersReadOnly: false
        }
      }
    });

    const manifest = await captureRehearsalEvidence({
      baseUrl: "http://127.0.0.1:8787",
      generatedAt: "2026-05-09T19:00:00.000Z",
      fetchImpl: mockFetch(unsafeResponses)
    });

    expect(manifest.validation.ok).toBe(false);
    expect(manifest.validation.failures).toContain("config safety.commandUploadEnabled must be false");
    expect(manifest.validation.failures).toContain("config safety.realAdaptersReadOnly must be true");
    expect(manifest.commandUploadEnabled).toBe(false);
  });

  it("can require fresh read-only source evidence for bench captures", async () => {
    const manifest = await captureRehearsalEvidence({
      baseUrl: "http://127.0.0.1:8787",
      generatedAt: "2026-05-09T19:00:00.000Z",
      requiredSources: ["mavlink:telemetry:drone-1,ros2-pose:telemetry:drone-ros2-1,lidar-slam:lidar+spatial"],
      fetchImpl: mockFetch(responses({
        "source-health": {
          ok: true,
          summary: { staleSourceIds: [] },
          sources: [
            {
              id: "mavlink",
              sourceAdapter: "mavlink",
              status: "pass",
              channels: ["telemetry"],
              eventCount: 4,
              rejectedCount: 0,
              droneIds: ["drone-1"]
            },
            {
              id: "ros2-pose",
              sourceAdapter: "ros2-pose",
              status: "pass",
              channels: ["telemetry"],
              eventCount: 2,
              rejectedCount: 0,
              droneIds: ["drone-ros2-1"]
            },
            {
              id: "lidar-slam",
              sourceAdapter: "lidar-slam",
              status: "pass",
              channels: ["lidar", "slam", "spatial"],
              eventCount: 1,
              rejectedCount: 0,
              droneIds: []
            }
          ]
        }
      }))
    });

    expect(manifest.validation.ok).toBe(true);
    expect(manifest.sourceEvidence.required).toHaveLength(3);
    expect(manifest.sourceEvidence.matched).toHaveLength(3);
    expect(manifest.sourceEvidence.missing).toEqual([]);
    expect(manifest.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails required source evidence when a named source has no fresh events", async () => {
    const manifest = await captureRehearsalEvidence({
      baseUrl: "http://127.0.0.1:8787",
      generatedAt: "2026-05-09T19:00:00.000Z",
      requiredSources: ["mavlink:telemetry:drone-1"],
      fetchImpl: mockFetch(responses({
        "source-health": {
          ok: true,
          summary: { staleSourceIds: ["mavlink"] },
          sources: [
            {
              id: "mavlink",
              sourceAdapter: "mavlink",
              status: "warn",
              channels: ["telemetry"],
              eventCount: 0,
              rejectedCount: 0,
              droneIds: ["drone-1"]
            }
          ]
        }
      }))
    });

    expect(manifest.validation.ok).toBe(false);
    expect(manifest.sourceEvidence.missing).toEqual(["mavlink channels telemetry drones drone-1 (mavlink:telemetry:drone-1)"]);
    expect(manifest.validation.failures).toEqual(expect.arrayContaining([
      "required source was not observed with fresh events: mavlink channels telemetry drones drone-1 (mavlink:telemetry:drone-1)"
    ]));
  });
});

function responses(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    "/api/session": {
      acceptance: {
        status: "pass",
        currentBoot: true,
        commandUploadEnabled: false
      },
      ...(overrides.session as Record<string, unknown> | undefined)
    },
    "/api/config": {
      safety: {
        commandUploadEnabled: false,
        realAdaptersReadOnly: true
      },
      ...(overrides.config as Record<string, unknown> | undefined)
    },
    "/api/readiness": {
      ok: true,
      summary: {
        blocking: 0
      },
      ...(overrides.readiness as Record<string, unknown> | undefined)
    },
    "/api/hardware-readiness?target=jetson-orin-nano": {
      ok: true,
      summary: {
        commandUploadEnabled: false,
        blocking: 0
      },
      ...(overrides["hardware-readiness"] as Record<string, unknown> | undefined)
    },
    "/api/source-health": {
      ok: true,
      summary: {
        staleSourceIds: []
      },
      ...(overrides["source-health"] as Record<string, unknown> | undefined)
    },
    "/api/verify": {
      ok: true,
      errors: [],
      ...(overrides.verify as Record<string, unknown> | undefined)
    },
    "/api/replays": overrides.replays ?? []
  };
}

function mockFetch(responseBodies: Record<string, unknown>) {
  return async (input: string) => {
    const url = new URL(input);
    const route = `${url.pathname}${url.search}`;
    const body = responseBodies[route];
    if (body === undefined) {
      return new Response(JSON.stringify({ ok: false, error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
}
