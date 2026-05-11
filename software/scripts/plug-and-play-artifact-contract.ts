export const REQUIRED_PLUG_AND_PLAY_SETUP_CHECK_IDS = [
  "env-example",
  "env-file",
  "rehearsal-data-dir",
  "safety-boundary"
] as const;

export const REQUIRED_DOCTOR_CHECK_IDS = [
  "package-scripts",
  "runtime-dependencies",
  "repository-safety",
  "source-control-handoff",
  "operator-start",
  "operator-env",
  "local-ai",
  "local-ports",
  "data-dir",
  "safety-boundary"
] as const;

export const SOFT_DOCTOR_CHECK_IDS = new Set<string>([
  "source-control-handoff",
  "local-ports",
  "data-dir"
]);

export const REQUIRED_RUNTIME_DEPENDENCY_EVIDENCE = [
  "package.json engines.node",
  "package.json engines.npm",
  "package.json packageManager",
  "package-lock.json",
  "package-lock.json packages[\"\"].engines",
  "node_modules/.bin/tsx",
  "node_modules/.bin/concurrently",
  "node_modules/.bin/vite"
] as const;

export function plugAndPlaySetupOk(manifest: unknown) {
  if (!isRecord(manifest)) return false;
  const checks = Array.isArray(manifest.checks) ? manifest.checks.filter(isRecord) : [];
  return manifest.ok === true &&
    manifest.status === "ready-local-setup" &&
    manifest.commandUploadEnabled === false &&
    typeof manifest.envFilePath === "string" &&
    typeof manifest.dataDirPath === "string" &&
    checkIdsAreExact(checks, REQUIRED_PLUG_AND_PLAY_SETUP_CHECK_IDS) &&
    checks.every((check) => check.status === "pass");
}

export function plugAndPlayDoctorOk(manifest: unknown, acceptanceManifest?: unknown, expectedSourceControlPath?: string) {
  if (!isRecord(manifest)) return false;
  const ai = isRecord(manifest.ai) ? manifest.ai : {};
  const summary = isRecord(manifest.summary) ? manifest.summary : {};
  const checks = Array.isArray(manifest.checks) ? manifest.checks.filter(isRecord) : [];
  const doctorGeneratedAt = timeMs(manifest.generatedAt);
  const acceptanceGeneratedAt = isRecord(acceptanceManifest) ? timeMs(acceptanceManifest.generatedAt) : undefined;
  return manifest.ok === true &&
    manifest.status === "ready-local-start" &&
    (manifest.profile === undefined || manifest.profile === "operator-start") &&
    manifest.commandUploadEnabled === false &&
    ai.provider === "ollama" &&
    ai.status === "pass" &&
    Number(summary.fail) === 0 &&
    checkIdsAreExact(checks, REQUIRED_DOCTOR_CHECK_IDS) &&
    REQUIRED_DOCTOR_CHECK_IDS.every((id) => doctorCheckStatusOk(checks, id)) &&
    doctorRuntimeDependencyEvidenceOk(checks) &&
    doctorSourceControlEvidenceOk(checks, expectedSourceControlPath) &&
    doctorPortWarningEvidenceOk(checks) &&
    (acceptanceGeneratedAt === undefined || (doctorGeneratedAt !== undefined && doctorGeneratedAt >= acceptanceGeneratedAt));
}

export function doctorCheckStatusOk(checks: Record<string, unknown>[], id: string) {
  const check = checks.find((item) => item.id === id);
  if (!check) return false;
  if (check.status === "pass") return true;
  return SOFT_DOCTOR_CHECK_IDS.has(id) && check.status === "warn";
}

export function doctorRuntimeDependencyEvidenceOk(checks: Record<string, unknown>[]) {
  const check = checks.find((item) => item.id === "runtime-dependencies");
  if (!check) return false;
  const evidence = Array.isArray(check.evidence) ? check.evidence.map(String) : [];
  const details = typeof check.details === "string" ? check.details : "";
  const haystack = [details, ...evidence].join("\n");
  return REQUIRED_RUNTIME_DEPENDENCY_EVIDENCE.every((item) => haystack.includes(item));
}

export function doctorSourceControlEvidenceOk(checks: Record<string, unknown>[], expectedSourceControlPath?: string) {
  if (!expectedSourceControlPath) return true;
  const check = checks.find((item) => item.id === "source-control-handoff");
  if (!check) return false;
  const evidence = Array.isArray(check.evidence) ? check.evidence.map(String) : [];
  const details = typeof check.details === "string" ? check.details : "";
  return [details, ...evidence].some((item) => item.includes(expectedSourceControlPath));
}

export function doctorPortWarningEvidenceOk(checks: Record<string, unknown>[]) {
  const check = checks.find((item) => item.id === "local-ports");
  if (!check) return false;
  if (check.status !== "pass" && check.status !== "warn") return false;
  const evidence = Array.isArray(check.evidence) ? check.evidence.map(String) : [];
  const details = typeof check.details === "string" ? check.details : "";
  if (!/non-SEEKR or unhealthy listener/.test(details)) return true;
  const occupiedPorts = occupiedPortPairsFromDetails(details);
  const hasListenerDetails = occupiedPorts.length > 0 &&
    occupiedPorts.every(({ role, port }) => new RegExp(`${role} ${port} -> .*pid \\d+`).test(details));
  const hasPortInspectorEvidence = occupiedPorts.every(({ port }) => evidence.includes(`lsof -nP -iTCP:${port} -sTCP:LISTEN`)) &&
    evidence.some((item) => /^listener \d+ (cwd|command) /.test(item));
  if (check.status === "warn") return hasListenerDetails && hasPortInspectorEvidence;
  const hasAutoFallbackDetails = /auto-selects free local API\/client ports/.test(details);
  const hasPlugAndPlayGuidance = /npm run plug-and-play/.test(details);
  const hasAutoFallbackEvidence = evidence.some((item) => item.includes("auto-selected free local API/client ports"));
  const fallbackCandidates = fallbackCandidatesFromDetails(details);
  const hasFallbackCandidate = fallbackCandidates !== undefined &&
    validFallbackCandidates(fallbackCandidates) &&
    occupiedPorts.every(({ role, port }) => fallbackCandidates[role] !== port) &&
    occupiedPorts.every(({ role }) => evidence.includes(fallbackEvidenceFor(role, fallbackCandidates[role])));
  return hasListenerDetails && hasPortInspectorEvidence && hasAutoFallbackDetails && hasPlugAndPlayGuidance && hasAutoFallbackEvidence && hasFallbackCandidate;
}

function occupiedPortPairsFromDetails(details: string) {
  const match = details.match(/non-SEEKR or unhealthy listener: ([^.]+)\./);
  const summary = match?.[1] ?? "";
  return Array.from(summary.matchAll(/\b(api|client) (\d{1,5})\b/g)).map((item) => ({
    role: item[1] as "api" | "client",
    port: item[2]
  }));
}

function fallbackCandidatesFromDetails(details: string) {
  const match = details.match(/Current free fallback candidate\(s\): API (\d{1,5}), client (\d{1,5})/);
  if (!match) return undefined;
  return {
    api: match[1],
    client: match[2]
  };
}

function fallbackEvidenceFor(role: "api" | "client", port: string) {
  return role === "api" ? `fallback API port candidate ${port}` : `fallback client port candidate ${port}`;
}

function validFallbackCandidates(candidates: { api: string; client: string }) {
  return candidates.api !== candidates.client &&
    portIsValid(candidates.api) &&
    portIsValid(candidates.client);
}

function portIsValid(value: string) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

function timeMs(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function checkIdsAreExact(checks: Record<string, unknown>[], requiredIds: readonly string[]) {
  return checks.length === requiredIds.length &&
    checks.every((check, index) => check.id === requiredIds[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
