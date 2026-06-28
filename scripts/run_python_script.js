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

// Probe every candidate and keep the first one importing httpx (or any stdlib module).
function probePython(command, args) {
  try {
    const result = require("child_process").execFileSync(
      command,
      [...args, "-c", "import sys, importlib.util; sys.exit(0 if importlib.util.find_spec('httpx') else 1)"],
      { stdio: "ignore", windowsHide: true },
    );
    return true;
  } catch {
    // execFileSync throws on ENOENT or non-zero exit code
    return false;
  }
}

// Build candidate list ordered by preference
const rawCandidates = [
  process.env.DEVAGENT_PYTHON ? [process.env.DEVAGENT_PYTHON] : null,
  [path.join(ROOT_DIR, ".venv", "Scripts", "python.exe")],
  [path.join(ROOT_DIR, ".venv", "bin", "python")],
  ["python3.12"],
  ["python3"],
  ["python"],
].filter(Boolean);

// Pick the first candidate that has httpx available
let chosen = null;
for (const candidate of rawCandidates) {
  const [cmd, ...args] = candidate;
  if (cmd.includes("/") || cmd.includes("\\") || path.isAbsolute(cmd)) {
    if (!fs.existsSync(cmd)) continue;
  }
  if (probePython(cmd, args)) {
    chosen = candidate;
    break;
  }
}

const candidates = chosen ? [chosen] : rawCandidates;

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
