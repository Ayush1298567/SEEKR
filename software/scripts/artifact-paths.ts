import path from "node:path";

const ISO_UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function safeIsoTimestampForFileName(value: string, fieldName = "generatedAt") {
  if (!ISO_UTC_TIMESTAMP_PATTERN.test(value) || !isNormalizedIsoUtcTimestamp(value)) {
    throw new Error(`${fieldName} must be an ISO UTC timestamp.`);
  }
  return value.replace(/[:.]/g, "-");
}

export function safeFileNamePart(value: string, fallback: string) {
  const sanitized = sanitizeFileNamePart(value);
  if (sanitized && sanitized !== "." && sanitized !== "..") return sanitized;

  const sanitizedFallback = sanitizeFileNamePart(fallback);
  if (sanitizedFallback && sanitizedFallback !== "." && sanitizedFallback !== "..") return sanitizedFallback;
  return "artifact";
}

export function resolveArtifactOutDir(root: string, outDir: string, fieldName = "artifact output directory") {
  const resolved = path.resolve(root, outDir);
  if (!isInsideRoot(root, resolved)) {
    throw new Error(`${fieldName} must stay inside the project root.`);
  }
  return resolved;
}

export function resolveProjectInputPath(root: string, inputPath: string, fieldName = "artifact input path") {
  const trimmed = inputPath.trim();
  if (!trimmed) throw new Error(`${fieldName} is required.`);
  const resolved = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(root, trimmed);
  if (!isInsideRoot(root, resolved)) {
    throw new Error(`${fieldName} must stay inside the project root.`);
  }
  return resolved;
}

function sanitizeFileNamePart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function isInsideRoot(root: string, absolutePath: string) {
  const relative = path.relative(root, absolutePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isNormalizedIsoUtcTimestamp(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  const canonical = parsed.toISOString();
  return value.includes(".") ? canonical === value : canonical.replace(".000Z", "Z") === value;
}
