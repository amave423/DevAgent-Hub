const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_REPO_URL = "https://github.com/amave423/Orqen-Studio.git";
const DEFAULT_MODEL_ID = "ollama-qwen25-coder-7b";
const DEFAULT_SERVICE_PORT = 3000;
const CODE_SERVER_VERSION = "4.117.0";

function getInstallerDefaults(isPackaged = false) {
  return {
    installPath: isPackaged
      ? path.join(os.homedir(), "Orqen Studio")
      : PROJECT_ROOT,
    repoUrl: DEFAULT_REPO_URL,
    platform: process.platform,
  };
}

async function checkSystem() {
  const [git, node, npm, python, ollama, codeServer] = await Promise.all([
    checkTool({
      id: "git",
      label: "Git",
      candidates: [commandCandidate("git", ["--version"])],
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
      candidates: [npmCommandCandidate(["--version"])],
      required: true,
    }),
    checkTool({
      id: "python",
      label: "Python 3.12+",
      candidates: pythonCandidates(),
      minVersion: [3, 12, 0],
      required: true,
    }),
    checkTool({
      id: "ollama",
      label: "Ollama",
      candidates: [commandCandidate(ollamaCommand(), ["--version"])],
      required: false,
    }),
    checkTool({
      id: "code-server",
      label: "Browser code editor",
      candidates: [
        commandCandidate("openvscode-server", ["--version"]),
        commandCandidate(platformCommand("code-server"), ["--version"]),
      ],
      required: false,
    }),
  ]);

  return [git, node, npm, python, ollama, codeServer];
}

async function prepareInstall(rawSettings) {
  const settings = normalizeSettings(rawSettings);

  assertSafeInstallPath(settings.installPath);
  await fs.mkdir(settings.installPath, { recursive: true });

  const runtimeConfigDir = path.join(settings.installPath, ".devagent");
  const serviceDir = path.join(settings.installPath, "services");
  const envPath = path.join(settings.installPath, ".env.local");
  const configPath = runtimeAgentsConfigPath(settings);
  const planPath = path.join(settings.installPath, "devagent-install-plan.json");
  const readmePath = path.join(settings.installPath, "README_INSTALL.txt");

  await fs.mkdir(runtimeConfigDir, { recursive: true });
  await fs.mkdir(serviceDir, { recursive: true });

  const agentsConfig = await buildAgentsConfig(settings);
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
    agentModelAssignments: settings.agentModelAssignments,
    runnerMode: settings.runnerMode,
    proxyConfigured: Boolean(settings.proxyUrl),
    cloudProvider: settings.cloudProvider,
    serviceUrl: serviceUrl(settings),
    externalAccess: settings.externalAccess,
    files: generatedFiles,
    commands,
    serviceCommands: buildServiceCommands(settings),
    warnings,
  };

  await fs.writeFile(configPath, `${JSON.stringify(agentsConfig, null, 2)}\n`, "utf8");
  await fs.writeFile(envPath, buildEnvFile(settings, configPath), "utf8");
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
  const python = projectPython(settings);

  return [
    {
      id: "python-venv",
      label: "Create Python 3.12 virtual environment",
      cwd: settings.installPath,
      command: process.platform === "win32" ? "py" : "python3.12",
      args: process.platform === "win32"
        ? ["-3.12", "-m", "venv", ".venv"]
        : ["-m", "venv", ".venv"],
    },
    {
      id: "python-api-deps",
      label: "Install API Python dependencies",
      cwd: settings.installPath,
      command: python,
      args: [
        "-m",
        "pip",
        "install",
        "-r",
        path.join(settings.installPath, "services", "agent-api", "requirements.txt"),
      ],
      timeoutMs: 300000,
    },
    {
      id: "browser-runtime-install",
      label: "Install browser automation runtime",
      cwd: settings.installPath,
      command: python,
      args: process.platform === "win32"
        ? ["-m", "playwright", "install", "chromium"]
        : ["-m", "playwright", "install", "--with-deps", "chromium"],
      timeoutMs: 900000,
    },
    {
      id: "node-deps",
      label: "Install Node.js dependencies",
      cwd: settings.installPath,
      ...npmStep(settings, "node-deps", "Install Node.js dependencies", ["install"]),
      timeoutMs: 600000,
    },
    {
      ...npmStep(settings, "web-build", "Build web UI", ["run", "build:web"]),
      timeoutMs: 300000,
    },
    {
      id: "code-editor-install",
      label: "Install browser code editor (optional)",
      cwd: settings.installPath,
      command: python,
      args: [
        path.join(settings.installPath, "scripts", "install_code_server.py"),
        "--workspace",
        settings.installPath,
        "--version",
        CODE_SERVER_VERSION,
      ],
      optional: true,
      timeoutMs: 900000,
    },
    ...buildOllamaPullSteps(settings),
    {
      id: "api-smoke",
      label: "Check Orqen Studio API",
      cwd: settings.installPath,
      command: python,
      args: [path.join(settings.installPath, "scripts", "smoke_devhub_api.py")],
      env: runtimeEnv(settings),
      timeoutMs: 180000,
    },
  ];
}

function buildProcessEnv(rawSettings) {
  const settings = normalizeSettings(rawSettings);
  return {
    ...process.env,
    ...runtimeEnv(settings),
  };
}

function runtimeEnv(settings) {
  const env = {
    AGENT_CONFIG_PATH: runtimeAgentsConfigPath(settings),
    AGENT_STUDIO_RUNNER_MODE: settings.runnerMode,
    DEVAGENT_WORKSPACE: settings.installPath,
    DEVAGENT_WEB_DIST: path.join(settings.installPath, "apps", "web", "dist"),
    DEVAGENT_HOST: settings.serviceHost,
    DEVAGENT_PORT: String(settings.servicePort),
    DEVAGENT_EXTERNAL_ACCESS: settings.externalAccess ? "true" : "false",
    OLLAMA_BASE_URL: "http://127.0.0.1:11434",
    NO_PROXY: "localhost,127.0.0.1",
  };

  if (settings.proxyUrl) {
    env.HTTP_PROXY = settings.proxyUrl;
    env.HTTPS_PROXY = settings.proxyUrl;
    env.NO_PROXY = "localhost,127.0.0.1";
  }

  if (settings.authToken) {
    env.DEVAGENT_AUTH_TOKEN = settings.authToken;
  }

  if (settings.apiKey) {
    env[providerApiKeyName(settings.cloudProvider)] = settings.apiKey;
  }
  for (const [provider, apiKey] of Object.entries(settings.apiKeys || {})) {
    if (apiKey) {
      env[providerApiKeyName(provider)] = apiKey;
    }
  }

  return env;
}

function buildDevHubLaunchStep(rawSettings, port = DEFAULT_SERVICE_PORT) {
  const settings = normalizeSettings(rawSettings);
  const servicePort = settings.servicePort || port;

  return {
    id: "devhub-start",
    label: "Start Orqen Studio",
    cwd: settings.installPath,
    command: projectPython(settings),
    args: [
      "-m",
      "uvicorn",
      "app.main:app",
      "--app-dir",
      path.join(settings.installPath, "services", "agent-api"),
      "--host",
      settings.serviceHost,
      "--port",
      String(servicePort),
    ],
    env: {
      ...runtimeEnv(settings),
      SERVE_FRONTEND: "true",
    },
    url: serviceUrl(settings),
  };
}

function commandCandidate(command, args) {
  return { command, args };
}

function npmCommandCandidate(args, installPath = PROJECT_ROOT) {
  const npm = npmCommand(installPath);
  return commandCandidate(npm.command, [...npm.args, ...args]);
}

function npmStep(settings, id, label, args) {
  const npm = npmCommand(settings.installPath);
  return {
    id,
    label,
    cwd: settings.installPath,
    command: npm.command,
    args: [...npm.args, ...args],
  };
}

function npmCommand(installPath = PROJECT_ROOT) {
  if (process.platform !== "win32") {
    return { command: "npm", args: [] };
  }

  const npmCli = [
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(installPath, ".tools", "node-v22", "node_modules", "npm", "bin", "npm-cli.js"),
  ].find((candidate) => fsSync.existsSync(candidate));

  if (npmCli) {
    return { command: process.execPath, args: [npmCli] };
  }

  return { command: "cmd.exe", args: ["/d", "/s", "/c", "npm.cmd"] };
}

function ollamaCommand() {
  return availableOllamaCommand() || (process.platform === "win32" ? "ollama.exe" : "ollama");
}

function availableOllamaCommand() {
  if (process.platform !== "win32") {
    return findInPath("ollama") ? "ollama" : null;
  }

  const candidates = [
    process.env.OLLAMA_COMMAND,
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe")
      : "",
    process.env.ProgramFiles
      ? path.join(process.env.ProgramFiles, "Ollama", "ollama.exe")
      : "",
  ].filter(Boolean);

  return candidates.find((candidate) => fsSync.existsSync(candidate)) || findInPath("ollama.exe");
}

function findInPath(command) {
  const pathEntries = String(process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);
  const hasExtension = Boolean(path.extname(command));
  const extensions = process.platform === "win32" && !hasExtension
    ? String(process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];

  for (const entry of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(entry, hasExtension ? command : `${command}${extension.toLowerCase()}`);
      const upperCandidate = path.join(entry, hasExtension ? command : `${command}${extension.toUpperCase()}`);
      if (fsSync.existsSync(candidate)) return candidate;
      if (fsSync.existsSync(upperCandidate)) return upperCandidate;
    }
  }

  return null;
}

function platformCommand(command) {
  if (process.platform !== "win32") return command;
  if (command === "ollama") return "ollama.exe";
  if (command === "code-server") return "code-server.cmd";
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
        problem: versionOk ? null : `Requires version ${minVersion.join(".")} or newer.`,
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
    problem: required ? "Not found in PATH." : "Optional tool is not installed.",
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
  const agentModelAssignments = normalizeAgentAssignments(
    rawSettings.agentModelAssignments ?? rawSettings.agentModels,
  );
  const requestedModelId = String(rawSettings.modelId || rawSettings.model || "").trim();
  const selectedModelIds = uniqueStrings([
    requestedModelId,
    ...selectedModelIdsInput,
    ...Object.values(agentModelAssignments),
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
    externalAccess: normalizeBoolean(rawSettings.externalAccess, false),
    serviceHost: normalizeBoolean(rawSettings.externalAccess, false) ? "0.0.0.0" : "127.0.0.1",
    servicePort: Number(rawSettings.servicePort || rawSettings.port || DEFAULT_SERVICE_PORT),
    authToken: String(rawSettings.authToken || "").trim() || (normalizeBoolean(rawSettings.externalAccess, false) ? crypto.randomBytes(18).toString("base64url") : ""),
    apiKey: String(rawSettings.apiKey || "").trim(),
    apiKeys: normalizeApiKeys(rawSettings),
    agentModelAssignments,
    cloudProvider,
    cloudBaseUrl: String(rawSettings.cloudBaseUrl || "").trim(),
    pullLocalModels: rawSettings.pullLocalModels !== false && rawSettings.pullLocalModels !== "false",
  };
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || fallback).trim();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "y", "on"].includes(String(value).trim().toLowerCase());
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

function normalizeAgentAssignments(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([agentId, modelId]) => [String(agentId).trim(), String(modelId || "").trim()])
        .filter(([agentId, modelId]) => agentId && modelId),
    );
  }

  const assignments = {};
  for (const item of parseModelIdList(value)) {
    const [agentId, modelId] = item.split("=", 2).map((part) => part?.trim());
    if (agentId && modelId) assignments[agentId] = modelId;
  }
  return assignments;
}

function normalizeApiKeys(rawSettings) {
  const fromObject = rawSettings.apiKeys && typeof rawSettings.apiKeys === "object"
    ? rawSettings.apiKeys
    : {};
  return {
    openrouter: String(rawSettings.openrouterApiKey || fromObject.openrouter || "").trim(),
    openai: String(rawSettings.openaiApiKey || fromObject.openai || "").trim(),
    custom: String(rawSettings.customApiKey || fromObject.custom || "").trim(),
  };
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
    throw new Error("Refusing to use a filesystem root as the project directory.");
  }
}

async function buildAgentsConfig(settings) {
  const sourcePath = await resolveDefaultAgentsConfigPath();
  const rawConfig = await fs.readFile(sourcePath, "utf8");
  const config = JSON.parse(rawConfig);
  const selectedModelIds = new Set(settings.selectedModelIds);
  const selectedModels = config.models
    .filter((model) => selectedModelIds.has(model.id))
    .map((model) => applyCloudBaseUrl({ ...model, modelName: model.modelName || model.name }, settings));

  if (selectedModels.length === 0) {
    throw new Error(`Selected models were not found in the default config: ${settings.selectedModelIds.join(", ")}`);
  }

  const defaultModelId = selectedModels.some((model) => model.id === settings.modelId)
    ? settings.modelId
    : selectedModels[0].id;

  config.models = selectedModels;
  config.agents = config.agents.map((agent) => {
    const assignedModelId = settings.agentModelAssignments[agent.id];
    return {
      ...agent,
      modelId: selectedModelIds.has(assignedModelId) ? assignedModelId : defaultModelId,
    };
  });
  config.runtime = {
    ...config.runtime,
    runnerMode: settings.runnerMode,
  };

  return config;
}

function applyCloudBaseUrl(model, settings) {
  if (
    settings.cloudBaseUrl &&
    model.kind === "cloud" &&
    (settings.cloudProvider === "custom" || model.provider === settings.cloudProvider)
  ) {
    return {
      ...model,
      baseUrl: settings.cloudBaseUrl,
    };
  }

  return model;
}

function buildEnvFile(settings, configPath) {
  const env = runtimeEnv(settings);
  const lines = [
    "# Orqen Studio local runtime",
    `AGENT_CONFIG_PATH=${quoteEnv(configPath)}`,
    `DEVAGENT_WORKSPACE=${quoteEnv(env.DEVAGENT_WORKSPACE)}`,
    `DEVAGENT_WEB_DIST=${quoteEnv(env.DEVAGENT_WEB_DIST)}`,
    `DEVAGENT_HOST=${settings.serviceHost}`,
    `DEVAGENT_PORT=${settings.servicePort}`,
    `DEVAGENT_EXTERNAL_ACCESS=${settings.externalAccess ? "true" : "false"}`,
    `AGENT_STUDIO_RUNNER_MODE=${settings.runnerMode}`,
    "OLLAMA_BASE_URL=http://127.0.0.1:11434",
    "NO_PROXY=localhost,127.0.0.1",
  ];

  if (settings.proxyUrl) {
    lines.push(`HTTP_PROXY=${settings.proxyUrl}`);
    lines.push(`HTTPS_PROXY=${settings.proxyUrl}`);
    lines.push("NO_PROXY=localhost,127.0.0.1");
  }

  lines.push("");
  lines.push("# API keys are not stored here. Put service secrets in services/secrets.env.");
  for (const provider of selectedCloudProviders(settings)) {
    lines.push(`# ${providerApiKeyName(provider)}=`);
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

function selectedCloudProviders(settings) {
  const providers = [];
  if (settings.selectedModelIds.some((modelId) => modelId.startsWith("openrouter-"))) {
    providers.push("openrouter");
  }
  if (settings.selectedModelIds.some((modelId) => modelId.startsWith("openai-"))) {
    providers.push("openai");
  }
  if (settings.cloudProvider === "custom") {
    providers.push("custom");
  }
  return uniqueStrings(providers);
}

function quoteEnv(value) {
  const text = String(value);
  if (!/[\s#"\\]/.test(text)) return text;
  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function buildInstallCommands(settings) {
  const modelPulls = selectedOllamaModelNames(settings).map((modelName) => `ollama pull ${modelName}`);
  const editorInstallWin = `.\\.venv\\Scripts\\python.exe .\\scripts\\install_code_server.py --workspace "${settings.installPath}" --version ${CODE_SERVER_VERSION}`;
  const editorInstallLinux = `./.venv/bin/python ./scripts/install_code_server.py --workspace "${settings.installPath}" --version ${CODE_SERVER_VERSION}`;

  if (process.platform === "win32") {
    return [
      `Set-Location "${settings.installPath}"`,
      "py -3.12 -m venv .venv",
      ".\\.venv\\Scripts\\python.exe -m pip install -r .\\services\\agent-api\\requirements.txt",
      ".\\.venv\\Scripts\\python.exe -m playwright install chromium",
      "npm install",
      "npm run build:web",
      editorInstallWin,
      ...modelPulls,
      ".\\.venv\\Scripts\\python.exe .\\scripts\\smoke_devhub_api.py",
      ".\\services\\install-windows-task.ps1",
    ];
  }

  return [
    `cd "${settings.installPath}"`,
    "python3.12 -m venv .venv",
    "./.venv/bin/python -m pip install -r ./services/agent-api/requirements.txt",
    "./.venv/bin/python -m playwright install --with-deps chromium",
    "npm install",
    "npm run build:web",
    editorInstallLinux,
    ...modelPulls,
    "./.venv/bin/python ./scripts/smoke_devhub_api.py",
    "./services/install-linux-systemd.sh",
  ];
}

function buildServiceFiles(settings) {
  const serviceDir = path.join(settings.installPath, "services");
  return [
    {
      path: path.join(serviceDir, "start-devagent-hub.ps1"),
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
    "  Get-Content -LiteralPath $Path -Encoding UTF8 | ForEach-Object {",
    "    $Line = $_.Trim()",
    "    if (!$Line -or $Line.StartsWith('#') -or !$Line.Contains('=')) { return }",
    "    $Name, $Value = $Line.Split('=', 2)",
    "    [Environment]::SetEnvironmentVariable($Name.Trim(), $Value.Trim().Trim('\"'), 'Process')",
    "  }",
    "}",
    "Import-EnvFile $EnvFile",
    "Import-EnvFile $SecretsFile",
    "$env:SERVE_FRONTEND = 'true'",
    "$env:DEVAGENT_WORKSPACE = \"$ProjectRoot\"",
    "$env:AGENT_CONFIG_PATH = Join-Path $ProjectRoot '.devagent\\agents.json'",
    "$env:DEVAGENT_WEB_DIST = Join-Path $ProjectRoot 'apps\\web\\dist'",
    "if (!$env:DEVAGENT_HOST) { $env:DEVAGENT_HOST = '127.0.0.1' }",
    "if (!$env:DEVAGENT_PORT) { $env:DEVAGENT_PORT = '3000' }",
    "$Python = Join-Path $ProjectRoot '.venv\\Scripts\\python.exe'",
    "$ApiDir = Join-Path $ProjectRoot 'services\\agent-api'",
    "Set-Location $ProjectRoot",
    "try {",
    "  $Health = Invoke-WebRequest -UseBasicParsing -Uri \"http://127.0.0.1:$($env:DEVAGENT_PORT)/health\" -TimeoutSec 2",
    "  if ($Health.StatusCode -eq 200) { return }",
    "} catch {",
    "}",
    "& $Python -m uvicorn app.main:app --app-dir $ApiDir --host $env:DEVAGENT_HOST --port $env:DEVAGENT_PORT",
    "",
  ].join("\n");
}

function buildWindowsTaskInstallScript() {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$TaskName = 'Orqen Studio'",
    "$ScriptPath = Join-Path $PSScriptRoot 'start-devagent-hub.ps1'",
    "$PowerShell = (Get-Command powershell.exe).Source",
    "$Arguments = \"-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `\"$ScriptPath`\"\"",
    "function Install-StartupShortcut {",
    "  $StartupDir = [Environment]::GetFolderPath('Startup')",
    "  $ShortcutPath = Join-Path $StartupDir 'Orqen Studio.lnk'",
    "  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path",
    "  try {",
    "    $Shell = New-Object -ComObject WScript.Shell",
    "    $Shortcut = $Shell.CreateShortcut($ShortcutPath)",
    "    $Shortcut.TargetPath = $PowerShell",
    "    $Shortcut.Arguments = $Arguments",
    "    $Shortcut.WorkingDirectory = $ProjectRoot",
    "    $Shortcut.WindowStyle = 7",
    "    $Shortcut.Description = 'Start Orqen Studio'",
    "    $Shortcut.Save()",
    "  } catch {",
    "    $CmdPath = Join-Path $StartupDir 'Orqen Studio.cmd'",
    "    Set-Content -LiteralPath $CmdPath -Encoding ASCII -Value \"@echo off`r`nstart `\"`\" /min powershell.exe $Arguments`r`n\"",
    "  }",
    "  Start-Process -FilePath $PowerShell -ArgumentList $Arguments -WindowStyle Hidden",
    "  Write-Host 'Orqen Studio startup shortcut installed and service start requested.'",
    "}",
    "try {",
    "  $Action = New-ScheduledTaskAction -Execute $PowerShell -Argument $Arguments",
    "  $Trigger = New-ScheduledTaskTrigger -AtLogOn",
    "  $UserId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name",
    "  $Principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType Interactive -RunLevel Limited",
    "  Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Force -ErrorAction Stop | Out-Null",
    "  Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop",
    "  Write-Host 'Orqen Studio scheduled task installed and service start requested.'",
    "} catch {",
    "  Write-Warning \"Scheduled Task installation failed: $($_.Exception.Message)\"",
    "  Write-Warning 'Using current-user Startup shortcut fallback instead.'",
    "  Install-StartupShortcut",
    "}",
    "",
  ].join("\n");
}

function buildWindowsTaskUninstallScript() {
  return [
    "$TaskName = 'Orqen Studio'",
    "if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {",
    "  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue",
    "  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false",
    "}",
    "$StartupDir = [Environment]::GetFolderPath('Startup')",
    "Remove-Item -LiteralPath (Join-Path $StartupDir 'Orqen Studio.lnk') -ErrorAction SilentlyContinue",
    "Remove-Item -LiteralPath (Join-Path $StartupDir 'Orqen Studio.cmd') -ErrorAction SilentlyContinue",
    "Write-Host 'Orqen Studio scheduled task/startup shortcut removed.'",
    "",
  ].join("\n");
}

function buildSystemdUnit(settings) {
  const projectRoot = settings.installPath;
  const python = path.join(projectRoot, ".venv", "bin", "python");
  const apiDir = path.join(projectRoot, "services", "agent-api");
  return [
    "[Unit]",
    "Description=Orqen Studio",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${systemdEscape(projectRoot)}`,
    `EnvironmentFile=-${systemdEscape(path.join(projectRoot, ".env.local"))}`,
    `EnvironmentFile=-${systemdEscape(path.join(projectRoot, "services", "secrets.env"))}`,
    "Environment=SERVE_FRONTEND=true",
    systemdEnvironment("DEVAGENT_WORKSPACE", projectRoot),
    systemdEnvironment("DEVAGENT_WEB_DIST", path.join(projectRoot, "apps", "web", "dist")),
    systemdEnvironment("DEVAGENT_HOST", settings.serviceHost),
    systemdEnvironment("DEVAGENT_PORT", String(settings.servicePort)),
    systemdEnvironment("DEVAGENT_EXTERNAL_ACCESS", settings.externalAccess ? "true" : "false"),
    `ExecStart=${systemdEscape(python)} -m uvicorn app.main:app --app-dir ${systemdEscape(apiDir)} --host ${settings.serviceHost} --port ${settings.servicePort}`,
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
    "systemctl --user enable devagent-hub.service",
    "systemctl --user restart devagent-hub.service",
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
    "echo 'Orqen Studio systemd user service removed.'",
    "",
  ].join("\n");
}

function buildSecretsExample(settings) {
  return [
    "# Copy this file to secrets.env only if you need headless cloud-provider service mode.",
    "# Keep secrets.env outside git and readable only by the service user.",
    settings.externalAccess ? `DEVAGENT_AUTH_TOKEN=${settings.authToken || "change-me"}` : "# DEVAGENT_AUTH_TOKEN=",
    `${providerApiKeyName(settings.cloudProvider)}=`,
    "",
  ].join("\n");
}

async function buildWarnings(settings) {
  const warnings = [];
  const packagePath = path.join(settings.installPath, "package.json");

  if (!(await pathExists(packagePath))) {
    warnings.push(
      `No package.json was found in the selected path. The installer will clone ${settings.repoUrl} first.`,
    );
  }

  if (
    settings.runnerMode === "live" &&
    settings.selectedModelIds.some((modelId) => modelId.startsWith("open")) &&
    !hasAnyCloudApiKey(settings)
  ) {
    warnings.push("Live mode with cloud models requires an API key in services/secrets.env or the process environment.");
  }

  if (settings.pullLocalModels && selectedOllamaModelNames(settings).length > 0) {
    const command = availableOllamaCommand();
    if (!command) {
      warnings.push("Ollama is not available in PATH. Local model pull will be skipped as a non-fatal installer step.");
    } else {
      const ollama = await runCommand(command, ["--version"]);
      if (ollama.error) {
        warnings.push("Ollama is not available in PATH. Local model pull will be skipped as a non-fatal installer step.");
      }
    }
  }

  return warnings;
}

function buildOllamaPullSteps(settings) {
  if (!settings.pullLocalModels) return [];
  const command = availableOllamaCommand();
  if (!command) return [];

  return selectedOllamaModelNames(settings).map((modelName) => ({
    id: `ollama-pull-${modelName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
    label: `Pull Ollama model ${modelName} (optional)`,
    cwd: settings.installPath,
    command,
    args: ["pull", modelName],
    optional: true,
    timeoutMs: 1800000,
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

function hasAnyCloudApiKey(settings) {
  if (settings.apiKey) return true;
  return Object.values(settings.apiKeys || {}).some((apiKey) => Boolean(apiKey));
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

function runtimeAgentsConfigPath(settings) {
  return path.join(settings.installPath, ".devagent", "agents.json");
}

function projectPython(settings) {
  return process.platform === "win32"
    ? path.join(settings.installPath, ".venv", "Scripts", "python.exe")
    : path.join(settings.installPath, ".venv", "bin", "python");
}

function systemdEscape(value) {
  const text = String(value);
  if (!/[\s"'\\]/.test(text)) return text;
  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function systemdEnvironment(name, value) {
  return `Environment=${name}=${systemdEscape(value)}`;
}

function formatAgentAssignments(assignments) {
  const entries = Object.entries(assignments || {});
  if (entries.length === 0) return "all agents use default model";
  return entries.map(([agentId, modelId]) => `${agentId}=${modelId}`).join(", ");
}

function buildReadme(settings, commands) {
  const serviceCommands = buildServiceCommands(settings);
  const urls = [`Web UI: ${serviceUrl(settings)}`];
  if (settings.externalAccess) {
    const detectedUrls = lanUrls(settings.servicePort);
    urls.push(detectedUrls.length ? `LAN URL: ${detectedUrls.join(", ")}` : "LAN URL: open http://<this-machine-LAN-IP>:" + settings.servicePort);
    urls.push("LAN access token: stored in services/secrets.env as DEVAGENT_AUTH_TOKEN");
  }
  return [
    "Orqen Studio install plan",
    "",
    `Project path: ${settings.installPath}`,
    `Repository: ${settings.repoUrl}`,
    `Default model: ${settings.modelId}`,
    `Enabled models: ${settings.selectedModelIds.join(", ")}`,
    `Per-agent models: ${formatAgentAssignments(settings.agentModelAssignments)}`,
    `Runner mode: ${settings.runnerMode}`,
    ...urls,
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

function serviceUrl(settings) {
  return `http://127.0.0.1:${settings.servicePort || DEFAULT_SERVICE_PORT}`;
}

function lanUrls(port) {
  const urls = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      urls.push(`http://${entry.address}:${port}`);
    }
  }
  return urls;
}

module.exports = {
  buildDevHubLaunchStep,
  buildInstallExecutionSteps,
  buildProcessEnv,
  checkSystem,
  getInstallerDefaults,
  normalizeSettings,
  prepareInstall,
};
