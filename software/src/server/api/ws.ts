import http from "node:http";
import { WebSocketServer } from "ws";
import { makeEnvelope } from "../../shared/envelopes";
import type { MissionStore } from "../state";

export function attachWebSocket(server: http.Server, store: MissionStore) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket) => {
    const state = store.snapshot();
    socket.send(JSON.stringify(makeEnvelope("state.snapshot", state.missionId, state.stateSeq, state)));
  });

  function broadcastSnapshot() {
    const state = store.snapshot();
    const message = JSON.stringify(makeEnvelope("state.snapshot", state.missionId, state.stateSeq, state));
    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) client.send(message);
    });
  }

  return { wss, broadcastSnapshot };
}
