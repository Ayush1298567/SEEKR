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

  it("rejects quickstarts that omit advisory AI command-safety guidance", () => {
    const content = validQuickstartContent().replace("AI output is advisory\n", "");

    expect(operatorQuickstartOk(content)).toBe(false);
    expect(operatorQuickstartProblems(content)).toContain("AI output is advisory");
  });

  it("rejects quickstarts that omit occupied-port recovery guidance", () => {
    const content = validQuickstartContent().replace("Listener diagnostics\n", "");

    expect(operatorQuickstartOk(content)).toBe(false);
    expect(operatorQuickstartProblems(content)).toContain("Listener diagnostics");
  });

  it("rejects quickstarts that put source-control audit after startup", () => {
    const content = [
      "git clone https://github.com/Ayush1298567/SEEKR.git",
      "cd SEEKR/software",
      "git pull --ff-only",
      "software/",
      "npm ci",
      "npm run setup:local",
      "npm run doctor",
      "npm run rehearsal:start",
      "npm run audit:source-control",
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
  return REQUIRED_OPERATOR_QUICKSTART_SIGNALS.join("\n");
}
