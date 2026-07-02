const { spawn } = require("node:child_process");
const http = require("node:http");
const process = require("node:process");

const args = process.argv.slice(2);
const server = spawn(process.execPath, ["scripts/e2e_web_server.js"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

let serverExited = false;
server.on("exit", (code) => {
  serverExited = true;
  if (code !== 0 && !shuttingDown) {
    console.error(`[e2e] server exited before tests completed: ${code}`);
    process.exit(code || 1);
  }
});

let shuttingDown = false;

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  shutdown(1);
});

async function main() {
  await waitForUrl("http://127.0.0.1:5173", 180_000);
  if (serverExited) process.exit(1);

  const cli = require.resolve("@playwright/test/cli");
  const result = spawn(process.execPath, [cli, "test", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, E2E_NO_WEBSERVER: "1" },
    stdio: "inherit",
    windowsHide: true,
  });

  result.on("exit", (code) => shutdown(code || 0));
}

async function waitForUrl(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isHealthy(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
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

function shutdown(code) {
  shuttingDown = true;
  if (!server.killed) server.kill();
  setTimeout(() => process.exit(code), 250);
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));
