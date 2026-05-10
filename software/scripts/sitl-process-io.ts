import { readFile } from "node:fs/promises";
import path from "node:path";
import { runSitlProcessIo, type SitlAutopilot } from "../src/flight";

const args = parseArgs(process.argv.slice(2));
const autopilot = parseAutopilot(args.autopilot ?? autopilotFromFixture(args.fixture) ?? "px4");
const stdout = await readInput(args);

const result = runSitlProcessIo({
  autopilot,
  stdout,
  stderr: typeof args.stderr === "string" ? args.stderr : undefined,
  exitCode: typeof args.exitCode === "string" ? Number(args.exitCode) : undefined,
  receivedAtMs: typeof args.receivedAtMs === "string" ? Number(args.receivedAtMs) : undefined
});

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

async function readInput(values: Record<string, string | boolean | undefined>) {
  if (typeof values.file === "string") return readFile(values.file, "utf8");
  if (typeof values.fixture === "string") return readFile(path.join(process.cwd(), "fixtures", "sitl", `${safeFixtureName(values.fixture)}.ndjson`), "utf8");
  if (values.stdin || !process.stdin.isTTY) return readStdin();
  throw new Error("Provide --fixture <name>, --file <path>, or --stdin");
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

function parseAutopilot(value: string): SitlAutopilot {
  if (value === "px4" || value === "ardupilot") return value;
  throw new Error("--autopilot must be px4 or ardupilot");
}

function autopilotFromFixture(value: string | boolean | undefined) {
  if (typeof value !== "string") return undefined;
  if (value.startsWith("px4")) return "px4";
  if (value.startsWith("ardupilot")) return "ardupilot";
  return undefined;
}

function safeFixtureName(value: string) {
  const safe = value.replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!safe || safe !== value) throw new Error("Invalid fixture name");
  return safe;
}

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
