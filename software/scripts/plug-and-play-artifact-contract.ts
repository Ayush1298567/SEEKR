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
  const checkIds = new Set(checks.map((check) => String(check.id ?? "")));
  return manifest.ok === true &&
    manifest.status === "ready-local-setup" &&
    manifest.commandUploadEnabled === false &&
    typeof manifest.envFilePath === "string" &&
    typeof manifest.dataDirPath === "string" &&
    REQUIRED_PLUG_AND_PLAY_SETUP_CHECK_IDS.every((id) => checkIds.has(id)) &&
    checks.every((check) => check.status === "pass");
}

export function plugAndPlayDoctorOk(manifest: unknown, acceptanceManifest?: unknown) {
  if (!isRecord(manifest)) return false;
  const ai = isRecord(manifest.ai) ? manifest.ai : {};
  const summary = isRecord(manifest.summary) ? manifest.summary : {};
  const checks = Array.isArray(manifest.checks) ? manifest.checks.filter(isRecord) : [];
  const checkIds = new Set(checks.map((check) => String(check.id ?? "")));
  const doctorGeneratedAt = timeMs(manifest.generatedAt);
  const acceptanceGeneratedAt = isRecord(acceptanceManifest) ? timeMs(acceptanceManifest.generatedAt) : undefined;
  return manifest.ok === true &&
    manifest.status === "ready-local-start" &&
    (manifest.profile === undefined || manifest.profile === "operator-start") &&
    manifest.commandUploadEnabled === false &&
    ai.provider === "ollama" &&
    ai.status === "pass" &&
    Number(summary.fail) === 0 &&
    REQUIRED_DOCTOR_CHECK_IDS.every((id) => checkIds.has(id)) &&
    REQUIRED_DOCTOR_CHECK_IDS.every((id) => doctorCheckStatusOk(checks, id)) &&
    doctorRuntimeDependencyEvidenceOk(checks) &&
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

function timeMs(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
