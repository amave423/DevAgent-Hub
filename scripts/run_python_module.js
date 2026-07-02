const { spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const moduleName = process.argv[2];
const moduleArgs = process.argv.slice(3);

if (!moduleName) {
  console.error("Usage: node scripts/run_python_module.js <module> [args...]");
  process.exit(2);
}

function probePython(command, args) {
  try {
    execFileSync(
      command,
      [...args, "-c", "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('httpx') else 1)"],
      { stdio: "ignore", windowsHide: true },
    );
    return true;
  } catch {
    return false;
  }
}

const rawCandidates = [
  process.env.DEVAGENT_PYTHON ? [process.env.DEVAGENT_PYTHON] : null,
  [path.join(ROOT_DIR, ".venv", "Scripts", "python.exe")],
  [path.join(ROOT_DIR, ".venv", "bin", "python")],
  ["python3.12"],
  ["python3"],
  ["python"],
].filter(Boolean);

let chosen = null;
for (const candidate of rawCandidates) {
  const [cmd, ...args] = candidate;
  if (looksLikePath(cmd) && !fs.existsSync(cmd)) continue;
  if (probePython(cmd, args)) {
    chosen = candidate;
    break;
  }
}

for (const candidate of chosen ? [chosen] : rawCandidates) {
  const [command] = candidate;
  if (looksLikePath(command) && !fs.existsSync(command)) continue;

  const result = spawnSync(command, [...candidate.slice(1), "-m", moduleName, ...moduleArgs], {
    cwd: ROOT_DIR,
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error && result.error.code === "ENOENT") continue;
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
