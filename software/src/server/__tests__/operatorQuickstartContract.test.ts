import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OPERATOR_QUICKSTART_PATH,
  REQUIRED_OPERATOR_QUICKSTART_COMMAND_ORDER,
  REQUIRED_OPERATOR_QUICKSTART_SIGNALS,
  operatorQuickstartOk,
  operatorQuickstartProblems
} from "../../../scripts/operator-quickstart-contract";

describe("operator quickstart contract", () => {
  it("accepts the real operator quickstart document", () => {
    const content = readFileSync(new URL("../../../docs/OPERATOR_QUICKSTART.md", import.meta.url), "utf8");

    expect(OPERATOR_QUICKSTART_PATH).toBe("docs/OPERATOR_QUICKSTART.md");
    expect(operatorQuickstartOk(content)).toBe(true);
    expect(operatorQuickstartProblems(content)).toEqual([]);
  });

  it("keeps the GitHub landing README aligned with the fresh-clone operator path", () => {
    const content = readFileSync(new URL("../../../../README.md", import.meta.url), "utf8");

    expect(content).toContain("git clone https://github.com/Ayush1298567/SEEKR.git");
    expect(content).toContain("cd SEEKR/software");
    expect(content).toContain("git pull --ff-only");
    expect(content).toContain("npm run audit:source-control");
    expect(content).toContain("npm run plug-and-play");
    expect(content).toContain("npm run smoke:rehearsal:start");
    expect(content.indexOf("git clone https://github.com/Ayush1298567/SEEKR.git")).toBeLessThan(content.indexOf("cd SEEKR/software"));
    expect(content.indexOf("cd SEEKR/software")).toBeLessThan(content.indexOf("npm ci"));
    expect(content.indexOf("npm run plug-and-play")).toBeLessThan(content.indexOf("npm run smoke:rehearsal:start"));
  });

  it("pins advisory AI command-safety language as required signals", () => {
    expect(REQUIRED_OPERATOR_QUICKSTART_SIGNALS).toEqual(expect.arrayContaining([
      "AI output is advisory",
      "validated candidate plans",
      "cannot create command payloads",
      "bypass operator validation",
      "No AI-created command payloads",
      "No operator answer bypassing validation"
    ]));
  });

  it("pins strict local AI smoke proof guidance as required signals", () => {
    expect(REQUIRED_OPERATOR_QUICKSTART_SIGNALS).toEqual(expect.arrayContaining([
      "npm run ai:prepare",
      "ollama pull llama3.2",
      "npm run test:ai:local",
      ".tmp/ai-smoke-status.json",
      "strict local AI smoke",
      "validator pass",
      "no unsafe operator-facing text",
      "no mutation while thinking"
    ]));
  });

  it("pins GitHub clone and software directory entry guidance as required signals", () => {
    expect(REQUIRED_OPERATOR_QUICKSTART_SIGNALS).toEqual(expect.arrayContaining([
      "git clone https://github.com/Ayush1298567/SEEKR.git",
      "cd SEEKR/software",
      "git pull --ff-only",
      "software/"
    ]));
  });

  it("pins occupied-port recovery guidance as required signals", () => {
    expect(REQUIRED_OPERATOR_QUICKSTART_SIGNALS).toEqual(expect.arrayContaining([
      "non-SEEKR or unhealthy listener",
      "Listener diagnostics",
      "Stop the existing process",
      "free local API/client ports"
    ]));
  });

  it("pins bounded rehearsal-start smoke proof guidance as a required signal", () => {
    expect(REQUIRED_OPERATOR_QUICKSTART_SIGNALS).toContain("npm run plug-and-play");
    expect(REQUIRED_OPERATOR_QUICKSTART_SIGNALS).toContain("npm run smoke:rehearsal:start");
  });

  it("rejects quickstarts with negated command or hardware boundary wording", () => {
    const content = [
      ...REQUIRED_OPERATOR_QUICKSTART_SIGNALS,
      "Command upload is not disabled.",
      "Hardware actuation is not locked."
    ].join("\n");

    expect(operatorQuickstartOk(content)).toBe(false);
    expect(operatorQuickstartProblems(content)).toEqual(expect.arrayContaining([
      "non-negated command upload boundary",
      "non-negated hardware actuation boundary"
    ]));
  });

  it("rejects quickstarts with contradictory command or hardware authority wording", () => {
    const content = [
      validQuickstartContent(),
      "Command upload is enabled after local review.",
      "Hardware actuation is allowed after local review."
    ].join("\n");

    expect(operatorQuickstartOk(content)).toBe(false);
    expect(operatorQuickstartProblems(content)).toEqual(expect.arrayContaining([
      "non-negated command upload boundary",
      "non-negated hardware actuation boundary"
    ]));
  });

  it("rejects quickstarts that omit advisory AI command-safety guidance", () => {
    const content = validQuickstartContent().replace("AI output is advisory\n", "");

    expect(operatorQuickstartOk(content)).toBe(false);
    expect(operatorQuickstartProblems(content)).toContain("AI output is advisory");
  });

  it("rejects quickstarts that omit local Ollama model preparation", () => {
    const content = validQuickstartContent().replace("ollama pull llama3.2\n", "");

    expect(operatorQuickstartOk(content)).toBe(false);
    expect(operatorQuickstartProblems(content)).toContain("ollama pull llama3.2");
  });

  it("rejects quickstarts that omit packaged AI preparation evidence", () => {
    const content = validQuickstartContent().replace("npm run ai:prepare\n", "");

    expect(operatorQuickstartOk(content)).toBe(false);
    expect(operatorQuickstartProblems(content)).toContain("npm run ai:prepare");
  });

  it("rejects quickstarts that omit occupied-port recovery guidance", () => {
    const content = validQuickstartContent().replace("Listener diagnostics\n", "");

    expect(operatorQuickstartOk(content)).toBe(false);
    expect(operatorQuickstartProblems(content)).toContain("Listener diagnostics");
  });

  it("rejects quickstarts that omit bounded rehearsal-start smoke proof guidance", () => {
    const content = validQuickstartContent().replace("npm run smoke:rehearsal:start\n", "");

    expect(operatorQuickstartOk(content)).toBe(false);
    expect(operatorQuickstartProblems(content)).toContain("npm run smoke:rehearsal:start");
  });

  it("rejects quickstarts that put source-control audit after startup", () => {
    const content = [
      "git clone https://github.com/Ayush1298567/SEEKR.git",
      "cd SEEKR/software",
      "git pull --ff-only",
      "software/",
      "npm ci",
      "npm run setup:local",
      "npm run ai:prepare",
      "npm run doctor",
      "npm run plug-and-play",
      "npm run smoke:rehearsal:start",
      "npm run audit:source-control",
      ...REQUIRED_OPERATOR_QUICKSTART_SIGNALS.filter((signal) =>
        !REQUIRED_OPERATOR_QUICKSTART_COMMAND_ORDER.includes(signal as never)
      )
    ].join("\n");

    expect(operatorQuickstartOk(content)).toBe(false);
    expect(operatorQuickstartProblems(content)).toContain(REQUIRED_OPERATOR_QUICKSTART_COMMAND_ORDER.join(" before "));
  });

  it("rejects quickstarts that put dependency installation after local setup", () => {
    const content = [
      "git clone https://github.com/Ayush1298567/SEEKR.git",
      "cd SEEKR/software",
      "git pull --ff-only",
      "software/",
      "npm run setup:local",
      "npm run ai:prepare",
      "npm run audit:source-control",
      "npm run doctor",
      "npm run plug-and-play",
      "npm run smoke:rehearsal:start",
      "npm ci",
      ...REQUIRED_OPERATOR_QUICKSTART_SIGNALS.filter((signal) =>
        !REQUIRED_OPERATOR_QUICKSTART_COMMAND_ORDER.includes(signal as never)
      )
    ].join("\n");

    expect(operatorQuickstartOk(content)).toBe(false);
    expect(operatorQuickstartProblems(content)).toContain(REQUIRED_OPERATOR_QUICKSTART_COMMAND_ORDER.join(" before "));
  });

  it("rejects quickstarts that put bounded smoke proof before startup", () => {
    const content = [
      "git clone https://github.com/Ayush1298567/SEEKR.git",
      "cd SEEKR/software",
      "git pull --ff-only",
      "software/",
      "npm ci",
      "npm run setup:local",
      "npm run ai:prepare",
      "npm run audit:source-control",
      "npm run doctor",
      "npm run smoke:rehearsal:start",
      "npm run plug-and-play",
      ...REQUIRED_OPERATOR_QUICKSTART_SIGNALS.filter((signal) =>
        !REQUIRED_OPERATOR_QUICKSTART_COMMAND_ORDER.includes(signal as never)
      )
    ].join("\n");

    expect(operatorQuickstartOk(content)).toBe(false);
    expect(operatorQuickstartProblems(content)).toContain(REQUIRED_OPERATOR_QUICKSTART_COMMAND_ORDER.join(" before "));
  });

  it("rejects quickstarts that omit GitHub clone guidance", () => {
    const content = validQuickstartContent().replace("git clone https://github.com/Ayush1298567/SEEKR.git\n", "");

    expect(operatorQuickstartOk(content)).toBe(false);
    expect(operatorQuickstartProblems(content)).toContain("git clone https://github.com/Ayush1298567/SEEKR.git");
  });
});

function validQuickstartContent() {
  return [
    ...REQUIRED_OPERATOR_QUICKSTART_SIGNALS,
    "No real aircraft command upload.",
    "No hardware actuation."
  ].join("\n");
}
