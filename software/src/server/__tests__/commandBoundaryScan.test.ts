import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCommandBoundaryScan, writeCommandBoundaryScan } from "../../../scripts/command-boundary-scan";

describe("command boundary scan", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-command-boundary-scan-test-${process.pid}-${Date.now()}`);
    await seedSafeSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("passes when real adapters reject commands and command tokens are SITL-only", async () => {
    const manifest = await buildCommandBoundaryScan({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(manifest.status).toBe("pass");
    expect(manifest.commandUploadEnabled).toBe(false);
    expect(manifest.safetyBoundary).toEqual({
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    });
    expect(manifest.violations).toEqual([]);
    expect(manifest.allowedFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "sitl-command-token", file: "src/flight/sitl/mapper.ts" }),
      expect.objectContaining({ id: "adapter-result-helper", file: "src/server/adapters/vehicleAdapter.ts" })
    ]));
  });

  it("fails on accepted commands, unsafe flags, and outbound command tokens outside SITL", async () => {
    await writeFile(path.join(root, "src/server/adapters/unsafeAdapter.ts"), [
      "import { commandAccepted } from './vehicleAdapter';",
      "export const unsafe = { commandUploadEnabled: true, hardwareActuationEnabled: true };",
      "export const mavlink = 'MAV_CMD_COMPONENT_ARM_DISARM';",
      "export function upload() { return commandAccepted('unsafe'); }"
    ].join("\n"), "utf8");

    const manifest = await buildCommandBoundaryScan({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(manifest.status).toBe("fail");
    expect(manifest.commandUploadEnabled).toBe(false);
    expect(manifest.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "command-accepted-used" }),
      expect.objectContaining({ id: "unsafe-truth-assignment", match: "commandUploadEnabled: true" }),
      expect.objectContaining({ id: "unsafe-truth-assignment", match: "hardwareActuationEnabled: true" }),
      expect.objectContaining({ id: "outbound-command-token", match: "MAV_CMD_COMPONENT_ARM_DISARM" })
    ]));
  });

  it("writes JSON and Markdown evidence", async () => {
    const result = await writeCommandBoundaryScan({
      root,
      outDir: ".tmp/safety-evidence",
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(result.jsonPath).toContain(`${path.sep}.tmp${path.sep}safety-evidence${path.sep}`);
    expect(result.markdownPath).toContain(`${path.sep}.tmp${path.sep}safety-evidence${path.sep}`);
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"commandUploadEnabled\": false");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("SEEKR Command Boundary Scan");
  });
});

async function seedSafeSource(root: string) {
  await mkdir(path.join(root, "src/server/adapters"), { recursive: true });
  await mkdir(path.join(root, "src/flight/sitl"), { recursive: true });
  await mkdir(path.join(root, "src/flight"), { recursive: true });
  await mkdir(path.join(root, "scripts"), { recursive: true });

  await writeFile(path.join(root, "src/server/adapters/vehicleAdapter.ts"), [
    "export function commandAccepted(message: string) { return { accepted: true, commandId: 'test', message }; }",
    "export function commandRejected(message: string) { return { accepted: false, commandId: 'test', message }; }"
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "src/server/adapters/mavlinkAdapter.ts"), realAdapterSource("MavlinkAdapter"), "utf8");
  await writeFile(path.join(root, "src/server/adapters/ros2SlamAdapter.ts"), realAdapterSource("Ros2SlamAdapter"), "utf8");
  await writeFile(path.join(root, "src/flight/sitl/mapper.ts"), "export const command = 'MAV_CMD_NAV_TAKEOFF';\n", "utf8");
  await writeFile(path.join(root, "src/flight/safety.ts"), "if (command.transport === 'hardware') blockers.push('locked');\n", "utf8");
  await writeFile(path.join(root, "scripts/safe.ts"), "export const evidence = { commandUploadEnabled: false, hardwareActuationEnabled: false };\n", "utf8");
}

function realAdapterSource(name: string) {
  return [
    "import { commandRejected } from './vehicleAdapter';",
    `export class ${name} {`,
    "  async uploadMission() { return commandRejected('read-only'); }",
    "  async hold() { return commandRejected('read-only'); }",
    "  async returnHome() { return commandRejected('read-only'); }",
    "}"
  ].join("\n");
}
