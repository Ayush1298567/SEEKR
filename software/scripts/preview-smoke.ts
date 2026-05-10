import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { AddressInfo, createServer } from "node:net";
import os from "node:os";
import path from "node:path";

const port = Number(process.env.SEEKR_PREVIEW_SMOKE_PORT ?? await freePort());
const dataDir = await mkdtemp(path.join(os.tmpdir(), "seekr-preview-smoke-"));
const server = spawn("npm", ["run", "server"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    SEEKR_DATA_DIR: dataDir,
    SEEKR_AI_PROVIDER: "rules"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
const logs: string[] = [];
server.stdout.setEncoding("utf8");
server.stderr.setEncoding("utf8");
server.stdout.on("data", (chunk: string) => logs.push(chunk));
server.stderr.on("data", (chunk: string) => logs.push(chunk));

try {
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(`${baseUrl}/api/health`, 20_000);

  const shell = await fetch(`${baseUrl}/`);
  assert(shell.ok, `preview shell returned ${shell.status}`);
  const html = await shell.text();
  assert(html.includes("SEEKR GCS"), "preview shell should contain SEEKR title");
  assert(html.includes('id="root"'), "preview shell should contain React root");

  const assetPath = html.match(/(?:src|href)="([^"]*\/assets\/[^"]+)"/)?.[1];
  assert(assetPath, "preview shell should reference a built asset");
  const asset = await fetch(`${baseUrl}${assetPath}`);
  assert(asset.ok, `built asset returned ${asset.status}`);

  const config = await json<{ safety: { commandUploadEnabled: boolean; realAdaptersReadOnly: boolean }; auth: { tokenRedacted: boolean } }>(`${baseUrl}/api/config`);
  assert(config.auth.tokenRedacted, "runtime config must redact token values");
  assert(config.safety.commandUploadEnabled === false, "runtime config must keep aircraft command upload disabled");
  assert(config.safety.realAdaptersReadOnly, "runtime config must keep real adapters read-only");

  const readiness = await json<{ ok: boolean; checks: Array<{ id: string; status: string; blocking: boolean }> }>(`${baseUrl}/api/readiness`);
  assert(readiness.ok, "preview readiness should have no blocking failures");
  assert(
    readiness.checks.some((check) => check.id === "safety-boundary" && check.status === "pass" && check.blocking),
    "preview readiness must prove the safety boundary"
  );

  console.log(JSON.stringify({ ok: true, checked: ["static-shell", "built-asset", "config", "readiness"], port }, null, 2));
} finally {
  server.kill("SIGTERM");
  await onceExit(server);
  await rm(dataDir, { recursive: true, force: true });
}

async function json<T>(url: string) {
  const response = await fetch(url);
  assert(response.ok, `${url} returned ${response.status}`);
  return (await response.json()) as T;
}

async function waitForHealth(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }
  throw new Error(`Preview server did not become healthy: ${String(lastError)}\n${logs.join("").slice(-2_000)}`);
}

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function onceExit(child: typeof server) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    delay(2_000).then(() => {
      child.kill("SIGKILL");
    })
  ]);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
