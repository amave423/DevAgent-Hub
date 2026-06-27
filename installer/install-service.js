const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_REPO_URL = "https://github.com/amave423/DevAgent-Hub.git";

function getInstallerDefaults() {
  return {
    installPath: PROJECT_ROOT,
    repoUrl: DEFAULT_REPO_URL,
    platform: process.platform,
  };
}

async function checkSystem() {
  const [git, docker, node, npm, python] = await Promise.all([
    checkTool({
      id: "git",
      label: "Git",
      candidates: [commandCandidate("git", ["--version"])],
      required: true,
    }),
    checkTool({
      id: "docker",
      label: "Docker",
      candidates: [commandCandidate("docker", ["--version"])],
      required: true,
    }),
    checkTool({
      id: "node",
      label: "Node.js 20+",
      candidates: [commandCandidate(platformCommand("node"), ["--version"])],
      minVersion: [20, 0, 0],
      required: true,
    }),
    checkTool({
      id: "npm",
      label: "npm",
      candidates: [commandCandidate(platformCommand("npm"), ["--version"])],
      required: true,
    }),
    checkTool({
      id: "python",
      label: "Python 3.10+",
      candidates: pythonCandidates(),
      minVersion: [3, 10, 0],
      required: true,
    }),
  ]);

  return [git, docker, node, npm, python];
}

async function prepareInstall(rawSettings) {
  const settings = normalizeSettings(rawSettings);

  assertSafeInstallPath(settings.installPath);
  await fs.mkdir(settings.installPath, { recursive: true });

  const configsDir = path.join(settings.installPath, "configs");
  const envPath = path.join(settings.installPath, ".env.local");
  const configPath = path.join(configsDir, "agents.json");
  const planPath = path.join(settings.installPath, "devagent-install-plan.json");
  const readmePath = path.join(settings.installPath, "README_INSTALL.txt");

  await fs.mkdir(configsDir, { recursive: true });

  const agentsConfig = await buildAgentsConfig(settings);
  const envFile = buildEnvFile(settings, configPath);
  const commands = buildInstallCommands(settings);
  const warnings = await buildWarnings(settings);
  const plan = {
    generatedAt: new Date().toISOString(),
    installPath: settings.installPath,
    repoUrl: settings.repoUrl,
    modelId: settings.modelId,
    runnerMode: settings.runnerMode,
    proxyConfigured: Boolean(settings.proxyUrl),
    cloudProvider: settings.cloudProvider,
    files: [configPath, envPath, readmePath],
    commands,
    warnings,
  };

  await fs.writeFile(configPath, `${JSON.stringify(agentsConfig, null, 2)}\n`, "utf8");
  await fs.writeFile(envPath, envFile, "utf8");
  await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  await fs.writeFile(readmePath, buildReadme(settings, commands), "utf8");

  return {
    ok: true,
    installPath: settings.installPath,
    files: [configPath, envPath, planPath, readmePath],
    commands,
    warnings,
  };
}

function buildInstallExecutionSteps(rawSettings) {
  const settings = normalizeSettings(rawSettings);
  const rootPython = process.platform === "win32"
    ? path.join(settings.installPath, ".venv", "Scripts", "python.exe")
    : path.join(settings.installPath, ".venv", "bin", "python");
  const rootUv = process.platform === "win32"
    ? path.join(settings.installPath, ".venv", "Scripts", "uv.exe")
    : path.join(settings.installPath, ".venv", "bin", "uv");
  const openHandsPython = process.platform === "win32"
    ? path.join(settings.installPath, "vendor", "OpenHands", ".venv", "Scripts", "python.exe")
    : path.join(settings.installPath, "vendor", "OpenHands", ".venv", "bin", "python");
  const openHandsDir = path.join(settings.installPath, "vendor", "OpenHands");
  const openHandsFrontendDir = path.join(openHandsDir, "frontend");

  return [
    {
      id: "root-npm-install",
      label: "Установка Node.js зависимостей проекта",
      cwd: settings.installPath,
      command: platformCommand("npm"),
      args: ["install"],
    },
    {
      id: "root-python-venv",
      label: "Создание Python venv",
      cwd: settings.installPath,
      command: process.platform === "win32" ? "py" : "python3",
      args: process.platform === "win32"
        ? ["-3.12", "-m", "venv", ".venv"]
        : ["-m", "venv", ".venv"],
    },
    {
      id: "root-install-uv",
      label: "Установка uv",
      cwd: settings.installPath,
      command: rootPython,
      args: ["-m", "pip", "install", "uv"],
    },
    {
      id: "openhands-uv-sync",
      label: "Установка Python зависимостей OpenHands",
      cwd: openHandsDir,
      command: rootUv,
      args: ["sync", "--frozen", "--no-dev", "--python", rootPython],
    },
    {
      id: "openhands-frontend-install",
      label: "Установка frontend зависимостей OpenHands",
      cwd: openHandsFrontendDir,
      command: platformCommand("npm"),
      args: ["install"],
    },
    {
      id: "openhands-frontend-build",
      label: "Сборка frontend OpenHands",
      cwd: openHandsFrontendDir,
      command: platformCommand("npm"),
      args: ["run", "build"],
    },
    {
      id: "agent-studio-smoke",
      label: "Проверка Agent Studio API",
      cwd: settings.installPath,
      command: platformCommand("npm"),
      args: ["run", "smoke:agent-studio"],
    },
    {
      id: "openhands-app-smoke",
      label: "Проверка OpenHands app API",
      cwd: settings.installPath,
      command: platformCommand("npm"),
      args: ["run", "smoke:openhands-app"],
      env: {
        OPENHANDS_APP_SMOKE_PYTHON: openHandsPython,
      },
    },
  ];
}

function buildProcessEnv(rawSettings) {
  const settings = normalizeSettings(rawSettings);
  const env = {
    ...process.env,
    AGENT_STUDIO_CONFIG_PATH: path.join(settings.installPath, "configs", "agents.json"),
    AGENT_STUDIO_RUNNER_MODE: settings.runnerMode,
    AGENT_STUDIO_APP_TITLE: "DevAgent Hub",
    OPENHANDS_SUPPRESS_BANNER: "1",
    OH_PERSISTENCE_DIR: path.join(settings.installPath, ".openhands"),
    OLLAMA_BASE_URL: "http://localhost:11434",
  };

  if (settings.proxyUrl) {
    env.HTTP_PROXY = settings.proxyUrl;
    env.HTTPS_PROXY = settings.proxyUrl;
    env.NO_PROXY = "localhost,127.0.0.1";
  }

  const baseUrl = settings.cloudBaseUrl || providerBaseUrl(settings.cloudProvider);
  if (baseUrl) {
    env.OPENHANDS_PROVIDER_BASE_URL = baseUrl;
  }

  if (settings.apiKey) {
    env[providerApiKeyName(settings.cloudProvider)] = settings.apiKey;
  }

  return env;
}

function buildOpenHandsLaunchStep(rawSettings, port = 3000) {
  const settings = normalizeSettings(rawSettings);
  const openHandsDir = path.join(settings.installPath, "vendor", "OpenHands");
  const python = process.platform === "win32"
    ? path.join(openHandsDir, ".venv", "Scripts", "python.exe")
    : path.join(openHandsDir, ".venv", "bin", "python");

  return {
    id: "openhands-start",
    label: "Запуск OpenHands",
    cwd: settings.installPath,
    command: python,
    args: [
      "-m",
      "uvicorn",
      "openhands.app_server.app:app",
      "--app-dir",
      openHandsDir,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    url: `http://127.0.0.1:${port}`,
  };
}

function commandCandidate(command, args) {
  return { command, args };
}

function platformCommand(command) {
  if (process.platform !== "win32") return command;
  if (command === "npm") return "npm.cmd";
  return command;
}

function pythonCandidates() {
  if (process.platform === "win32") {
    return [
      commandCandidate("py", ["-3.12", "--version"]),
      commandCandidate("py", ["-3", "--version"]),
      commandCandidate("python", ["--version"]),
      commandCandidate("python3", ["--version"]),
    ];
  }

  return [
    commandCandidate("python3", ["--version"]),
    commandCandidate("python", ["--version"]),
  ];
}

async function checkTool({ id, label, candidates, minVersion, required }) {
  let lastResult = null;

  for (const candidate of candidates) {
    const result = await runCommand(candidate.command, candidate.args);
    lastResult = result;

    if (!result.error) {
      const version = extractVersion(result.output);
      const versionOk = minVersion ? compareVersion(version, minVersion) >= 0 : true;
      return {
        id,
        label,
        ok: versionOk,
        required,
        installed: true,
        command: [candidate.command, ...candidate.args].join(" "),
        version: version ? version.join(".") : null,
        output: result.output,
        problem: versionOk ? null : `Требуется версия ${minVersion.join(".")} или выше`,
      };
    }
  }

  return {
    id,
    label,
    ok: false,
    required,
    installed: false,
    command: candidates.map((candidate) => candidate.command).join(" / "),
    version: null,
    output: lastResult?.output ?? "",
    problem: "Не найдено в PATH",
  };
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { windowsHide: true, timeout: 8000 },
      (error, stdout, stderr) => {
        resolve({
          error,
          output: (stdout || stderr || error?.message || "").trim(),
        });
      },
    );
  });
}

function extractVersion(output) {
  const match = output.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function compareVersion(version, minimum) {
  if (!version) return -1;

  for (let index = 0; index < minimum.length; index += 1) {
    const left = version[index] ?? 0;
    const right = minimum[index] ?? 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }

  return 0;
}

function normalizeSettings(rawSettings = {}) {
  const installPath = path.resolve(
    expandHome(String(rawSettings.installPath || PROJECT_ROOT).trim()),
  );
  const runnerMode = normalizeEnum(rawSettings.runnerMode, ["auto", "live", "mock"], "auto");
  const cloudProvider = normalizeEnum(
    rawSettings.cloudProvider,
    ["openrouter", "openai", "custom"],
    "openrouter",
  );

  return {
    installPath,
    repoUrl: String(rawSettings.repoUrl || DEFAULT_REPO_URL).trim(),
    modelId: String(rawSettings.modelId || "ollama-qwen25-coder-7b").trim(),
    runnerMode,
    proxyUrl: String(rawSettings.proxyUrl || "").trim(),
    apiKey: String(rawSettings.apiKey || "").trim(),
    cloudProvider,
    cloudBaseUrl: String(rawSettings.cloudBaseUrl || "").trim(),
  };
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || fallback).trim();
  return allowed.includes(normalized) ? normalized : fallback;
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith(`~${path.sep}`) || value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function assertSafeInstallPath(installPath) {
  const parsed = path.parse(installPath);
  if (installPath === parsed.root) {
    throw new Error("Нельзя использовать корень диска как папку проекта");
  }
}

async function buildAgentsConfig(settings) {
  const sourcePath = path.join(PROJECT_ROOT, "configs", "agents.json");
  const rawConfig = await fs.readFile(sourcePath, "utf8");
  const config = JSON.parse(rawConfig);

  config.agents = config.agents.map((agent) => ({
    ...agent,
    modelId: settings.modelId,
  }));
  config.runtime = {
    ...config.runtime,
    runnerMode: settings.runnerMode,
  };

  return config;
}

function buildEnvFile(settings, configPath) {
  const apiKeyName = providerApiKeyName(settings.cloudProvider);
  const baseUrl = settings.cloudBaseUrl || providerBaseUrl(settings.cloudProvider);
  const lines = [
    "# DevAgent Hub local runtime",
    `AGENT_STUDIO_CONFIG_PATH=${quoteEnv(configPath)}`,
    `AGENT_STUDIO_RUNNER_MODE=${settings.runnerMode}`,
    "AGENT_STUDIO_APP_TITLE=DevAgent Hub",
    "OPENHANDS_SUPPRESS_BANNER=1",
    `OH_PERSISTENCE_DIR=${quoteEnv(path.join(settings.installPath, ".openhands"))}`,
    "OLLAMA_BASE_URL=http://localhost:11434",
  ];

  if (settings.proxyUrl) {
    lines.push(`HTTP_PROXY=${settings.proxyUrl}`);
    lines.push(`HTTPS_PROXY=${settings.proxyUrl}`);
    lines.push("NO_PROXY=localhost,127.0.0.1");
  }

  if (baseUrl) {
    lines.push(`OPENHANDS_PROVIDER_BASE_URL=${baseUrl}`);
  }

  if (settings.apiKey) {
    lines.push(`${apiKeyName}=${settings.apiKey}`);
  } else {
    lines.push(`# ${apiKeyName}=`);
  }

  return `${lines.join("\n")}\n`;
}

function providerApiKeyName(provider) {
  if (provider === "openai") return "AGENT_STUDIO_OPENAI_API_KEY";
  if (provider === "openrouter") return "AGENT_STUDIO_OPENROUTER_API_KEY";
  return "AGENT_STUDIO_API_KEY";
}

function providerBaseUrl(provider) {
  if (provider === "openai") return "https://api.openai.com/v1";
  if (provider === "openrouter") return "https://openrouter.ai/api/v1";
  return "";
}

function quoteEnv(value) {
  const text = String(value);
  if (!/[\s#"\\]/.test(text)) return text;
  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function buildInstallCommands(settings) {
  if (process.platform === "win32") {
    return [
      `Set-Location "${settings.installPath}"`,
      "npm install",
      "py -3.12 -m venv .venv",
      ".venv\\Scripts\\python.exe -m pip install uv",
      "Push-Location vendor\\OpenHands",
      "..\\..\\.venv\\Scripts\\uv.exe sync --frozen --no-dev --python ..\\..\\.venv\\Scripts\\python.exe",
      "Pop-Location",
      "Push-Location vendor\\OpenHands\\frontend",
      "npm install",
      "npm run build",
      "Pop-Location",
      "npm run smoke:agent-studio",
      "npm run smoke:openhands-app",
      '$env:AGENT_STUDIO_CONFIG_PATH = "$PWD\\configs\\agents.json"',
      '$env:OH_PERSISTENCE_DIR = "$PWD\\.openhands"',
      ".\\vendor\\OpenHands\\.venv\\Scripts\\python.exe -m uvicorn openhands.app_server.app:app --app-dir vendor\\OpenHands --host 127.0.0.1 --port 3000",
    ];
  }

  return [
    `cd "${settings.installPath}"`,
    "npm install",
    "python3 -m venv .venv",
    ".venv/bin/python -m pip install uv",
    "cd vendor/OpenHands",
    "../../.venv/bin/uv sync --frozen --no-dev --python ../../.venv/bin/python",
    "cd ../..",
    "cd vendor/OpenHands/frontend",
    "npm install",
    "npm run build",
    "cd ../../..",
    "npm run smoke:agent-studio",
    "npm run smoke:openhands-app",
    "export AGENT_STUDIO_CONFIG_PATH=\"$PWD/configs/agents.json\"",
    "export OH_PERSISTENCE_DIR=\"$PWD/.openhands\"",
    "./vendor/OpenHands/.venv/bin/python -m uvicorn openhands.app_server.app:app --app-dir vendor/OpenHands --host 127.0.0.1 --port 3000",
  ];
}

async function buildWarnings(settings) {
  const warnings = [];
  const packagePath = path.join(settings.installPath, "package.json");
  const vendorPath = path.join(settings.installPath, "vendor", "OpenHands", "pyproject.toml");

  if (!(await pathExists(packagePath))) {
    warnings.push(
      `В выбранной папке нет package.json. Сначала клонируйте репозиторий: git clone ${settings.repoUrl} "${settings.installPath}"`,
    );
  }

  if (!(await pathExists(vendorPath))) {
    warnings.push("В выбранной папке не найден vendor/OpenHands. Проверьте, что форк скачан полностью.");
  }

  if (settings.runnerMode === "live" && !settings.apiKey && settings.modelId.startsWith("open")) {
    warnings.push("Для live-режима с облачной моделью нужен API key.");
  }

  return warnings;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function buildReadme(settings, commands) {
  return [
    "DevAgent Hub install plan",
    "",
    `Project path: ${settings.installPath}`,
    `Repository: ${settings.repoUrl}`,
    `Default model: ${settings.modelId}`,
    `Runner mode: ${settings.runnerMode}`,
    "",
    "Run from terminal:",
    ...commands.map((command) => `  ${command}`),
    "",
  ].join("\n");
}

module.exports = {
  buildInstallExecutionSteps,
  buildOpenHandsLaunchStep,
  buildProcessEnv,
  checkSystem,
  getInstallerDefaults,
  normalizeSettings,
  prepareInstall,
};
