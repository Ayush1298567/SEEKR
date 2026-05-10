import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRos2TopicEchoCommand, parseLiveRos2BridgeArgs, runLiveRos2ReadOnlyBridge, writeLiveRos2ReadOnlyBridgeEvidence } from "../../../scripts/bridge-ros2-live-readonly";

describe("live ROS 2 read-only bridge wrapper", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "seekr-ros2-live-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("builds topic echo commands without service, action, or command upload surfaces", () => {
    expect(buildRos2TopicEchoCommand("/drone/pose")).toEqual({
      topic: "/drone/pose",
      command: "ros2",
      args: ["topic", "echo", "--json", "/drone/pose"],
      display: "ros2 topic echo --json /drone/pose"
    });

    expect(() => buildRos2TopicEchoCommand("/drone/pose;ros2 service call")).toThrow("Invalid ROS 2 topic");
  });

  it("parses repeated topics and safe live-bridge options", () => {
    expect(parseLiveRos2BridgeArgs([
      "--base-url", "http://127.0.0.1:8787",
      "--topic", "/drone/pose,/map",
      "--topic", "/lidar/points",
      "--duration-ms", "15000",
      "--max-records", "12",
      "--evidence-label", "ros2-bench",
      "--out-dir", ".tmp/bridge-evidence",
      "--dry-run",
      "--command-preview"
    ])).toMatchObject({
      baseUrl: "http://127.0.0.1:8787",
      topics: ["/drone/pose", "/map", "/lidar/points"],
      durationMs: 15000,
      maxRecords: 12,
      evidenceLabel: "ros2-bench",
      outDir: ".tmp/bridge-evidence",
      dryRun: true,
      commandPreview: true
    });
  });

  it("returns command-preview evidence without spawning ROS 2 or touching commands", async () => {
    const result = await runLiveRos2ReadOnlyBridge({
      topics: ["/drone/pose", "/map", "/drone/pose"],
      commandPreview: true,
      dryRun: true
    });

    expect(result).toMatchObject({
      ok: true,
      mode: "ros2-live-readonly",
      dryRun: true,
      commandPreview: true,
      topics: ["/drone/pose", "/map"],
      inputCount: 0,
      acceptedCount: 0,
      postedCount: 0,
      commandEndpointsTouched: false,
      safety: {
        ros2ServicesTouched: false,
        ros2ActionsTouched: false,
        commandUploadEnabled: false
      }
    });
    expect(result.commands.map((command) => command.display)).toEqual([
      "ros2 topic echo --json /drone/pose",
      "ros2 topic echo --json /map"
    ]);
  });

  it("writes persisted command-preview evidence for ROS 2 bench review", async () => {
    const evidence = await writeLiveRos2ReadOnlyBridgeEvidence({
      root,
      outDir: ".tmp/bridge-evidence",
      evidenceLabel: "ros2-bench-preview",
      topics: ["/drone/pose", "/map"],
      commandPreview: true,
      dryRun: true,
      generatedAt: "2026-05-09T22:10:00.000Z"
    });

    expect(evidence.jsonPath).toContain(`${path.sep}.tmp${path.sep}bridge-evidence${path.sep}`);
    expect(evidence.manifest).toMatchObject({
      status: "pass",
      commandUploadEnabled: false,
      validation: {
        ok: true,
        blockers: [],
        warnings: ["Command preview evidence only; it does not prove live source data was observed."]
      },
      bridgeResult: {
        mode: "ros2-live-readonly",
        commandEndpointsTouched: false,
        safety: {
          ros2ServicesTouched: false,
          ros2ActionsTouched: false,
          commandUploadEnabled: false
        }
      }
    });
    await expect(readFile(evidence.jsonPath, "utf8")).resolves.toContain("\"ros2ServicesTouched\": false");
    await expect(readFile(evidence.markdownPath, "utf8")).resolves.toContain("SEEKR Bridge Evidence");
    await expect(readFile(evidence.markdownPath, "utf8")).resolves.toContain("Ros2 Services Touched");
  });
});
