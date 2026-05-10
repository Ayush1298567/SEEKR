import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeFileNamePart, safeIsoTimestampForFileName } from "./artifact-paths";

type FetchLike = (input: string, init?: RequestInit) => Promise<ResponseLike>;

interface ResponseLike {
  ok: boolean;
  status: number;
  statusText?: string;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface RehearsalEndpointEvidence {
  id: string;
  route: string;
  url: string;
  ok: boolean;
  status: number;
  elapsedMs: number;
  body: unknown;
  error?: string;
}

export interface RehearsalEvidenceManifest {
  schemaVersion: 1;
  generatedAt: string;
  baseUrl: string;
  label?: string;
  commandUploadEnabled: false;
  safetyBoundary: {
    realHardwareCommandUpload: "blocked";
    mavlink: "read-only";
    ros2: "read-only";
    px4ArdupilotHardwareTransport: "blocked";
  };
  observedSafety: {
    configCommandUploadEnabled: unknown;
    sessionAcceptanceCommandUploadEnabled: unknown;
    hardwareCommandUploadEnabled: unknown;
  };
  validation: {
    ok: boolean;
    failures: string[];
    warnings: string[];
  };
  sourceEvidence: {
    required: RehearsalSourceRequirement[];
    observed: RehearsalObservedSource[];
    matched: RehearsalMatchedSource[];
    missing: string[];
  };
  evidenceSha256: string;
  endpoints: RehearsalEndpointEvidence[];
  limitations: string[];
}

export interface RehearsalSourceRequirement {
  raw: string;
  sourceAdapter: string;
  channels: string[];
  droneIds: string[];
}

export interface RehearsalObservedSource {
  id: string;
  sourceAdapter: string;
  status: string;
  channels: string[];
  eventCount: number;
  rejectedCount: number;
  droneIds: string[];
  details?: string;
}

export interface RehearsalMatchedSource {
  requirement: string;
  sourceAdapter: string;
  channels: string[];
  droneIds: string[];
  eventCount: number;
  status: string;
}

export const DEFAULT_REHEARSAL_EVIDENCE_ENDPOINTS: Array<{ id: string; route: string }> = [
  { id: "session", route: "/api/session" },
  { id: "config", route: "/api/config" },
  { id: "readiness", route: "/api/readiness" },
  { id: "hardware-readiness", route: "/api/hardware-readiness?target=jetson-orin-nano" },
  { id: "source-health", route: "/api/source-health" },
  { id: "verify", route: "/api/verify" },
  { id: "replays", route: "/api/replays" }
];

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_OUT_DIR = ".tmp/rehearsal-evidence";
const LIMITATIONS = [
  "This evidence snapshots a local running SEEKR API for operator rehearsal notes.",
  "It does not validate Jetson/Pi hardware, real MAVLink telemetry, real ROS 2 topics, HIL behavior, Isaac Sim behavior, or aircraft command authority.",
  "MAVLink and ROS 2 aircraft command upload remain blocked outside simulator/SITL transports."
];

export async function captureRehearsalEvidence(options: {
  baseUrl?: string;
  label?: string;
  generatedAt?: string;
  token?: string;
  requiredSources?: string[];
  fetchImpl?: FetchLike;
} = {}): Promise<RehearsalEvidenceManifest> {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const fetchImpl = options.fetchImpl ?? fetch;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const endpoints: RehearsalEndpointEvidence[] = [];

  for (const endpoint of DEFAULT_REHEARSAL_EVIDENCE_ENDPOINTS) {
    endpoints.push(await captureEndpoint({
      baseUrl,
      endpoint,
      fetchImpl,
      token: options.token
    }));
  }

  const observedSafety = {
    configCommandUploadEnabled: getPath(endpointBody(endpoints, "config"), ["safety", "commandUploadEnabled"]),
    sessionAcceptanceCommandUploadEnabled: getPath(endpointBody(endpoints, "session"), ["acceptance", "commandUploadEnabled"]),
    hardwareCommandUploadEnabled: getPath(endpointBody(endpoints, "hardware-readiness"), ["summary", "commandUploadEnabled"])
  };
  const sourceEvidence = buildSourceEvidence(endpointBody(endpoints, "source-health"), options.requiredSources ?? []);
  const validation = validateEvidence(endpoints, observedSafety, sourceEvidence);
  const hashInput = JSON.stringify({
    generatedAt,
    baseUrl,
    label: options.label,
    observedSafety,
    validation,
    sourceEvidence,
    endpoints
  });

  return {
    schemaVersion: 1,
    generatedAt,
    baseUrl,
    label: options.label,
    commandUploadEnabled: false,
    safetyBoundary: {
      realHardwareCommandUpload: "blocked",
      mavlink: "read-only",
      ros2: "read-only",
      px4ArdupilotHardwareTransport: "blocked"
    },
    observedSafety,
    validation,
    sourceEvidence,
    evidenceSha256: createHash("sha256").update(hashInput).digest("hex"),
    endpoints,
    limitations: LIMITATIONS
  };
}

export async function writeRehearsalEvidence(options: {
  root?: string;
  outDir?: string;
  baseUrl?: string;
  label?: string;
  generatedAt?: string;
  token?: string;
  requiredSources?: string[];
  fetchImpl?: FetchLike;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const manifest = await captureRehearsalEvidence(options);
  const safeTimestamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const safeLabel = manifest.label ? `-${safeFileNamePart(manifest.label, "run")}` : "";
  const baseName = `seekr-rehearsal-evidence${safeLabel}-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

async function captureEndpoint(options: {
  baseUrl: string;
  endpoint: { id: string; route: string };
  fetchImpl: FetchLike;
  token?: string;
}): Promise<RehearsalEndpointEvidence> {
  const startedAt = Date.now();
  const url = new URL(options.endpoint.route, `${options.baseUrl}/`).toString();
  try {
    const response = await options.fetchImpl(url, {
      headers: options.token
        ? {
            Authorization: `Bearer ${options.token}`,
            "x-seekr-token": options.token
          }
        : undefined
    });
    const body = await readResponse(response);
    return {
      id: options.endpoint.id,
      route: options.endpoint.route,
      url,
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      body,
      error: response.ok ? undefined : response.statusText ?? `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      id: options.endpoint.id,
      route: options.endpoint.route,
      url,
      ok: false,
      status: 0,
      elapsedMs: Date.now() - startedAt,
      body: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function readResponse(response: ResponseLike) {
  const contentType = response.headers?.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function validateEvidence(
  endpoints: RehearsalEndpointEvidence[],
  observedSafety: RehearsalEvidenceManifest["observedSafety"],
  sourceEvidence: RehearsalEvidenceManifest["sourceEvidence"]
) {
  const failures: string[] = [];
  const warnings: string[] = [];

  for (const endpoint of endpoints) {
    if (!endpoint.ok) {
      failures.push(`${endpoint.id} returned ${endpoint.status}${endpoint.error ? `: ${endpoint.error}` : ""}`);
    }
  }

  if (observedSafety.configCommandUploadEnabled !== false) {
    failures.push("config safety.commandUploadEnabled must be false");
  }
  if (observedSafety.sessionAcceptanceCommandUploadEnabled !== false) {
    failures.push("session acceptance.commandUploadEnabled must be false");
  }
  if (observedSafety.hardwareCommandUploadEnabled !== false) {
    failures.push("hardware-readiness summary.commandUploadEnabled must be false");
  }

  const config = endpointBody(endpoints, "config");
  if (getPath(config, ["safety", "realAdaptersReadOnly"]) !== true) {
    failures.push("config safety.realAdaptersReadOnly must be true");
  }

  const session = endpointBody(endpoints, "session");
  const acceptanceStatus = getPath(session, ["acceptance", "status"]);
  if (acceptanceStatus !== "pass") {
    warnings.push(`session acceptance.status is ${formatUnknown(acceptanceStatus)}; run npm run acceptance before a formal rehearsal`);
  }
  const acceptanceCurrentBoot = getPath(session, ["acceptance", "currentBoot"]);
  if (acceptanceCurrentBoot !== true) {
    warnings.push(`session acceptance.currentBoot is ${formatUnknown(acceptanceCurrentBoot)}; note whether the server booted after acceptance`);
  }

  const readinessBlocking = getPath(endpointBody(endpoints, "readiness"), ["summary", "blocking"]);
  if (typeof readinessBlocking === "number" && readinessBlocking > 0) {
    failures.push(`readiness has ${readinessBlocking} blocking failure${readinessBlocking === 1 ? "" : "s"}`);
  }

  const hardwareBlocking = getPath(endpointBody(endpoints, "hardware-readiness"), ["summary", "blocking"]);
  if (typeof hardwareBlocking === "number" && hardwareBlocking > 0) {
    failures.push(`hardware-readiness has ${hardwareBlocking} blocking failure${hardwareBlocking === 1 ? "" : "s"}`);
  }

  const verifyOk = getPath(endpointBody(endpoints, "verify"), ["ok"]);
  if (verifyOk !== true) {
    failures.push("verify.ok must be true");
  }

  const staleSourceIds = getPath(endpointBody(endpoints, "source-health"), ["summary", "staleSourceIds"]);
  if (Array.isArray(staleSourceIds) && staleSourceIds.length > 0) {
    warnings.push(`source-health reports stale or missing sources: ${staleSourceIds.join(", ")}`);
  }

  for (const missing of sourceEvidence.missing) {
    failures.push(`required source was not observed with fresh events: ${missing}`);
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings
  };
}

function buildSourceEvidence(sourceHealthBody: unknown, requiredSourceValues: string[]): RehearsalEvidenceManifest["sourceEvidence"] {
  const observed = observedSources(sourceHealthBody);
  const required = requiredSourceValues.flatMap((value) =>
    value.split(",").map((item) => item.trim()).filter(Boolean).map(parseRequiredSource)
  );
  const matched: RehearsalMatchedSource[] = [];
  const missing: string[] = [];

  for (const requirement of required) {
    const source = observed.find((candidate) => sourceMatches(candidate, requirement));
    if (!source) {
      missing.push(formatRequiredSource(requirement));
      continue;
    }
    matched.push({
      requirement: requirement.raw,
      sourceAdapter: source.sourceAdapter,
      channels: source.channels,
      droneIds: source.droneIds,
      eventCount: source.eventCount,
      status: source.status
    });
  }

  return { required, observed, matched, missing };
}

function observedSources(sourceHealthBody: unknown): RehearsalObservedSource[] {
  const body = isRecord(sourceHealthBody) ? sourceHealthBody : {};
  const sources = Array.isArray(body.sources) ? body.sources : [];
  return sources.filter(isRecord).map((source) => ({
    id: stringValue(source.id),
    sourceAdapter: stringValue(source.sourceAdapter || source.id),
    status: stringValue(source.status, "unknown"),
    channels: stringArray(source.channels),
    eventCount: numberValue(source.eventCount),
    rejectedCount: numberValue(source.rejectedCount),
    droneIds: stringArray(source.droneIds),
    details: typeof source.details === "string" ? source.details : undefined
  })).filter((source) => source.sourceAdapter);
}

function parseRequiredSource(raw: string): RehearsalSourceRequirement {
  const [sourceAdapter = "", channelText = "", droneText = ""] = raw.split(":", 3);
  return {
    raw,
    sourceAdapter: sourceAdapter.trim(),
    channels: channelText ? channelText.split("+").map((channel) => channel.trim()).filter(Boolean) : [],
    droneIds: droneText ? droneText.split("|").map((droneId) => droneId.trim()).filter(Boolean) : []
  };
}

function sourceMatches(source: RehearsalObservedSource, requirement: RehearsalSourceRequirement) {
  const requiredAdapter = requirement.sourceAdapter.toLowerCase();
  const adapterMatches = source.sourceAdapter.toLowerCase() === requiredAdapter || source.id.toLowerCase() === requiredAdapter;
  if (!adapterMatches) return false;
  if (source.eventCount <= 0) return false;
  if (source.status !== "pass") return false;
  if (requirement.channels.some((channel) => !source.channels.includes(channel))) return false;
  if (requirement.droneIds.some((droneId) => !source.droneIds.includes(droneId))) return false;
  return true;
}

function formatRequiredSource(requirement: RehearsalSourceRequirement) {
  const parts = [requirement.sourceAdapter || "unknown-source"];
  if (requirement.channels.length) parts.push(`channels ${requirement.channels.join("+")}`);
  if (requirement.droneIds.length) parts.push(`drones ${requirement.droneIds.join("|")}`);
  return `${parts.join(" ")} (${requirement.raw})`;
}

function endpointBody(endpoints: RehearsalEndpointEvidence[], id: string) {
  return endpoints.find((endpoint) => endpoint.id === id)?.body;
}

function getPath(value: unknown, segments: string[]): unknown {
  let current = value;
  for (const segment of segments) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function renderMarkdown(manifest: RehearsalEvidenceManifest) {
  const endpointRows = manifest.endpoints.map((endpoint) =>
    `| ${endpoint.id} | ${endpoint.status} | ${endpoint.ok ? "ok" : "fail"} | ${endpoint.elapsedMs} |`
  );
  return `${[
    "# SEEKR Rehearsal Evidence",
    "",
    `Generated at: ${manifest.generatedAt}`,
    `Base URL: ${manifest.baseUrl}`,
    manifest.label ? `Label: ${manifest.label}` : undefined,
    `Validation: ${manifest.validation.ok ? "pass" : "fail"}`,
    `Evidence SHA-256: ${manifest.evidenceSha256}`,
    "",
    "Command upload enabled: false",
    "",
    "Safety boundary:",
    "",
    "- Real hardware command upload: blocked",
    "- MAVLink integration: read-only",
    "- ROS 2 integration: read-only",
    "- PX4/ArduPilot hardware transport: blocked",
    "",
    "Limitations:",
    "",
    ...manifest.limitations.map((limitation) => `- ${limitation}`),
    "",
    "Validation failures:",
    "",
    ...(manifest.validation.failures.length ? manifest.validation.failures.map((failure) => `- ${failure}`) : ["- None"]),
    "",
    "Validation warnings:",
    "",
    ...(manifest.validation.warnings.length ? manifest.validation.warnings.map((warning) => `- ${warning}`) : ["- None"]),
    "",
    "Required source evidence:",
    "",
    ...(manifest.sourceEvidence.required.length
      ? manifest.sourceEvidence.required.map((source) => `- ${formatRequiredSource(source)}`)
      : ["- None"]),
    "",
    "Observed source evidence:",
    "",
    ...(manifest.sourceEvidence.observed.length
      ? manifest.sourceEvidence.observed.map((source) => `- ${source.sourceAdapter}: ${source.status}, ${source.eventCount} event${source.eventCount === 1 ? "" : "s"}, channels ${source.channels.join("+") || "none"}${source.droneIds.length ? `, drones ${source.droneIds.join(", ")}` : ""}`)
      : ["- None"]),
    "",
    "Endpoints:",
    "",
    "| Endpoint | Status | Result | Elapsed ms |",
    "| --- | ---: | --- | ---: |",
    ...endpointRows,
    ""
  ].filter((line): line is string => typeof line === "string").join("\n")}\n`;
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function formatUnknown(value: unknown) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "unknown";
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function parseArgs(values: string[]) {
  const parsed: Record<string, string | boolean | undefined> = {};
  for (let index = 0; index < values.length; index += 1) {
    const arg = values[index];
    if (!arg.startsWith("--")) continue;
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (typeof inlineValue === "string") parsed[rawKey] = inlineValue;
    else if (values[index + 1] && !values[index + 1].startsWith("--")) parsed[rawKey] = values[++index];
    else parsed[rawKey] = true;
  }
  return parsed;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = parseArgs(process.argv.slice(2));
  const result = await writeRehearsalEvidence({
    baseUrl: typeof args["base-url"] === "string" ? args["base-url"] : undefined,
    outDir: typeof args.out === "string" ? args.out : undefined,
    label: typeof args.label === "string" ? args.label : undefined,
    generatedAt: typeof args.generatedAt === "string" ? args.generatedAt : undefined,
    token: typeof args.token === "string" ? args.token : process.env.SEEKR_INTERNAL_TOKEN,
    requiredSources: typeof args["require-source"] === "string" ? [args["require-source"]] : undefined
  });
  console.log(JSON.stringify({
    ok: result.manifest.validation.ok,
    commandUploadEnabled: result.manifest.commandUploadEnabled,
    validation: result.manifest.validation,
    sourceEvidence: {
      required: result.manifest.sourceEvidence.required.length,
      matched: result.manifest.sourceEvidence.matched.length,
      missing: result.manifest.sourceEvidence.missing
    },
    evidenceSha256: result.manifest.evidenceSha256,
    jsonPath: result.jsonPath,
    markdownPath: result.markdownPath
  }, null, 2));
  if (!result.manifest.validation.ok) process.exitCode = 1;
}
