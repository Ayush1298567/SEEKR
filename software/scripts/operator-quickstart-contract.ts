export const OPERATOR_QUICKSTART_PATH = "docs/OPERATOR_QUICKSTART.md";

export const REQUIRED_OPERATOR_QUICKSTART_SIGNALS = [
  "git clone https://github.com/Ayush1298567/SEEKR.git",
  "cd SEEKR/software",
  "git pull --ff-only",
  "software/",
  "npm ci",
  "npm run setup:local",
  "npm run audit:source-control",
  "npm run doctor",
  "non-SEEKR or unhealthy listener",
  "Listener diagnostics",
  "Stop the existing process",
  "free local API/client ports",
  "npm run rehearsal:start",
  "npm run smoke:rehearsal:start",
  "Ollama",
  "ollama pull llama3.2",
  "llama3.2:latest",
  "npm run test:ai:local",
  ".tmp/ai-smoke-status.json",
  "strict local AI smoke",
  "validator pass",
  "no unsafe operator-facing text",
  "no mutation while thinking",
  "AI output is advisory",
  "validated candidate plans",
  "cannot create command payloads",
  "bypass operator validation",
  "No AI-created command payloads",
  "No operator answer bypassing validation",
  "/api/config",
  "/api/readiness",
  "/api/source-health",
  "/api/verify",
  "/api/replays",
  "command upload",
  "hardware actuation",
  "real-world blockers"
] as const;

export const REQUIRED_OPERATOR_QUICKSTART_COMMAND_ORDER = [
  "git clone https://github.com/Ayush1298567/SEEKR.git",
  "cd SEEKR/software",
  "npm ci",
  "npm run setup:local",
  "npm run audit:source-control",
  "npm run doctor",
  "npm run rehearsal:start",
  "npm run smoke:rehearsal:start"
] as const;

const OPERATOR_QUICKSTART_SAFETY_REQUIREMENTS = [
  {
    label: "non-negated command upload boundary",
    pattern: /\b(?:no\b[^.]{0,80}\bcommand upload\b|\bcommand upload\b[^.]{0,160}\b(?:disabled|blocked|locked|false|not allowed|not permitted)\b)/i,
    negatedPattern: /\bcommand upload\b[^.]{0,160}\b(?:not|never|isn't|is not|doesn't|does not|no longer)\s+(?:disabled|blocked|locked|false)\b/i,
    unsafePattern: /\bcommand upload\b[^.]{0,160}\b(?:is|are|be|becomes|become|can be|may be|could be|will be)\s+(?:enabled|allowed|permitted|authorized|true)\b/i
  },
  {
    label: "non-negated hardware actuation boundary",
    pattern: /\b(?:no\b[^.]{0,80}\bhardware actuation\b|\bhardware actuation\b[^.]{0,160}\b(?:disabled|blocked|locked|false|not allowed|not permitted)\b)/i,
    negatedPattern: /\bhardware actuation\b[^.]{0,160}\b(?:not|never|isn't|is not|doesn't|does not|no longer)\s+(?:disabled|blocked|locked|false)\b/i,
    unsafePattern: /\bhardware actuation\b[^.]{0,160}\b(?:is|are|be|becomes|become|can be|may be|could be|will be)\s+(?:enabled|allowed|permitted|authorized|true)\b/i
  }
] as const;

export function operatorQuickstartProblems(content: string) {
  const missing: string[] = REQUIRED_OPERATOR_QUICKSTART_SIGNALS.filter((signal) => !content.includes(signal));
  const problems = [...missing];
  for (const requirement of OPERATOR_QUICKSTART_SAFETY_REQUIREMENTS) {
    if (!requirement.pattern.test(content) || requirement.negatedPattern.test(content) || requirement.unsafePattern.test(content)) {
      problems.push(requirement.label);
    }
  }
  if (content && !missing.length && !operatorQuickstartCommandOrderOk(content)) {
    problems.push(REQUIRED_OPERATOR_QUICKSTART_COMMAND_ORDER.join(" before "));
  }
  return problems;
}

export function operatorQuickstartOk(content: string) {
  return content.length > 0 && operatorQuickstartProblems(content).length === 0;
}

function operatorQuickstartCommandOrderOk(content: string) {
  let lastIndex = -1;
  for (const command of REQUIRED_OPERATOR_QUICKSTART_COMMAND_ORDER) {
    const index = content.indexOf(command);
    if (index <= lastIndex) return false;
    lastIndex = index;
  }
  return true;
}
