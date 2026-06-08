import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const frontendDir = fileURLToPath(new URL("../", import.meta.url));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const port = process.env.PLAYWRIGHT_PORT ?? "13000";
const host = "127.0.0.1";
const baseUrl = `http://${host}:${port}`;
const playwrightArgs = normalizePlaywrightArgs(process.argv.slice(2));

let previewProcess = null;

try {
  if (!(await serverReady())) {
    previewProcess = spawn(
      pnpm,
      ["exec", "vite", "preview", "--host", host, "--port", port],
      {
        cwd: frontendDir,
        detached: process.platform !== "win32",
        env: process.env,
        shell: process.platform === "win32",
        stdio: "inherit",
      },
    );
    await waitForServer();
  }

  const exitCode = await runCommand(pnpm, ["exec", "playwright", "test", ...playwrightArgs]);
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
      shell: process.platform === "win32",
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
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", () => resolve());
    child.on("exit", () => resolve());
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
