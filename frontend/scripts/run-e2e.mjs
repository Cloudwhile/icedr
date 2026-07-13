import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");
const viteCli = resolve(dirname(require.resolve("vite")), "../../bin/vite.js");
const port = process.env.PLAYWRIGHT_PORT ?? "13000";
const host = "127.0.0.1";
const baseUrl = `http://${host}:${port}`;
const playwrightArgs = normalizePlaywrightArgs(process.argv.slice(2));

let previewProcess = null;

try {
  if (!(await serverReady())) {
    previewProcess = spawn(
      process.execPath,
      [
        viteCli,
        "preview",
        "--host",
        host,
        "--port",
        port,
        "--strictPort",
      ],
      {
        cwd: frontendDir,
        detached: process.platform !== "win32",
        env: process.env,
        stdio: "ignore",
        windowsHide: true,
      },
    );
    previewProcess.unref();
    await waitForServer();
  }

  const exitCode = await runCommand(process.execPath, [
    playwrightCli,
    "test",
    ...playwrightArgs,
  ]);
  process.exitCode = exitCode;
} finally {
  await stopPreview();
}

function normalizePlaywrightArgs(args) {
  return args[0] === "--" ? args.slice(1) : args;
}

async function waitForServer() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (
      previewProcess &&
      (previewProcess.exitCode !== null || previewProcess.signalCode !== null)
    ) {
      throw new Error(
        `Preview server exited early with code ${previewProcess.exitCode} (signal: ${previewProcess.signalCode})`,
      );
    }
    if (await serverReady()) return;
    await delay(350);
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function serverReady() {
  try {
    const response = await fetch(`${baseUrl}/index.html`);
    return response.ok;
  } catch {
    return false;
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: frontendDir,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function stopPreview() {
  if (
    !previewProcess ||
    previewProcess.exitCode !== null ||
    previewProcess.signalCode !== null
  ) {
    return;
  }
  if (!previewProcess.pid) return;

  if (process.platform === "win32") {
    await runDetached("taskkill", ["/pid", String(previewProcess.pid), "/T", "/F"]);
    return;
  }

  try {
    process.kill(-previewProcess.pid, "SIGTERM");
  } catch {
    try {
      process.kill(previewProcess.pid, "SIGTERM");
    } catch {
      // Ignore if the process has already exited.
    }
  }
}

function runDetached(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      windowsHide: true,
    });
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish();
    }, 5_000);
    child.on("error", finish);
    child.on("exit", finish);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
