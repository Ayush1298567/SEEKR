import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface LocalEnvLoadResult {
  loaded: boolean;
  path: string;
  applied: string[];
  skipped: string[];
  reason?: "disabled" | "missing" | "outside-root" | "unreadable";
}

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function loadLocalEnv(options: { root?: string; file?: string } = {}): LocalEnvLoadResult {
  const root = path.resolve(options.root ?? process.cwd());
  const requestedFile = options.file ?? process.env.SEEKR_ENV_FILE ?? ".env";
  const envPath = path.isAbsolute(requestedFile) ? path.resolve(requestedFile) : path.resolve(root, requestedFile);

  if (process.env.SEEKR_LOAD_DOTENV === "false") {
    return { loaded: false, path: envPath, applied: [], skipped: [], reason: "disabled" };
  }
  if (!isInsideRoot(root, envPath)) {
    return { loaded: false, path: envPath, applied: [], skipped: [], reason: "outside-root" };
  }
  if (!existsSync(envPath)) {
    return { loaded: false, path: envPath, applied: [], skipped: [], reason: "missing" };
  }

  try {
    const parsed = parseEnvContent(readFileSync(envPath, "utf8"));
    const applied: string[] = [];
    const skipped: string[] = [];
    for (const [key, value] of parsed) {
      if (Object.prototype.hasOwnProperty.call(process.env, key)) {
        skipped.push(key);
        continue;
      }
      process.env[key] = value;
      applied.push(key);
    }
    return { loaded: true, path: envPath, applied, skipped };
  } catch {
    return { loaded: false, path: envPath, applied: [], skipped: [], reason: "unreadable" };
  }
}

export function parseEnvContent(content: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const separator = normalized.indexOf("=");
    if (separator <= 0) continue;
    const key = normalized.slice(0, separator).trim();
    if (!ENV_KEY.test(key)) continue;
    entries.push([key, parseEnvValue(normalized.slice(separator + 1).trim())]);
  }
  return entries;
}

function parseEnvValue(value: string) {
  const quote = value.at(0);
  if ((quote === "\"" || quote === "'") && value.endsWith(quote)) {
    const unquoted = value.slice(1, -1);
    return quote === "\"" ? unquoted.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, "\"").replace(/\\\\/g, "\\") : unquoted;
  }
  return value.replace(/\s+#.*$/, "");
}

function isInsideRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}
