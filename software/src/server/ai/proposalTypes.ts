import type { MissionPlan } from "../../shared/types";

export interface ProposalCandidate {
  plan: MissionPlan;
  title: string;
  rationale: string;
}

export interface ProposalDecision {
  candidateIndex: number;
  title?: string;
  rationale?: string;
  provider: string;
  model: string;
  raw?: unknown;
}

export type ProposalDecisionProvider = (input: {
  stateSummary: unknown;
  candidates: ProposalCandidate[];
  nowMs: number;
}) => Promise<ProposalDecision | undefined>;
