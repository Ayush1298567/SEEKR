import express from "express";
import { existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { jsonBodyErrorHandler } from "./api/errors";
import { createApiRouter } from "./api/routes";
import { attachWebSocket } from "./api/ws";
import { MissionPersistence } from "./persistence";
import { MissionStore } from "./state";
import { loadLocalEnv } from "./env";
import { summarizeStartupValidationErrors } from "./startupLog";

loadLocalEnv();

const PORT = Number(process.env.PORT ?? 8787);
const app = express();
const server = http.createServer(app);
const persistence = new MissionPersistence();
await persistence.init();

const store = new MissionStore({ eventStore: persistence.events });
const persistedEvents = await persistence.events.readPersisted();
if (persistedEvents.length) {
  const restore = store.restoreFromEvents(persistedEvents);
  if (!restore.ok) {
    console.error("SEEKR startup hash-chain validation failed; persisted log was not loaded", summarizeStartupValidationErrors(restore.errors));
  } else {
    console.log(`SEEKR restored ${persistedEvents.length} persisted mission events`);
  }
}
const { broadcastSnapshot } = attachWebSocket(server, store);

app.use(express.json({ limit: "2mb" }));
app.use(jsonBodyErrorHandler);
app.use("/api", createApiRouter(store, persistence));

const distDir = path.join(process.cwd(), "dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api(?:\/|$)|\/ws(?:\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

store.onEvent((event) => {
  persistence.events.persistEvent(event).catch((error: unknown) => {
    console.error("Failed to persist mission event", error);
  });
  if (store.snapshot().evidenceAssets.length) {
    store.snapshot().evidenceAssets.forEach((asset) => persistence.evidence.add(asset));
  }
  broadcastSnapshot();
});

let lastSnapshotWrite = 0;
setInterval(() => {
  store.tick(1);
  if (Date.now() - lastSnapshotWrite > 2_000) {
    lastSnapshotWrite = Date.now();
    persistence.writeSnapshot(store.snapshot()).catch((error: unknown) => {
      console.error("Failed to persist mission snapshot", error);
    });
  }
}, 1000);

server.listen(PORT, "127.0.0.1", () => {
  console.log(`SEEKR GCS server listening on http://127.0.0.1:${PORT}`);
});
