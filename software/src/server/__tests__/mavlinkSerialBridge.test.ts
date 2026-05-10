import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSerialMavlinkBridgeArgs, runSerialMavlinkReadOnlyBridge, writeSerialMavlinkReadOnlyBridgeEvidence } from "../../../scripts/bridge-mavlink-serial-readonly";
import { x25Crc } from "../adapters/mavlinkBinary";

describe("serial MAVLink read-only bridge wrapper", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "seekr-mavlink-serial-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns command-preview evidence without opening a serial stream", async () => {
    const result = await runSerialMavlinkReadOnlyBridge({
      devicePath: "/dev/ttyUSB0",
      commandPreview: true,
      dryRun: true
    });

    expect(result).toMatchObject({
      ok: true,
      mode: "mavlink-serial-readonly",
      dryRun: true,
      commandPreview: true,
      devicePath: "/dev/ttyUSB0",
      inputBytes: 0,
      inputCount: 0,
      acceptedCount: 0,
      postedCount: 0,
      commandEndpointsTouched: false,
      safety: {
        serialWriteOpened: false,
        commandUploadEnabled: false
      }
    });
  });

  it("parses CLI arguments for bounded read-only serial capture", () => {
    expect(parseSerialMavlinkBridgeArgs([
      "--device", "/dev/ttyACM0",
      "--base-url", "http://127.0.0.1:8787",
      "--duration-ms", "15000",
      "--max-bytes", "4096",
      "--evidence-label", "mavlink-bench",
      "--out-dir", ".tmp/bridge-evidence",
      "--dry-run",
      "--command-preview"
    ])).toMatchObject({
      devicePath: "/dev/ttyACM0",
      baseUrl: "http://127.0.0.1:8787",
      durationMs: 15000,
      maxBytes: 4096,
      evidenceLabel: "mavlink-bench",
      outDir: ".tmp/bridge-evidence",
      dryRun: true,
      commandPreview: true
    });
  });

  it("reads captured serial bytes as MAVLink telemetry without posting in dry-run mode", async () => {
    const capturePath = path.join(root, "serial-capture.bin");
    await writeFile(capturePath, Buffer.concat([
      mavlinkV2Frame(0, heartbeatPayload({ systemStatus: 4 })),
      mavlinkV2Frame(32, localPositionPayload({ x: 4, y: 7, z: -3, vx: 1, vy: 2, vz: -1 }))
    ]));

    const result = await runSerialMavlinkReadOnlyBridge({
      devicePath: capturePath,
      dryRun: true,
      durationMs: 1_000,
      maxBytes: 4_096,
      receivedAt: 1_800_000_005_000
    });

    expect(result).toMatchObject({
      ok: true,
      inputBytes: expect.any(Number),
      inputCount: 2,
      acceptedCount: 2,
      postedCount: 0,
      rejected: [],
      commandEndpointsTouched: false
    });
    expect(result.inputBytes).toBeGreaterThan(0);
  });

  it("writes persisted bridge evidence for serial bench review", async () => {
    const capturePath = path.join(root, "serial-capture.bin");
    await writeFile(capturePath, mavlinkV2Frame(0, heartbeatPayload({ systemStatus: 4 })));

    const evidence = await writeSerialMavlinkReadOnlyBridgeEvidence({
      root,
      outDir: ".tmp/bridge-evidence",
      evidenceLabel: "mavlink-bench",
      devicePath: capturePath,
      dryRun: true,
      durationMs: 1_000,
      maxBytes: 4_096,
      receivedAt: 1_800_000_005_000,
      generatedAt: "2026-05-09T22:00:00.000Z"
    });

    expect(evidence.jsonPath).toContain(`${path.sep}.tmp${path.sep}bridge-evidence${path.sep}`);
    expect(evidence.manifest).toMatchObject({
      status: "pass",
      commandUploadEnabled: false,
      validation: {
        ok: true,
        blockers: []
      },
      bridgeResult: {
        mode: "mavlink-serial-readonly",
        commandEndpointsTouched: false,
        safety: {
          serialWriteOpened: false,
          commandUploadEnabled: false
        }
      }
    });
    await expect(readFile(evidence.jsonPath, "utf8")).resolves.toContain("\"serialWriteOpened\": false");
    await expect(readFile(evidence.markdownPath, "utf8")).resolves.toContain("SEEKR Bridge Evidence");
    await expect(readFile(evidence.markdownPath, "utf8")).resolves.toContain("Serial Write Opened");
  });
});

const CRC_EXTRAS: Record<number, number> = {
  0: 50,
  32: 185
};

function mavlinkV2Frame(msgid: number, payload: Buffer) {
  const header = Buffer.from([
    0xfd,
    payload.length,
    0,
    0,
    17,
    42,
    1,
    msgid & 0xff,
    (msgid >> 8) & 0xff,
    (msgid >> 16) & 0xff
  ]);
  const crc = x25Crc(Buffer.concat([header.subarray(1), payload]), CRC_EXTRAS[msgid]);
  return Buffer.concat([header, payload, Buffer.from([crc & 0xff, (crc >> 8) & 0xff])]);
}

function heartbeatPayload(input: { systemStatus: number }) {
  const payload = Buffer.alloc(9);
  payload.writeUInt32LE(12, 0);
  payload[6] = 81;
  payload[7] = input.systemStatus;
  payload[8] = 3;
  return payload;
}

function localPositionPayload(input: { x: number; y: number; z: number; vx: number; vy: number; vz: number }) {
  const payload = Buffer.alloc(28);
  payload.writeUInt32LE(1000, 0);
  payload.writeFloatLE(input.x, 4);
  payload.writeFloatLE(input.y, 8);
  payload.writeFloatLE(input.z, 12);
  payload.writeFloatLE(input.vx, 16);
  payload.writeFloatLE(input.vy, 20);
  payload.writeFloatLE(input.vz, 24);
  return payload;
}
