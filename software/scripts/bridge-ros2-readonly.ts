import { runRos2ReadOnlyBridge } from "../src/server/bridges/readOnlyBridge";

const args = parseArgs(process.argv.slice(2));
const result = await runRos2ReadOnlyBridge({
  baseUrl: args["base-url"],
  dryRun: Boolean(args["dry-run"]),
  fixtureNames: listArg(args.fixture),
  inputPath: args.file,
  inputText: args.stdin ? await readStdin() : undefined,
  ros2Topic: typeof args.topic === "string" ? args.topic : undefined,
  internalToken: args.token,
  receivedAt: args["received-at"] ? Number(args["received-at"]) : undefined,
  missionId: args["mission-id"]
});

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

function parseArgs(values: string[]) {
  const parsed: Record<string, string | boolean> = {};
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

function listArg(value: string | boolean | undefined) {
  if (typeof value !== "string") return undefined;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

async function readStdin() {
  process.stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}
