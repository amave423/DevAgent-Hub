const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const scriptPath = process.argv[2];
const scriptArgs = process.argv.slice(3);

if (!scriptPath) {
  console.error("Usage: node scripts/run_python_script.js <script.py> [args...]");
  process.exit(2);
}

const candidates = [
  process.env.DEVAGENT_PYTHON ? [process.env.DEVAGENT_PYTHON] : null,
  process.env.OPENHANDS_APP_SMOKE_PYTHON ? [process.env.OPENHANDS_APP_SMOKE_PYTHON] : null,
  [path.join(ROOT_DIR, "vendor", "OpenHands", ".venv", "Scripts", "python.exe")],
  [path.join(ROOT_DIR, "vendor", "OpenHands", ".venv", "bin", "python")],
  [path.join(ROOT_DIR, ".venv", "Scripts", "python.exe")],
  [path.join(ROOT_DIR, ".venv", "bin", "python")],
  process.platform === "win32" ? ["py", "-3.12"] : null,
  ["python3.12"],
  ["python3"],
  ["python"],
].filter(Boolean);

for (const candidate of candidates) {
  const [command] = candidate;
  if (looksLikePath(command) && !fs.existsSync(command)) {
    continue;
  }

  const result = spawnSync(
    command,
    [...candidate.slice(1), path.resolve(ROOT_DIR, scriptPath), ...scriptArgs],
    {
      cwd: ROOT_DIR,
      stdio: "inherit",
      windowsHide: true,
    },
  );

  if (result.error && result.error.code === "ENOENT") {
    continue;
  }

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

console.error("No usable Python interpreter found.");
process.exit(1);

function looksLikePath(value) {
  return value.includes("/") || value.includes("\\") || path.isAbsolute(value);
}
