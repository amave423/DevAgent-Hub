const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_REPO_URL = "https://github.com/amave423/DevAgent-Hub.git";
const DEFAULT_MODEL_ID = "ollama-qwen25-coder-7b";

function getInstallerDefaults(isPackaged = false) {
  return {
    installPath: isPackaged
      ? path.join(os.homedir(), "DevAgent Hub")
      : PROJECT_ROOT,
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
      label: "Node.js 22.12+",
      candidates: [commandCandidate(platformCommand("node"), ["--version"])],
      minVersion: [22, 12, 0],
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
      label: "Python 3.12+",
      candidates: pythonCandidates(),
      minVersion: [3, 12, 0],
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
  const serviceDir = path.join(settings.installPath, "services");
  const envPath = path.join(settings.installPath, ".env.local");
  const configPath = path.join(configsDir, "agents.json");
  const planPath = path.join(settings.installPath, "devagent-install-plan.json");
  const readmePath = path.join(settings.installPath, "README_INSTALL.txt");

  await fs.mkdir(configsDir, { recursive: true });
  await fs.mkdir(serviceDir, { recursive: true });

  const agentsConfig = await buildAgentsConfig(settings);
  const envFile = buildEnvFile(settings, configPath);
  const commands = buildInstallCommands(settings);
  const serviceFiles = buildServiceFiles(settings);
  const warnings = await buildWarnings(settings);
  const generatedFiles = [
    configPath,
    envPath,
    planPath,
    readmePath,
    ...serviceFiles.map((file) => file.path),
  ];
  const plan = {
    generatedAt: new Date().toISOString(),
    installPath: settings.installPath,
    repoUrl: settings.repoUrl,
    modelId: settings.modelId,
    selectedModelIds: settings.selectedModelIds,
    runnerMode: settings.runnerMode,
    proxyConfigured: Boolean(settings.proxyUrl),
    cloudProvider: settings.cloudProvider,
    files: generatedFiles,
    commands,
    serviceCommands: buildServiceCommands(settings),
    warnings,
  };

  await fs.writeFile(configPath, `${JSON.stringify(agentsConfig, null, 2)}\n`, "utf8");
  await fs.writeFile(envPath, envFile, "utf8");
  await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  await fs.writeFile(readmePath, buildReadme(settings, commands), "utf8");
  await Promise.all(
    serviceFiles.map(async (file) => {
      await fs.writeFile(file.path, file.content, "utf8");
      if (file.executable) {
        await fs.chmod(file.path, 0o755);
      }
    }),
  );

  return {
    ok: true,
    installPath: settings.installPath,
    files: generatedFiles,
    commands,
    serviceCommands: buildServiceCommands(settings),
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
      id: "root-python-venv",
      label: "Create Python 3.12 virtual environment",
      cwd: settings.installPath,
      command: process.platform === "win32" ? "py" : "python3.12",
      args: process.platform === "win32"
        ? ["-3.12", "-m", "venv", ".venv"]
        : ["-m", "venv", ".venv"],
    },
    {
      id: "root-install-uv",
      label: "Install uv",
      cwd: settings.installPath,
      command: rootPython,
      args: ["-m", "pip", "install", "uv"],
    },
    {
      id: "openhands-uv-sync",
      label: "Install OpenHands Python dependencies",
      cwd: openHandsDir,
      command: rootUv,
      args: ["sync", "--frozen", "--no-dev", "--python", rootPython],
    },
    {
      id: "openhands-frontend-install",
      label: "Install OpenHands frontend dependencies",
      cwd: openHandsFrontendDir,
      command: platformCommand("npm"),
      args: ["install"],
    },
    {
      id: "openhands-frontend-build",
      label: "Build OpenHands frontend",
      cwd: openHandsFrontendDir,
      command: platformCommand("npm"),
      args: ["run", "build"],
    },
    ...buildOllamaPullSteps(settings),
    {
      id: "agent-studio-smoke",
      label: "Check Agent Studio API",
      cwd: settings.installPath,
      command: openHandsPython,
      args: [path.join(settings.installPath, "scripts", "smoke_agent_studio.py")],
    },
    {
      id: "openhands-app-smoke",
      label: "Check OpenHands app API",
      cwd: settings.installPath,
      command: openHandsPython,
      args: [path.join(settings.installPath, "scripts", "smoke_openhands_app.py")],
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
    cwd: openHandsDir,
    command: python,
    args: [
      "-m",
      "uvicorn",
      "openhands.app_server.app:app",
      "--app-dir",
      ".",
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
    commandCandidate("python3.12", ["--version"]),
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
  const selectedModelIdsInput = parseModelIdList(
    rawSettings.selectedModelIds ?? rawSettings.modelIds ?? rawSettings.models,
  );
  const requestedModelId = String(rawSettings.modelId || "").trim();
  const selectedModelIds = uniqueStrings([
    requestedModelId,
    ...selectedModelIdsInput,
  ]).filter(Boolean);

  if (selectedModelIds.length === 0) {
    selectedModelIds.push(DEFAULT_MODEL_ID);
  }

  const modelId = selectedModelIds.includes(requestedModelId)
    ? requestedModelId
    : selectedModelIds[0];

  return {
    installPath,
    repoUrl: String(rawSettings.repoUrl || DEFAULT_REPO_URL).trim(),
    modelId,
    selectedModelIds,
    runnerMode,
    proxyUrl: String(rawSettings.proxyUrl || "").trim(),
    apiKey: String(rawSettings.apiKey || "").trim(),
    cloudProvider,
    cloudBaseUrl: String(rawSettings.cloudBaseUrl || "").trim(),
    pullLocalModels: rawSettings.pullLocalModels !== false && rawSettings.pullLocalModels !== "false",
  };
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || fallback).trim();
  return allowed.includes(normalized) ? normalized : fallback;
}

function parseModelIdList(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseModelIdList(item));
  }

  if (value === undefined || value === null) {
    return [];
  }

  return String(value)
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueStrings(values) {
  return [...new Set(values)];
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
  const sourcePath = await resolveDefaultAgentsConfigPath();
  const rawConfig = await fs.readFile(sourcePath, "utf8");
  const config = JSON.parse(rawConfig);
  const selectedModelIds = new Set(settings.selectedModelIds);
  const selectedModels = config.models.filter((model) => selectedModelIds.has(model.id));

  if (selectedModels.length === 0) {
    throw new Error(`Selected models were not found in the default config: ${settings.selectedModelIds.join(", ")}`);
  }

  const defaultModelId = selectedModels.some((model) => model.id === settings.modelId)
    ? settings.modelId
    : selectedModels[0].id;

  config.models = selectedModels;
  config.agents = config.agents.map((agent) => ({
    ...agent,
    modelId: defaultModelId,
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

  lines.push("");
  lines.push("# API keys are not stored here. Put terminal/service secrets in services/secrets.env.");
  lines.push(`# ${apiKeyName}=`);

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
      "py -3.12 -m venv .venv",
      ".venv\\Scripts\\python.exe -m pip install uv",
      "Push-Location vendor\\OpenHands",
      "..\\..\\.venv\\Scripts\\uv.exe sync --frozen --no-dev --python ..\\..\\.venv\\Scripts\\python.exe",
      "Pop-Location",
      "Push-Location vendor\\OpenHands\\frontend",
      "npm install",
      "npm run build",
      "Pop-Location",
      ...selectedOllamaModelNames(settings).map((modelName) => `ollama pull ${modelName}`),
      ".\\vendor\\OpenHands\\.venv\\Scripts\\python.exe scripts\\smoke_agent_studio.py",
      ".\\vendor\\OpenHands\\.venv\\Scripts\\python.exe scripts\\smoke_openhands_app.py",
      '$env:AGENT_STUDIO_CONFIG_PATH = "$PWD\\configs\\agents.json"',
      '$env:OH_PERSISTENCE_DIR = "$PWD\\.openhands"',
      "Push-Location vendor\\OpenHands",
      ".\\.venv\\Scripts\\python.exe -m uvicorn openhands.app_server.app:app --app-dir . --host 127.0.0.1 --port 3000",
    ];
  }

  return [
    `cd "${settings.installPath}"`,
    "python3.12 -m venv .venv",
    ".venv/bin/python -m pip install uv",
    "cd vendor/OpenHands",
    "../../.venv/bin/uv sync --frozen --no-dev --python ../../.venv/bin/python",
    "cd ../..",
    "cd vendor/OpenHands/frontend",
    "npm install",
    "npm run build",
    "cd ../../..",
    ...selectedOllamaModelNames(settings).map((modelName) => `ollama pull ${modelName}`),
    "./vendor/OpenHands/.venv/bin/python scripts/smoke_agent_studio.py",
    "./vendor/OpenHands/.venv/bin/python scripts/smoke_openhands_app.py",
    "export AGENT_STUDIO_CONFIG_PATH=\"$PWD/configs/agents.json\"",
    "export OH_PERSISTENCE_DIR=\"$PWD/.openhands\"",
    "cd vendor/OpenHands",
    "./.venv/bin/python -m uvicorn openhands.app_server.app:app --app-dir . --host 127.0.0.1 --port 3000",
  ];
}

function buildServiceFiles(settings) {
  const serviceDir = path.join(settings.installPath, "services");
  const files = [
    {
      path: path.join(serviceDir, "start-openhands.ps1"),
      content: buildWindowsStartScript(settings),
    },
    {
      path: path.join(serviceDir, "install-windows-task.ps1"),
      content: buildWindowsTaskInstallScript(),
    },
    {
      path: path.join(serviceDir, "uninstall-windows-task.ps1"),
      content: buildWindowsTaskUninstallScript(),
    },
    {
      path: path.join(serviceDir, "devagent-hub.service"),
      content: buildSystemdUnit(settings),
    },
    {
      path: path.join(serviceDir, "install-linux-systemd.sh"),
      content: buildSystemdInstallScript(),
      executable: true,
    },
    {
      path: path.join(serviceDir, "uninstall-linux-systemd.sh"),
      content: buildSystemdUninstallScript(),
      executable: true,
    },
    {
      path: path.join(serviceDir, "secrets.env.example"),
      content: buildSecretsExample(settings),
    },
  ];

  return files;
}

function buildServiceCommands(settings) {
  if (process.platform === "win32") {
    return [
      `Set-Location "${path.join(settings.installPath, "services")}"`,
      ".\\install-windows-task.ps1",
      ".\\uninstall-windows-task.ps1",
    ];
  }

  return [
    `cd "${path.join(settings.installPath, "services")}"`,
    "./install-linux-systemd.sh",
    "./uninstall-linux-systemd.sh",
  ];
}

function buildWindowsStartScript(settings) {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')",
    "$EnvFile = Join-Path $ProjectRoot '.env.local'",
    "$SecretsFile = Join-Path $PSScriptRoot 'secrets.env'",
    "function Import-EnvFile($Path) {",
    "  if (!(Test-Path $Path)) { return }",
    "  Get-Content $Path | ForEach-Object {",
    "    $Line = $_.Trim()",
    "    if (!$Line -or $Line.StartsWith('#') -or !$Line.Contains('=')) { return }",
    "    $Name, $Value = $Line.Split('=', 2)",
    "    [Environment]::SetEnvironmentVariable($Name.Trim(), $Value.Trim().Trim('\"'), 'Process')",
    "  }",
    "}",
    "Import-EnvFile $EnvFile",
    "Import-EnvFile $SecretsFile",
    "$env:SERVE_FRONTEND = 'true'",
    "$Python = Join-Path $ProjectRoot 'vendor\\OpenHands\\.venv\\Scripts\\python.exe'",
    "Set-Location (Join-Path $ProjectRoot 'vendor\\OpenHands')",
    "& $Python -m uvicorn openhands.app_server.app:app --app-dir . --host 127.0.0.1 --port 3000",
    "",
  ].join("\n");
}

function buildWindowsTaskInstallScript() {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$TaskName = 'DevAgent Hub OpenHands'",
    "$ScriptPath = Join-Path $PSScriptRoot 'start-openhands.ps1'",
    "$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument \"-NoProfile -ExecutionPolicy Bypass -File `\"$ScriptPath`\"\"",
    "$Trigger = New-ScheduledTaskTrigger -AtLogOn",
    "$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel LeastPrivilege",
    "Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Force | Out-Null",
    "Start-ScheduledTask -TaskName $TaskName",
    "Write-Host 'DevAgent Hub scheduled task installed and started.'",
    "",
  ].join("\n");
}

function buildWindowsTaskUninstallScript() {
  return [
    "$TaskName = 'DevAgent Hub OpenHands'",
    "if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {",
    "  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue",
    "  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false",
    "}",
    "Write-Host 'DevAgent Hub scheduled task removed.'",
    "",
  ].join("\n");
}

function buildSystemdUnit(settings) {
  const projectRoot = settings.installPath;
  const openHandsDir = path.join(projectRoot, "vendor", "OpenHands");
  const python = path.join(openHandsDir, ".venv", "bin", "python");
  return [
    "[Unit]",
    "Description=DevAgent Hub OpenHands",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${systemdEscape(openHandsDir)}`,
    `EnvironmentFile=-${systemdEscape(path.join(projectRoot, ".env.local"))}`,
    `EnvironmentFile=-${systemdEscape(path.join(projectRoot, "services", "secrets.env"))}`,
    "Environment=SERVE_FRONTEND=true",
    `ExecStart=${systemdEscape(python)} -m uvicorn openhands.app_server.app:app --app-dir . --host 127.0.0.1 --port 3000`,
    "Restart=on-failure",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

function buildSystemdInstallScript() {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "UNIT_DIR=\"$HOME/.config/systemd/user\"",
    "mkdir -p \"$UNIT_DIR\"",
    "cp \"$(dirname \"$0\")/devagent-hub.service\" \"$UNIT_DIR/devagent-hub.service\"",
    "if command -v loginctl >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1; then",
    "  sudo loginctl enable-linger \"$USER\" || true",
    "fi",
    "systemctl --user daemon-reload",
    "systemctl --user enable --now devagent-hub.service",
    "systemctl --user status devagent-hub.service --no-pager",
    "",
  ].join("\n");
}

function buildSystemdUninstallScript() {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "systemctl --user disable --now devagent-hub.service || true",
    "rm -f \"$HOME/.config/systemd/user/devagent-hub.service\"",
    "systemctl --user daemon-reload",
    "echo 'DevAgent Hub systemd user service removed.'",
    "",
  ].join("\n");
}

function buildSecretsExample(settings) {
  return [
    "# Copy this file to secrets.env only if you need headless cloud-provider service mode.",
    "# Keep secrets.env outside git and readable only by the service user.",
    `${providerApiKeyName(settings.cloudProvider)}=`,
    "",
  ].join("\n");
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

  if (
    settings.runnerMode === "live" &&
    !settings.apiKey &&
    settings.selectedModelIds.some((modelId) => modelId.startsWith("open"))
  ) {
    warnings.push("Live mode with cloud models requires an API key in services/secrets.env or the process environment.");
  }

  return warnings;
}

function buildOllamaPullSteps(settings) {
  if (!settings.pullLocalModels) return [];

  return selectedOllamaModelNames(settings).map((modelName) => ({
    id: `ollama-pull-${modelName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
    label: `Pull Ollama model ${modelName}`,
    cwd: settings.installPath,
    command: platformCommand("ollama"),
    args: ["pull", modelName],
  }));
}

function selectedOllamaModelNames(settings) {
  const known = {
    "ollama-qwen25-coder-7b": "qwen2.5-coder:7b",
    "ollama-deepseek-coder-67b": "deepseek-coder:6.7b",
    "ollama-deepseek-coder-33b": "deepseek-coder:33b",
    "ollama-llama32-3b": "llama3.2:3b",
  };

  return uniqueStrings(
    settings.selectedModelIds
      .map((modelId) => known[modelId])
      .filter(Boolean),
  );
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveDefaultAgentsConfigPath() {
  const candidates = [
    path.join(PROJECT_ROOT, "configs", "agents.json"),
    path.join(process.resourcesPath || "", "defaults", "agents.json"),
  ];

  for (const candidate of candidates) {
    if (candidate && fsSync.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Default agents config was not found.");
}

function systemdEscape(value) {
  const text = String(value);
  if (!/[\s"'\\]/.test(text)) return text;
  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function buildReadme(settings, commands) {
  const serviceCommands = buildServiceCommands(settings);
  return [
    "DevAgent Hub install plan",
    "",
    `Project path: ${settings.installPath}`,
    `Repository: ${settings.repoUrl}`,
    `Default model: ${settings.modelId}`,
    `Enabled models: ${settings.selectedModelIds.join(", ")}`,
    `Runner mode: ${settings.runnerMode}`,
    "",
    "Run from terminal:",
    ...commands.map((command) => `  ${command}`),
    "",
    "Optional background service:",
    ...serviceCommands.map((command) => `  ${command}`),
    "",
    "For cloud models in headless service mode, copy services/secrets.env.example to services/secrets.env and fill the provider key.",
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
