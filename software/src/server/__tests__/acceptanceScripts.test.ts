import packageJson from "../../../package.json";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REQUIRED_ACCEPTANCE_COMMANDS } from "../acceptanceEvidence";
import { SEEKR_SOFTWARE_VERSION } from "../../shared/constants";

describe("acceptance script contract", () => {
  it("keeps package and runtime software versions aligned", () => {
    expect(packageJson.version).toBe(SEEKR_SOFTWARE_VERSION);
  });

  it("keeps the full gate tied to production preview smoke", () => {
    const scripts = packageJson.scripts;
    const acceptance = scripts.acceptance;

    expect(acceptance).toContain("npm run check");
    expect(acceptance).toContain("npm run bench:edge");
    expect(acceptance).toContain("npm run bench:flight");
    expect(acceptance).toContain("npm run bench:sitl");
    expect(acceptance).toContain("npm run bench:sitl:io -- --fixture px4-process-io");
    expect(acceptance).toContain("npm run bench:sitl:io -- --fixture ardupilot-process-io");
    expect(acceptance).toContain("npm run bench:dimos");
    expect(acceptance).toContain("npm run safety:command-boundary");
    expect(acceptance).toContain("npm run test:ai:local");
    expect(acceptance).toContain("npm run test:ui");
    expect(acceptance).toContain("npm run smoke:preview");
    expect(acceptance).toContain("npm run smoke:rehearsal:start");
    expect(acceptance).toContain("npm run release:checksum");
    expect(acceptance).toContain("npm run acceptance:record");
    expect(acceptance).toContain("npm run probe:api");
    expect(scripts["smoke:preview"]).toBe("npm run build && npm run probe:preview");
    expect(scripts["smoke:rehearsal:start"]).toBe("tsx scripts/rehearsal-start-smoke.ts");
    expect(scripts["smoke:fresh-clone"]).toBe("tsx scripts/fresh-clone-operator-smoke.ts");
    expect(scripts["setup:local"]).toBe("tsx scripts/local-setup.ts");
    expect(scripts["ai:prepare"]).toBe("tsx scripts/local-ai-prepare.ts");
    expect(scripts["doctor"]).toBe("tsx scripts/plug-and-play-doctor.ts");
    expect(scripts["plug-and-play"]).toBe("npm run rehearsal:start");
    expect(scripts["rehearsal:start"]).toBe("bash scripts/rehearsal-start.sh");
    expect(scripts["probe:preview"]).toBe("tsx scripts/preview-smoke.ts");
    expect(scripts["probe:api"]).toBe("tsx scripts/api-probe.ts");
    expect(scripts["release:checksum"]).toBe("tsx scripts/release-checksums.ts");
    expect(scripts["acceptance:record"]).toBe("tsx scripts/acceptance-record.ts");
    expect(scripts["safety:command-boundary"]).toBe("tsx scripts/command-boundary-scan.ts");
    expect(scripts["bridge:mavlink"]).toBe("tsx scripts/bridge-mavlink-readonly.ts");
    expect(scripts["bridge:mavlink:serial"]).toBe("tsx scripts/bridge-mavlink-serial-readonly.ts");
    expect(scripts["bridge:ros2"]).toBe("tsx scripts/bridge-ros2-readonly.ts");
    expect(scripts["bridge:ros2:live"]).toBe("tsx scripts/bridge-ros2-live-readonly.ts");
    expect(scripts["bridge:spatial"]).toBe("tsx scripts/bridge-spatial-readonly.ts");
    expect(scripts["rehearsal:evidence"]).toBe("tsx scripts/rehearsal-evidence.ts");
    expect(scripts["rehearsal:note"]).toBe("tsx scripts/rehearsal-note.ts");
    expect(scripts["rehearsal:closeout"]).toBe("tsx scripts/rehearsal-closeout.ts");
    expect(scripts["hil:failsafe:evidence"]).toBe("tsx scripts/hil-failsafe-evidence.ts");
    expect(scripts["isaac:hil:evidence"]).toBe("tsx scripts/isaac-hil-capture-evidence.ts");
    expect(scripts["policy:hardware:gate"]).toBe("tsx scripts/hardware-actuation-policy-gate.ts");
    expect(scripts["demo:package"]).toBe("tsx scripts/demo-readiness-package.ts");
    expect(scripts["bench:evidence:packet"]).toBe("tsx scripts/bench-evidence-packet.ts");
    expect(scripts["handoff:index"]).toBe("tsx scripts/handoff-index.ts");
    expect(scripts["handoff:verify"]).toBe("tsx scripts/handoff-verify.ts");
    expect(scripts["handoff:bundle"]).toBe("tsx scripts/handoff-bundle.ts");
    expect(scripts["handoff:bundle:verify"]).toBe("tsx scripts/handoff-bundle-verify.ts");
    expect(scripts["qa:gstack"]).toBe("tsx scripts/gstack-browser-qa.ts");
    expect(scripts["health:gstack"]).toBe("tsx scripts/gstack-health-history.ts");
    expect(scripts["status:local"]).toBe("tsx scripts/local-recovery-status.ts");
    expect(scripts["audit:gstack"]).toBe("tsx scripts/gstack-workflow-status.ts");
    expect(scripts["audit:source-control"]).toBe("tsx scripts/source-control-handoff.ts");
    expect(scripts["audit:completion"]).toBe("tsx scripts/completion-audit.ts");
    expect(scripts["audit:todo"]).toBe("tsx scripts/todo-audit.ts");
    expect(scripts["audit:plug-and-play"]).toBe("tsx scripts/plug-and-play-readiness.ts");
    expect(scripts["audit:goal"]).toBe("tsx scripts/goal-audit.ts");
  });

  it("records every acceptance gate command in acceptance evidence", () => {
    const acceptance = packageJson.scripts.acceptance;

    for (const command of REQUIRED_ACCEPTANCE_COMMANDS) {
      expect(acceptance).toContain(command);
    }
    expect(REQUIRED_ACCEPTANCE_COMMANDS).toContain("npm run safety:command-boundary");
  });

  it("keeps acceptance record evidence paths inside the project root", () => {
    const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
    const tsx = path.join(projectRoot, "node_modules", ".bin", "tsx");
    const script = path.join(projectRoot, "scripts", "acceptance-record.ts");
    const rejectedArgs = [
      ["--out", "../outside-acceptance.json"],
      ["--releaseDir", "../outside-release"],
      ["--safetyDir", "../outside-safety"]
    ];

    for (const args of rejectedArgs) {
      let output = "";
      try {
        execFileSync(tsx, [script, ...args], {
          cwd: projectRoot,
          encoding: "utf8",
          stdio: "pipe"
        });
      } catch (error) {
        output = [
          String((error as { stdout?: unknown }).stdout ?? ""),
          String((error as { stderr?: unknown }).stderr ?? "")
        ].join("\n");
      }

      expect(output).toContain("must stay inside the project root");
    }
  });

  it("documents internal alpha evidence and handoff scripts in the README", () => {
    const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
    const developerQuickstart = readFileSync(new URL("../../../docs/DEVELOPER_QUICKSTART.md", import.meta.url), "utf8");
    const v1Acceptance = readFileSync(new URL("../../../docs/V1_ACCEPTANCE.md", import.meta.url), "utf8");
    const requiredReadmeCommands = [
      "npm run policy:hardware:gate",
      "npm run audit:completion",
      "npm run demo:package",
      "npm run bench:evidence:packet",
      "npm run handoff:index",
      "npm run handoff:verify",
      "npm run handoff:bundle",
      "npm run handoff:bundle:verify",
      "npm run qa:gstack",
      "npm run health:gstack",
      "npm run status:local",
      "npm run audit:gstack",
      "npm run audit:source-control",
      "npm run audit:todo",
      "npm run setup:local",
      "npm run ai:prepare",
      "npm run doctor",
      "npm run plug-and-play",
      "npm run rehearsal:start",
      "npm run smoke:fresh-clone",
      "npm run audit:plug-and-play",
      "npm run audit:goal",
      "npm run bridge:mavlink:serial",
      "npm run bridge:ros2:live",
      "npm run bridge:spatial",
    ];

    for (const command of requiredReadmeCommands) {
      expect(readme).toContain(command);
    }
    for (const doc of [readme, developerQuickstart, v1Acceptance]) {
      expect(doc).toContain("operator/safety/DX/replay/demo-readiness");
      expectSourceControlCountSummaryDocs(doc);
    }
  });

  it("keeps planning docs aligned with the current evidence matrix", () => {
    const roadmap = readFileSync(new URL("../../../docs/INTEGRATION_ROADMAP.md", import.meta.url), "utf8");
    const edgeBench = readFileSync(new URL("../../../docs/EDGE_HARDWARE_BENCH.md", import.meta.url), "utf8");
    const testMatrix = readFileSync(new URL("../../../docs/TEST_MATRIX.md", import.meta.url), "utf8");
    const gcsTodo = readFileSync(new URL("../../../docs/SEEKR_GCS_ALPHA_TODO.md", import.meta.url), "utf8");
    const goalDoc = readFileSync(new URL("../../../docs/goal.md", import.meta.url), "utf8");
    const requiredMatrixCommands = [
      "npm run acceptance",
      "npm run bench:dimos",
      "npm run safety:command-boundary",
      "npm run smoke:preview",
      "npm run smoke:rehearsal:start",
      "npm run release:checksum",
      "npm run acceptance:record",
      "npm run probe:api",
      "npm run audit:completion",
      "npm run demo:package",
      "npm run bench:evidence:packet",
      "npm run handoff:index",
      "npm run handoff:verify",
      "npm run handoff:bundle",
      "npm run handoff:bundle:verify",
      "npm run qa:gstack",
      "npm run health:gstack",
      "npm run status:local",
      "npm run audit:gstack",
      "npm run audit:source-control",
      "npm run audit:todo",
      "npm run setup:local",
      "npm run ai:prepare",
      "npm run doctor",
      "npm run plug-and-play",
      "npm run rehearsal:start",
      "npm run smoke:rehearsal:start",
      "npm run smoke:fresh-clone",
      "npm run audit:plug-and-play",
      "npm run audit:goal",
      "npm run bridge:mavlink:serial",
      "npm run bridge:ros2:live",
      "npm run bridge:spatial",
    ];

    expect(roadmap).toContain("npm run bench:dimos");
    expect(roadmap).toContain("deterministic DimOS-style read-only replay/export contract");
    expect(roadmap).not.toContain("A future `npm run bench:dimos`");
    expect(edgeBench).toContain("Flight-core and SITL benches exist");
    expect(edgeBench).toContain("What Still Has To Be Proven Or Built");
    expect(edgeBench).toContain("Real bench evidence from the current MAVLink serial or UDP harness");
    expect(edgeBench).not.toContain("Flight software is not complete.");
    expect(edgeBench).not.toContain("A real read-only MAVLink bridge process that subscribes to vehicle telemetry");
    expect(edgeBench).not.toContain("DimOS replay/simulation research to decide whether a `dimos-readonly` sidecar bridge is useful");
    expect(goalDoc).toContain("branch/ref/count/SHA");
    expect(goalDoc).toContain("ref-count/blocked-check-count/warning-check-count/local/remote SHA");
    expect(goalDoc).not.toContain("branch/ref/SHA");
    expect(goalDoc).not.toContain("ref-count/local/remote SHA");
    expect(testMatrix).toContain("ref-count/blocked-check-count/warning-check-count/local/remote SHA");
    expect(testMatrix).toContain("ref-count/blocked-check-count/warning-check-count/SHA");
    expect(testMatrix).not.toContain("ref-count/local/remote SHA");
    expect(testMatrix).not.toContain("ref-count/SHA and clean-worktree");
    for (const command of requiredMatrixCommands) {
      expect(testMatrix).toContain(command);
    }
    const primaryCommands = extractPrimaryTestMatrixCommands(testMatrix);
    expectOrderedCommands(primaryCommands, [
      "npm run setup:local",
      "npm run ai:prepare",
      "npm run doctor",
      "npm run plug-and-play",
      "npm run rehearsal:start"
    ]);
    expectOrderedCommands(primaryCommands, [
      "npm run handoff:verify",
      "npm run qa:gstack",
      "npm run health:gstack",
      "npm run audit:gstack",
      "npm run audit:source-control",
      "npm run audit:todo",
      "npm run setup:local",
      "npm run ai:prepare",
      "npm run smoke:rehearsal:start",
      "npm run doctor",
      "npm run smoke:fresh-clone",
      "npm run handoff:bundle",
      "npm run handoff:bundle:verify",
      "npm run audit:plug-and-play",
      "npm run audit:goal",
      "npm run status:local"
    ]);
    expect(gcsTodo).toContain("real `/map`, pose, detection, LiDAR, and costmap topics");
  });

  it("keeps the overnight loop aligned with final session-visible acceptance evidence", () => {
    const overnightLoop = readFileSync(new URL("../../../scripts/overnight-loop.sh", import.meta.url), "utf8");
    const developerQuickstart = readFileSync(new URL("../../../docs/DEVELOPER_QUICKSTART.md", import.meta.url), "utf8");
    const overnightDoc = readFileSync(new URL("../../../docs/OVERNIGHT_LOOP.md", import.meta.url), "utf8");

    const previewSmoke = overnightLoop.indexOf('run_step "preview-smoke" npm run probe:preview');
    const rehearsalStartSmoke = overnightLoop.indexOf('run_step "rehearsal-start-smoke" npm run smoke:rehearsal:start');
    const releaseChecksum = overnightLoop.indexOf('run_step "release-checksum" npm run release:checksum');
    const acceptanceRecord = overnightLoop.indexOf('run_step "acceptance-record" npm run acceptance:record');
    const finalApiProbe = overnightLoop.indexOf('run_step "api-probe-final" npm run probe:api');

    expect(previewSmoke).toBeGreaterThan(-1);
    expect(rehearsalStartSmoke).toBeGreaterThan(previewSmoke);
    expect(releaseChecksum).toBeGreaterThan(rehearsalStartSmoke);
    expect(acceptanceRecord).toBeGreaterThan(-1);
    expect(finalApiProbe).toBeGreaterThan(acceptanceRecord);
    expect(overnightLoop).not.toContain('run_step "api-probe" npm run probe:api');
    expect(developerQuickstart).toContain("acceptance-record/final-API-probe");
    expect(developerQuickstart).toContain("preview/rehearsal-start-smoke/release-checksum");
    expect(overnightDoc).toContain("npm run smoke:rehearsal:start");
    expect(overnightDoc).toContain("before the release checksum");
    expect(developerQuickstart).not.toContain("release-checksum/API/hardware");
    expect(overnightLoop).toContain("docs/SEEKR_GCS_ALPHA_TODO.md");
    expect(overnightLoop).toContain("docs/SEEKR_COMPLETION_PLAN.md");
  });
});

function extractPrimaryTestMatrixCommands(testMatrix: string) {
  const match = /Primary commands:\n\n```bash\n([\s\S]*?)\n```/.exec(testMatrix);
  expect(match?.[1]).toBeTruthy();
  return match![1].split("\n").map((line) => line.trim()).filter(Boolean);
}

function expectOrderedCommands(commands: string[], expected: string[]) {
  let cursor = -1;
  for (const command of expected) {
    const nextIndex = commands.findIndex((candidate, index) => index > cursor && candidate === command);
    expect(nextIndex, `${command} should appear after ${commands[cursor] ?? "the start"} in TEST_MATRIX primary commands`).toBeGreaterThan(cursor);
    cursor = nextIndex;
  }
}

function expectSourceControlCountSummaryDocs(doc: string) {
  expectSnippet(doc, "handoff:bundle", [
    "blocked/warning check counts",
    "source-control handoff"
  ]);
  expectSnippet(doc, "handoff:bundle:verify", [
    "blocked-check-count",
    "warning-check-count"
  ]);
  expectSnippet(doc, "audit:plug-and-play", [
    "blocked/warning check counts",
    "branch/ref/count/SHA"
  ]);
  expectSnippet(doc, "audit:goal", [
    "blocked-check-count",
    "warning-check-count"
  ]);
}

function expectSnippet(content: string, anchor: string, required: string[]) {
  const snippets: string[] = [];
  let cursor = content.indexOf(anchor);
  while (cursor !== -1) {
    snippets.push(content.slice(cursor, cursor + 4000));
    cursor = content.indexOf(anchor, cursor + anchor.length);
  }
  expect(snippets.length, `${anchor} should be documented`).toBeGreaterThan(0);
  expect(
    snippets.some((snippet) => required.every((phrase) => snippet.includes(phrase))),
    `${anchor} docs should mention ${required.join(", ")}`
  ).toBe(true);
}
