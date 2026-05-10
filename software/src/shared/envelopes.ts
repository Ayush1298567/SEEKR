import { z } from "zod";

export const WebSocketEnvelopeSchema = z.object({
  type: z.enum(["state.snapshot", "state.delta", "event", "command.update", "replay.tick"]),
  missionId: z.string(),
  seq: z.number().int().nonnegative(),
  sentAt: z.number(),
  payload: z.unknown()
});

export type WebSocketEnvelope = z.infer<typeof WebSocketEnvelopeSchema>;

export function makeEnvelope(type: WebSocketEnvelope["type"], missionId: string, seq: number, payload: unknown): WebSocketEnvelope {
  return {
    type,
    missionId,
    seq,
    sentAt: Date.now(),
    payload
  };
}
