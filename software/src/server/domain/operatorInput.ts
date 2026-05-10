import type { MissionState, OperatorInputRequest } from "../../shared/types";
import { deterministicId } from "./ids";

export function buildOperatorInputRequest(
  state: MissionState,
  questionOverride?: string,
  generatedAt = Date.now()
): OperatorInputRequest {
  const candidate = pickPromptCandidate(state);
  const question = sanitizeQuestion(questionOverride) ?? candidate.question;

  return {
    requestId: deterministicId("operator-input", state.missionId, state.stateSeq, question, generatedAt),
    missionId: state.missionId,
    stateSeq: state.stateSeq,
    generatedAt,
    mode: "operator-input-request",
    urgency: candidate.urgency,
    question,
    rationale: candidate.rationale,
    refs: candidate.refs,
    options: candidate.options,
    safetyNotes: [
      "This request is advisory and does not mutate mission state.",
      "Operator answers are not executed as commands; any mission change must go through validators.",
      "Do not paste credentials, network endpoints, or real aircraft command secrets into local notes."
    ]
  };
}

function pickPromptCandidate(state: MissionState): Omit<OperatorInputRequest, "requestId" | "missionId" | "stateSeq" | "generatedAt" | "mode" | "safetyNotes"> {
  const detection = state.detections.find((candidate) => candidate.review === "new" && candidate.severity === "P1") ??
    state.detections.find((candidate) => candidate.review === "new");
  if (detection) {
    return {
      urgency: detection.severity,
      question: `Should ${detection.id} be confirmed, marked false-positive, or assigned for follow-up review?`,
      rationale: `${detection.kind} detection is still unreviewed at ${Math.round(detection.confidence)}% confidence.`,
      refs: [`detection:${detection.id}`, `drone:${detection.droneId}`],
      options: [
        { label: "Confirm", value: "confirmed", effect: "Marks the detection as confirmed through the normal review command." },
        { label: "False positive", value: "false-positive", effect: "Marks the detection as false-positive through the normal review command." },
        { label: "Follow up", value: "needs-follow-up", effect: "Keeps the detection visible for a later focused-search proposal." }
      ]
    };
  }

  if (state.metrics.conflictCells > 0) {
    return {
      urgency: "P2",
      question: "Should the current map conflict area be treated as a local planning hazard?",
      rationale: `${state.metrics.conflictCells} conflict cells are present; an operator should review sources before planning through the area.`,
      refs: ["map:conflicts"],
      options: [
        { label: "Monitor", value: "monitor", effect: "Keeps the conflict in the watch list." },
        { label: "Draft no-fly", value: "draft-no-fly", effect: "Use the existing no-fly draft path for operator approval." }
      ]
    };
  }

  const weakSpatial = state.spatialAssets.find((asset) => asset.transformConfidence < 0.65 || asset.confidence < 0.7);
  if (weakSpatial) {
    return {
      urgency: "P2",
      question: `Is ${weakSpatial.assetId} reliable enough to use as operator context?`,
      rationale: `${weakSpatial.kind} has confidence ${Math.round(weakSpatial.confidence * 100)}% and transform ${Math.round(weakSpatial.transformConfidence * 100)}%.`,
      refs: [`spatial:${weakSpatial.assetId}`],
      options: [
        { label: "Use cautiously", value: "use-cautiously", effect: "Keep it visible but treat as advisory context." },
        { label: "Ignore", value: "ignore", effect: "Do not use this asset for search briefing." }
      ]
    };
  }

  const lowestZone = [...state.zones].filter((zone) => zone.status !== "complete").sort((a, b) => a.coverage - b.coverage)[0];
  return {
    urgency: lowestZone?.priority ?? "P3",
    question: lowestZone
      ? `Continue passive monitoring of ${lowestZone.name} before drafting new assignments?`
      : "Continue passive monitoring with the current mission picture?",
    rationale: lowestZone
      ? `${lowestZone.name} is the lowest-coverage active zone at ${lowestZone.coverage}%.`
      : "No unreviewed detections, conflicts, or weak spatial assets require immediate operator clarification.",
    refs: lowestZone ? [`zone:${lowestZone.id}`] : [`mission:${state.missionId}`],
    options: [
      { label: "Continue", value: "continue", effect: "No mission state change." },
      { label: "Generate proposal", value: "generate-proposal", effect: "Use the existing AI proposal path and validators." }
    ]
  };
}

function sanitizeQuestion(value: string | undefined) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  if (!text) return undefined;
  const lower = text.toLowerCase();
  if (lower.includes("/api/commands") || lower.includes("curl ") || lower.includes("upload mission") || lower.includes("bypass validator")) return undefined;
  return text;
}
