import type { CommandKind, DetectionReview, DroneAction, MissionState, OperatorInputRequest, PassivePlan, ReadinessReport, ReplayManifest, RuntimeConfig, SessionManifest, SourceHealthReport, SpatialAsset, TrustMode, Vec3 } from "../shared/types";
import type { WebSocketEnvelope } from "../shared/envelopes";

export interface ScenarioSummary {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  seed?: number;
}

export interface ReplaySession {
  ok: true;
  mode: "replay";
  replayId: string;
  currentSeq: number;
  totalEventCount: number;
  playing: boolean;
  speed: number;
  finalStateHash: string;
  state: MissionState;
}

export interface ReplaySummary {
  replayId: string;
  missionId: string;
  scenarioId: string;
  exportedAt: number;
  schemaVersion: number;
  softwareVersion: string;
  eventCount: number;
  finalStateHash: string;
  integrity?: {
    ok: boolean;
    errors: string[];
    warnings: string[];
  };
}

export interface AiStatus {
  ok: boolean;
  provider: string;
  model: string;
  availableModels?: string[];
  reason?: string;
}

export interface SpatialPreviewPoint extends Vec3 {
  intensity: number;
  color: string;
}

export interface SpatialPreview {
  assetId: string;
  kind: SpatialAsset["kind"];
  mode: "points" | "mesh" | "video" | "pose";
  uri?: string;
  previewUri?: string;
  timeRange?: { startMs: number; endMs: number };
  bounds?: { x: number; y: number; width: number; height: number };
  points: SpatialPreviewPoint[];
  generated: boolean;
}

export interface ImportSummary {
  ok: boolean;
  importId: string;
  kind: string;
  counts: Record<string, number>;
  rejected: Array<{ index: number; type: string; reason: string }>;
  stateSeq: number;
  finalStateHash: string;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = requestHeaders(options.headers, { "Content-Type": "application/json" });
  const response = await fetch(path, {
    ...options,
    headers
  });

  if (!response.ok) {
    throw new Error(await responseError(response));
  }

  return (await response.json()) as T;
}

export async function textApi(path: string, options: RequestInit = {}) {
  const headers = requestHeaders(options.headers);
  const response = await fetch(path, {
    ...options,
    headers
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.text();
}

export const commands = {
  state: () => api<MissionState>("/api/state"),
  session: () => api<SessionManifest>("/api/session"),
  config: () => api<RuntimeConfig>("/api/config"),
  aiStatus: () => api<AiStatus>("/api/ai/status"),
  scenarios: () => api<ScenarioSummary[]>("/api/scenarios"),
  loadScenario: (id: string) => submitCommand("scenario.load", { scenarioId: id }, { scenarioId: id }),
  start: () => submitCommand("mission.start"),
  pause: () => submitCommand("mission.pause"),
  reset: () => submitCommand("mission.reset"),
  trustMode: (mode: TrustMode) => submitCommand("trust.set", {}, { mode }),
  droneAction: (droneId: string, action: DroneAction) =>
    submitCommand("drone.action", { droneId }, { droneId, action }),
  assignZone: (droneId: string, zoneId: string) =>
    submitCommand("zone.assign", { droneId, zoneId }, { droneId, zoneId }),
  addNoFlyZone: (bounds: { x: number; y: number; width: number; height: number }, reason = "Operator no-fly zone") =>
    submitCommand("no_fly_zone.add", { bounds }, { bounds, reason }),
  reviewDetection: (detectionId: string, review: DetectionReview) =>
    submitCommand("detection.review", { detectionId }, { detectionId, review }),
  acknowledgeAlert: (alertId: string) => submitCommand("alert.ack", { alertId }, { alertId }),
  propose: () => api<{ ok: true; state: MissionState }>("/api/ai/proposals", { method: "POST" }).then((result) => result.state),
  approveProposal: (proposalId: string) =>
    submitCommand("ai.proposal.approve", { proposalId }, { proposalId }),
  exportMission: (missionId: string) => api<ReplayManifest>(`/api/missions/${missionId}/export`),
  missionReport: (missionId: string) => textApi(`/api/missions/${missionId}/report`, { headers: { Accept: "text/markdown" } }),
  incidentLog: (missionId: string) => textApi(`/api/missions/${missionId}/incident-log`, { headers: { Accept: "text/markdown" } }),
  verifyMission: (missionId: string) => api<{ ok: boolean; finalStateHash: string; eventCount: number; errors: string[] }>(`/api/missions/${missionId}/verify`),
  passivePlan: () => api<{ ok: true; plan: PassivePlan }>("/api/passive-plan"),
  operatorInputRequest: () => api<{ ok: true; request: OperatorInputRequest }>("/api/operator-input-request"),
  readiness: () => api<ReadinessReport>("/api/readiness"),
  sourceHealth: () => api<SourceHealthReport>("/api/source-health"),
  spatialAssets: () => api<{ ok: true; assets: SpatialAsset[] }>("/api/spatial-assets"),
  spatialAsset: (assetId: string) => api<{ ok: true; asset: SpatialAsset }>(`/api/spatial-assets/${assetId}`),
  spatialPreview: (assetId: string) => api<{ ok: true; preview: SpatialPreview }>(`/api/spatial-assets/${assetId}/preview`),
  importSpatialManifest: (payload: unknown) =>
    api<{ ok: boolean; summary: ImportSummary; state: MissionState }>("/api/import/spatial-manifest", { method: "POST", body: JSON.stringify(payload) }),
  importRosbagLite: (payload: unknown) =>
    api<{ ok: boolean; summary: ImportSummary; state: MissionState }>("/api/import/rosbag-lite", { method: "POST", body: JSON.stringify(payload) }),
  importFixture: (name: string) =>
    api<{ ok: boolean; summary: ImportSummary; state: MissionState }>(`/api/import/fixtures/${name}`, { method: "POST", body: "{}" }),
  replays: () => api<ReplaySummary[]>("/api/replays"),
  verifyReplay: (replayId: string) => api<{ ok: true; replayId: string; integrity: NonNullable<ReplaySummary["integrity"]> }>(`/api/replays/${replayId}/verify`),
  startReplay: (replayId: string, seq?: number, speed = 1) =>
    api<ReplaySession>(`/api/replays/${replayId}/start`, { method: "POST", body: JSON.stringify({ seq, speed }) }),
  seekReplay: (replayId: string, seq: number) =>
    api<ReplaySession>(`/api/replays/${replayId}/seek`, { method: "POST", body: JSON.stringify({ seq }) })
};

export function stateSocket(onState: (state: MissionState) => void, onStatus: (status: "connected" | "disconnected") => void) {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  let socket: WebSocket | undefined;
  let closed = false;
  let retryTimer: number | undefined;

  const connect = () => {
    socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
    socket.addEventListener("open", () => onStatus("connected"));
    socket.addEventListener("close", () => {
      onStatus("disconnected");
      if (!closed) retryTimer = window.setTimeout(connect, 750);
    });
    socket.addEventListener("error", () => {
      onStatus("disconnected");
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data as string) as WebSocketEnvelope | { type: string; payload: MissionState };
      if (message.type === "state.snapshot" || message.type === "state") onState(message.payload as MissionState);
    });
  };
  connect();

  return () => {
    closed = true;
    if (retryTimer) window.clearTimeout(retryTimer);
    socket?.close();
  };
}

async function submitCommand(kind: CommandKind, target: Record<string, unknown> = {}, params: Record<string, unknown> = {}) {
  const result = await api<{ state: MissionState }>("/api/commands", {
    method: "POST",
    body: JSON.stringify({ kind, target, params, requestedBy: "operator" })
  });
  return result.state;
}

async function responseError(response: Response) {
  const text = await response.text();
  if (!text) return `${response.status} ${response.statusText}`;
  try {
    const body = JSON.parse(text) as { error?: unknown; validation?: { blockers?: unknown[] } };
    if (body.validation?.blockers?.length) return `${response.status} ${body.validation.blockers.join("; ")}`;
    if (body.error) return `${response.status} ${String(body.error)}`;
  } catch {
    return `${response.status} ${text.slice(0, 180)}`;
  }
  return `${response.status} ${response.statusText}`;
}

function authHeaders() {
  const token =
    typeof window === "undefined"
      ? undefined
      : window.localStorage.getItem("seekr.internalToken") ?? ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_SEEKR_INTERNAL_TOKEN);
  return token ? { "x-seekr-token": token } : {};
}

function requestHeaders(existing?: HeadersInit, defaults: Record<string, string> = {}) {
  const headers = new Headers(existing);
  Object.entries(defaults).forEach(([key, value]) => headers.set(key, value));
  Object.entries(authHeaders()).forEach(([key, value]) => headers.set(key, value));
  return headers;
}
