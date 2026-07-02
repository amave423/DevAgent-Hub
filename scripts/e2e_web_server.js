const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const process = require("node:process");

const children = [];
let shuttingDown = false;

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  shutdown(1);
});

async function main() {
  if (!(await isHealthy("http://127.0.0.1:8000/health"))) {
    start("api", process.execPath, [
      "scripts/run_python_module.js",
      "uvicorn",
      "app.main:app",
      "--host",
      "127.0.0.1",
      "--port",
      "8000",
      "--app-dir",
      "services/agent-api",
    ], {
      DEVAGENT_HOST: "127.0.0.1",
      DEVAGENT_PORT: "3000",
      NO_PROXY: "localhost,127.0.0.1",
    });
    await waitForUrl("http://127.0.0.1:8000/health", 120_000);
  } else {
    console.log("[e2e] API already running at http://127.0.0.1:8000");
  }

  if (!(await isHealthy("http://127.0.0.1:5173"))) {
    const npm = npmCommand();
    start("web", npm.command, [...npm.args, "--workspace", "apps/web", "run", "dev", "--", "--host", "127.0.0.1"], {});
    await waitForUrl("http://127.0.0.1:5173", 120_000);
  } else {
    console.log("[e2e] Web already running at http://127.0.0.1:5173");
  }

  console.log("[e2e] Dev servers are ready.");
  setInterval(() => {}, 60_000);
}

function start(label, command, args, extraEnv) {
  console.log(`[e2e] starting ${label}: ${command} ${args.join(" ")}`);
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  children.push(child);
  child.stdout.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  child.on("exit", (code, signal) => {
    if (!shuttingDown && code !== 0) {
      console.error(`[e2e] ${label} exited with code ${code} signal ${signal || ""}`);
      shutdown(code || 1);
    }
  });
}

function npmCommand() {
  const candidates = [
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(process.cwd(), ".tools", "node-v22", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const npmCli = candidates.find((candidate) => fs.existsSync(candidate));
  if (npmCli) return { command: process.execPath, args: [npmCli] };
  return { command: process.platform === "win32" ? "npm.cmd" : "npm", args: [] };
}
async function waitForUrl(url, timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await isHealthy(url)) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message || "not reachable"}`);
}

function isHealthy(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

function shutdown(code = 0) {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
