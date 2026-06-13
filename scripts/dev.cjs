const { spawn } = require("node:child_process");
const path = require("node:path");

const runner = resolveRunner();

const commands = [
  { name: "web", args: ["--filter", "frontend", "dev"] },
  { name: "api", args: ["--filter", "backend", "start:dev"] },
];

const children = new Set();
let shuttingDown = false;

function resolveRunner() {
  const npmExecPath = process.env.npm_execpath;
  const npmExecExt = npmExecPath ? path.extname(npmExecPath).toLowerCase() : "";

  if (npmExecPath && [".cjs", ".js", ".mjs"].includes(npmExecExt)) {
    return {
      command: process.execPath,
      argsPrefix: [npmExecPath],
      useWindowsCommand: false,
    };
  }

  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec || "cmd.exe",
      argsPrefix: ["/d", "/s", "/c"],
      useWindowsCommand: true,
    };
  }

  return {
    command: "pnpm",
    argsPrefix: [],
    useWindowsCommand: false,
  };
}

function quoteWindowsCommandArg(value) {
  if (/^[a-zA-Z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function buildRunnerArgs(args) {
  if (!runner.useWindowsCommand) return [...runner.argsPrefix, ...args];
  return [...runner.argsPrefix, ["pnpm", ...args].map(quoteWindowsCommandArg).join(" ")];
}

function stopAll(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const command of commands) {
  let child;

  try {
    child = spawn(runner.command, buildRunnerArgs(command.args), {
      stdio: "inherit",
      shell: false,
    });
  } catch (error) {
    console.error(`[${command.name}] ${error instanceof Error ? error.message : error}`);
    stopAll();
    process.exitCode = 1;
    break;
  }

  children.add(child);

  child.on("exit", (code, signal) => {
    children.delete(child);

    if (shuttingDown) return;
    if (code && code !== 0) {
      stopAll();
      process.exitCode = code;
      return;
    }

    if (signal) {
      stopAll(signal);
      process.exitCode = 1;
      return;
    }

    if (children.size === 0) process.exitCode = 0;
  });

  child.on("error", (error) => {
    console.error(`[${command.name}] ${error.message}`);
    stopAll();
    process.exitCode = 1;
  });
}

process.on("SIGINT", () => stopAll("SIGINT"));
process.on("SIGTERM", () => stopAll("SIGTERM"));
