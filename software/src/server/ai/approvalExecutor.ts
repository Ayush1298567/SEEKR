import type { CommandRequest } from "../../shared/types";

export function proposalApprovalCommand(proposalId: string, commandId: string, nowMs: number): CommandRequest {
  return {
    commandId,
    kind: "ai.proposal.approve",
    target: { proposalId },
    params: { proposalId },
    requestedBy: "operator",
    idempotencyKey: `proposal-${proposalId}`,
    requestedAt: nowMs
  };
}
