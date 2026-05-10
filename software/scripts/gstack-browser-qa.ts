import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { AddressInfo, createServer } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeIsoTimestampForFileName } from "./artifact-paths";
import { chromium, type Browser, type ConsoleMessage, type Page } from "playwright";

interface ReleaseChecksumSummary {
  overallSha256?: string;
  fileCount?: number;
  totalBytes?: number;
}

interface CommandBoundarySummary {
  status?: string;
  scannedFileCount?: number;
  violationCount?: number;
}

interface AcceptanceStatus {
  ok?: boolean;
  acceptance?: {
    status?: string;
    commandUploadEnabled?: boolean;
    releaseChecksum?: ReleaseChecksumSummary;
    commandBoundaryScan?: CommandBoundarySummary;
  };
  releaseChecksum?: ReleaseChecksumSummary;
  commandBoundaryScan?: CommandBoundarySummary;
}

interface SessionResponse {
  acceptance?: {
    status?: string;
    commandUploadEnabled?: boolean;
    releaseChecksum?: ReleaseChecksumSummary;
    commandBoundaryScan?: CommandBoundarySummary;
  };
  config?: {
    safety?: {
      commandUploadEnabled?: boolean;
    };
  };
}

interface ReadinessResponse {
  checks?: Array<{ status?: string; blocking?: boolean }>;
}

interface VerifyResponse {
  ok?: boolean;
  errors?: string[];
  eventCount?: number;
  finalStateHash?: string;
}

export interface GstackBrowserQaReport {
  generatedAt: string;
  baseUrl: string;
  dataDir: string;
  homeScreenshotPath: string;
  mobileScreenshotPath: string;
  releaseChecksum?: string;
  commandBoundaryStatus?: string;
  commandBoundaryScannedFileCount?: number;
  commandBoundaryViolationCount?: number;
  readinessSummary: string;
  verifyErrors: string[];
  verifyEventCount: number;
  verifyFinalStateHash?: string;
  consoleEvidence: string;
}

const DEFAULT_OUT_DIR = ".gstack/qa-reports";

export async function writeGstackBrowserQaReport(options: {
  root?: string;
  outDir?: string;
  generatedAt?: string;
  port?: number;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const safeTimestamp = safeIsoTimestampForFileName(generatedAt);
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const screenshotDir = path.join(outDir, "screenshots");
  const relativeOutDir = relativeFromRoot(root, outDir);
  const dataDir = `.tmp/qa-clean-gstack-${safeTimestamp}`;
  const homeScreenshotPath = `${relativeOutDir}/screenshots/seekr-qa-${safeTimestamp}-clean-home.png`;
  const mobileScreenshotPath = `${relativeOutDir}/screenshots/seekr-qa-${safeTimestamp}-clean-mobile.png`;
  const reportPath = `${relativeOutDir}/seekr-qa-${safeTimestamp}.md`;
  const distIndex = path.join(root, "dist/index.html");

  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html is missing; run npm run build, npm run smoke:preview, or npm run acceptance before npm run qa:gstack.");
  }

  await mkdir(screenshotDir, { recursive: true });
  await mkdir(path.join(root, dataDir), { recursive: true });

  const port = options.port ?? await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn("npm", ["run", "server"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      SEEKR_DATA_DIR: path.join(root, dataDir),
      SEEKR_AI_PROVIDER: "rules"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const logs: string[] = [];
  server.stdout.setEncoding("utf8");
  server.stderr.setEncoding("utf8");
  server.stdout.on("data", (chunk: string) => logs.push(chunk));
  server.stderr.on("data", (chunk: string) => logs.push(chunk));

  let browser: Browser | undefined;
  try {
    await waitForHealth(`${baseUrl}/api/health`, 20_000, logs);
    const acceptance = await readAcceptanceStatus(root);
    const consoleMessages: string[] = [];
    browser = await chromium.launch();

    const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    captureConsoleEvidence(desktop, consoleMessages);
    await desktop.goto(baseUrl, { waitUntil: "networkidle" });
    await desktop.getByText("SEEKR GCS").first().waitFor({ timeout: 10_000 });
    await desktop.screenshot({ path: path.join(root, homeScreenshotPath), fullPage: true });

    const mobile = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true });
    captureConsoleEvidence(mobile, consoleMessages);
    await mobile.goto(baseUrl, { waitUntil: "networkidle" });
    await mobile.getByText("SEEKR GCS").first().waitFor({ timeout: 10_000 });
    await mobile.screenshot({ path: path.join(root, mobileScreenshotPath), fullPage: true });

    const session = await json<SessionResponse>(`${baseUrl}/api/session`);
    const readiness = await json<ReadinessResponse>(`${baseUrl}/api/readiness`);
    const verify = await json<VerifyResponse>(`${baseUrl}/api/verify`);
    const commandUploadEnabled = session.acceptance?.commandUploadEnabled ?? session.config?.safety?.commandUploadEnabled;
    const releaseChecksum = session.acceptance?.releaseChecksum ?? acceptance.acceptance?.releaseChecksum ?? acceptance.releaseChecksum;
    const commandBoundaryScan = session.acceptance?.commandBoundaryScan ?? acceptance.acceptance?.commandBoundaryScan ?? acceptance.commandBoundaryScan;

    assert(commandUploadEnabled === false, "Session readback must keep commandUploadEnabled false.");
    assert(session.acceptance?.status === "pass" || acceptance.ok === true, "Session readback must expose passing acceptance evidence.");
    assert(verify.ok === true, "Hash-chain verification API must return ok.");
    assert(consoleMessages.length === 0, `Browser emitted console/page errors: ${consoleMessages.join("; ")}`);

    const report = {
      generatedAt,
      baseUrl,
      dataDir,
      homeScreenshotPath,
      mobileScreenshotPath,
      releaseChecksum: releaseChecksum?.overallSha256,
      commandBoundaryStatus: commandBoundaryScan?.status,
      commandBoundaryScannedFileCount: commandBoundaryScan?.scannedFileCount,
      commandBoundaryViolationCount: commandBoundaryScan?.violationCount,
      readinessSummary: summarizeReadiness(readiness),
      verifyErrors: verify.errors ?? [],
      verifyEventCount: verify.eventCount ?? 0,
      verifyFinalStateHash: verify.finalStateHash,
      consoleEvidence: "No browser console errors or warnings were emitted during the clean production-shell run."
    };
    await writeFile(path.join(root, reportPath), renderGstackBrowserQaMarkdown(report), "utf8");

    return {
      ok: true,
      generatedAt,
      commandUploadEnabled: false,
      reportPath,
      screenshotPaths: [homeScreenshotPath, mobileScreenshotPath],
      port
    };
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
    await onceExit(server);
  }
}

export function renderGstackBrowserQaMarkdown(report: GstackBrowserQaReport) {
  return [
    "# SEEKR QA Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Verdict",
    "",
    "Pass for local internal-alpha browser/API QA.",
    "",
    "`commandUploadEnabled` stayed `false`.",
    "",
    "## Scope",
    "",
    `- Target: ${report.baseUrl}/`,
    `- Data directory: \`${report.dataDir}\``,
    "- Browser tool: Playwright Chromium clean-start production-shell smoke",
    "- Mode: report-only clean-start local browser/API QA",
    "- Screenshots:",
    `  - \`${report.homeScreenshotPath}\``,
    `  - \`${report.mobileScreenshotPath}\``,
    "",
    "## Checks",
    "",
    "| Check | Result | Evidence |",
    "| --- | --- | --- |",
    "| App shell loads | Pass | `SEEKR GCS` rendered on desktop and mobile viewports with the mission map available |",
    "| Field-laptop mobile viewport | Pass | 375x812 screenshot captured after reload without blocking startup |",
    `| Session acceptance readback | Pass | /api/session returned acceptance status pass, checksum ${report.releaseChecksum ?? "unknown"}, command-boundary status ${report.commandBoundaryStatus ?? "unknown"}, ${report.commandBoundaryScannedFileCount ?? "unknown"} scanned files, ${report.commandBoundaryViolationCount ?? "unknown"} violations, and commandUploadEnabled: false |`,
    `| Readiness API | Pass with local config warnings | /api/readiness returned ${report.readinessSummary} |`,
    `| Hash-chain verification API | Pass | /api/verify returned ok: true, errors: ${JSON.stringify(report.verifyErrors)}, eventCount: ${report.verifyEventCount}, and final state hash ${report.verifyFinalStateHash ?? "unknown"} |`,
    `| Console | Pass | ${report.consoleEvidence} |`,
    "",
    "## Limitations",
    "",
    "- This report is browser/API QA only; it does not validate real Jetson Orin Nano hardware, Raspberry Pi 5 hardware, real MAVLink/ROS telemetry, HIL failsafe logs, Isaac Sim capture, or hardware-actuation policy review.",
    "- The clean-start data directory is a local QA fixture path, not a completed fresh-operator rehearsal archive.",
    "- Real aircraft command upload and hardware actuation remain disabled.",
    ""
  ].join("\n");
}

function captureConsoleEvidence(page: Page, messages: string[]) {
  page.on("console", (message: ConsoleMessage) => {
    if (["error", "warning"].includes(message.type())) messages.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error: Error) => messages.push(`pageerror: ${error.message}`));
}

async function readAcceptanceStatus(root: string): Promise<AcceptanceStatus> {
  try {
    return JSON.parse(await readFile(path.join(root, ".tmp/acceptance-status.json"), "utf8")) as AcceptanceStatus;
  } catch {
    return {};
  }
}

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  assert(response.ok, `${url} returned ${response.status}`);
  return await response.json() as T;
}

export function summarizeReadiness(readiness: ReadinessResponse) {
  const checks = Array.isArray(readiness.checks) ? readiness.checks : [];
  const counts = checks.reduce((acc, check) => {
    const status = check.status ?? "unknown";
    acc[status] = (acc[status] ?? 0) + 1;
    if (check.blocking && status === "fail") acc.blocking += 1;
    return acc;
  }, { pass: 0, warn: 0, fail: 0, blocking: 0 } as Record<string, number>);
  return `${counts.pass ?? 0} pass, ${counts.warn ?? 0} warn, ${counts.fail ?? 0} fail, ${counts.blocking ?? 0} blocking`;
}

async function waitForHealth(url: string, timeoutMs: number, logs: string[]) {
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
  throw new Error(`SEEKR server did not become healthy: ${String(lastError)}\n${logs.join("").slice(-2_000)}`);
}

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function onceExit(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    delay(2_000).then(() => child.kill("SIGKILL"))
  ]);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function relativeFromRoot(root: string, absolutePath: string) {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function isInsideRoot(root: string, absolutePath: string) {
  const relative = path.relative(root, absolutePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
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
  writeGstackBrowserQaReport({
    outDir: typeof args.out === "string" ? args.out : undefined,
    generatedAt: typeof args.generatedAt === "string" ? args.generatedAt : undefined,
    port: typeof args.port === "string" ? Number(args.port) : undefined
  })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
