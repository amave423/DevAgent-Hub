#!/usr/bin/env node

const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline/promises");

const {
  buildInstallExecutionSteps,
  buildProcessEnv,
  getInstallerDefaults,
  normalizeSettings,
  prepareInstall,
} = require("./install-service");
const { InstallCommandRunner } = require("./install-runner");

const PROJECT_ROOT = path.resolve(__dirname, "..");

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const defaultConfig = await loadDefaultConfig();
  const modelOptions = defaultConfig.models;
  const interactive = process.stdin.isTTY && !args.yes && !args.nonInteractive;
  const rawSettings = await collectSettings(args, modelOptions, defaultConfig.agents, interactive);
  const settings = normalizeSettings(rawSettings);
  const shouldRunInstall = !args.prepareOnly && !args.skipInstall;
  const shouldStartService = shouldRunInstall && !args.skipService && rawSettings.startService !== false;

  await ensureRepository(settings);

  console.log("\nPreparing DevAgent Hub configuration...");
  const prepared = await prepareInstall(settings);
  await writeSecretsEnv(settings);
  printPreparation(prepared);

  if (args.prepareOnly) {
    console.log("\nPrepare-only mode complete.");
    return;
  }

  if (shouldRunInstall) {
    await runInstall(settings);
  }

  if (shouldStartService) {
    await installService(settings);
  }

  console.log("\nDevAgent Hub is ready.");
  console.log(shouldStartService
    ? `Web UI: http://127.0.0.1:${settings.servicePort || 3000}`
    : "Manual start: services/start-devagent-hub.ps1 on Windows, or services/install-linux-systemd.sh on Linux.");
  if (settings.externalAccess) {
    const urls = lanUrls(settings.servicePort || 3000);
    if (urls.length) {
      console.log(`LAN access: ${urls.join(", ")}`);
    } else {
      console.log(`LAN access: http://<this-machine-LAN-IP>:${settings.servicePort || 3000}`);
    }
    console.log("LAN token: services/secrets.env -> DEVAGENT_AUTH_TOKEN");
  }
  console.log(`Install path: ${settings.installPath}`);
}

async function collectSettings(args, modelOptions, agentOptions, interactive) {
  const defaults = getInstallerDefaults(false);
  const base = {
    installPath: args.installPath || defaults.installPath,
    repoUrl: args.repoUrl || defaults.repoUrl,
    selectedModelIds: parseList(args.models || args.selectedModelIds),
    modelId: args.modelId || args.model,
    agentModelAssignments: parseAgentAssignments(args.agentModels || args.agentModelAssignments),
    runnerMode: args.runnerMode || "auto",
    proxyUrl: args.proxyUrl || args.proxy || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "",
    apiKey: args.apiKey || "",
    apiKeys: {
      openrouter: args.openrouterApiKey || "",
      openai: args.openaiApiKey || "",
      custom: args.customApiKey || "",
    },
    cloudProvider: args.cloudProvider || "openrouter",
    cloudBaseUrl: args.cloudBaseUrl || "",
    pullLocalModels: args.noModelPull ? false : args.pullLocalModels,
    externalAccess: args.externalAccess || false,
    authToken: args.authToken || "",
    servicePort: args.port || args.servicePort || 3000,
    startService: args.startService,
  };

  if (!interactive) {
    if (base.selectedModelIds.length === 0) {
      base.selectedModelIds = [base.modelId || "ollama-qwen25-coder-7b"];
    }
    if (!base.modelId) base.modelId = base.selectedModelIds[0];
    if (base.pullLocalModels === undefined) base.pullLocalModels = true;
    if (base.startService === undefined) base.startService = true;
    return base;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    base.installPath = await question(rl, "Install path", base.installPath);

    const selectedModels = await promptModels(rl, modelOptions, base.selectedModelIds);
    base.selectedModelIds = selectedModels.map((model) => model.id);
    base.modelId = await promptDefaultModel(rl, selectedModels, base.modelId);
    base.runnerMode = await promptChoice(rl, "Runner mode", ["auto", "live", "mock"], base.runnerMode);
    base.proxyUrl = await question(rl, "Proxy URL (empty if none)", base.proxyUrl);

    const cloudProviders = selectedCloudProviders(selectedModels);
    if (cloudProviders.length > 0) {
      console.log("\nCloud model providers:");
      for (const provider of cloudProviders) {
        const argKey = `${provider}ApiKey`;
        const current = base.apiKeys[provider] || args[argKey] || "";
        base.apiKeys[provider] = await question(rl, `${provider} API key (empty to skip)`, current);
      }
      base.cloudProvider = cloudProviders[0] || base.cloudProvider;
      base.cloudBaseUrl = await question(rl, "Custom cloud base URL (empty for provider default)", base.cloudBaseUrl);
    }

    base.agentModelAssignments = {};

    if (selectedModels.some((model) => model.provider === "ollama")) {
      base.pullLocalModels = await yesNo(
        rl,
        "Download selected Ollama models now (you can also install local models later in Settings)",
        false,
      );
    } else {
      base.pullLocalModels = false;
    }

    base.startService = await yesNo(rl, "Install and start background service", true);
    base.externalAccess = await yesNo(rl, "Allow access from other devices on the same LAN", false);
    if (base.externalAccess) {
      base.authToken = await question(rl, "LAN access token (empty to generate)", base.authToken);
    }
    return base;
  } finally {
    rl.close();
  }
}

async function promptAgentModels(rl, agents, selectedModels, defaultModelId) {
  const assignments = {};
  console.log("\nPer-agent model assignment:");
  agents
    .slice()
    .sort((left, right) => left.order - right.order)
    .forEach((agent, index) => {
      console.log(`  ${index + 1}. ${agent.name} (${agent.id})`);
    });

  for (const agent of agents.slice().sort((left, right) => left.order - right.order)) {
    const defaultIndex = Math.max(
      selectedModels.findIndex((model) => model.id === (assignments[agent.id] || defaultModelId)),
      0,
    ) + 1;
    for (;;) {
      const answer = await question(rl, `${agent.name} model number or id`, String(defaultIndex));
      const selected = parseModelSelection(answer, selectedModels);
      if (selected.length > 0) {
        assignments[agent.id] = selected[0].id;
        break;
      }
      console.log("No valid model selected.");
    }
  }
  return assignments;
}

async function promptModels(rl, modelOptions, selectedIds) {
  console.log("\nRecommended models:");
  console.log("  Choose models to expose in the web UI now. Local models can be downloaded now or later from Settings.");
  modelOptions.forEach((model, index) => {
    const req = model.requirements
      ? ` RAM ${model.requirements.ramGb || "?"}GB, disk ${model.requirements.diskGb || "?"}GB`
      : "";
    console.log(`  ${index + 1}. ${model.id} (${model.provider}/${model.kind})${req}`);
    if (model.description) console.log(`     ${model.description}`);
  });

  const defaultIndexes = selectedIds.length
    ? selectedIds
      .map((id) => modelOptions.findIndex((model) => model.id === id) + 1)
      .filter((index) => index > 0)
      .join(",")
    : "1";

  for (;;) {
    const answer = await question(rl, "Select models by number or id, comma-separated", defaultIndexes);
    const selected = parseModelSelection(answer, modelOptions);
    if (selected.length > 0) return selected;
    console.log("No valid models selected.");
  }
}

async function promptDefaultModel(rl, selectedModels, currentModelId) {
  if (selectedModels.length === 1) return selectedModels[0].id;

  console.log("\nDefault model for all agents:");
  selectedModels.forEach((model, index) => {
    console.log(`  ${index + 1}. ${model.id}`);
  });

  const defaultIndex = Math.max(
    selectedModels.findIndex((model) => model.id === currentModelId),
    0,
  ) + 1;

  for (;;) {
    const answer = await question(rl, "Default model number or id", String(defaultIndex));
    const selected = parseModelSelection(answer, selectedModels);
    if (selected.length > 0) return selected[0].id;
    console.log("No valid default model selected.");
  }
}

async function promptChoice(rl, label, choices, defaultValue) {
  const normalizedDefault = choices.includes(defaultValue) ? defaultValue : choices[0];
  for (;;) {
    const answer = await question(rl, `${label} (${choices.join("/")})`, normalizedDefault);
    if (choices.includes(answer)) return answer;
    console.log(`Choose one of: ${choices.join(", ")}`);
  }
}

async function yesNo(rl, label, defaultValue) {
  const suffix = defaultValue ? "Y/n" : "y/N";
  for (;;) {
    const answer = (await question(rl, `${label} [${suffix}]`, defaultValue ? "y" : "n")).toLowerCase();
    if (["y", "yes"].includes(answer)) return true;
    if (["n", "no"].includes(answer)) return false;
  }
}

async function question(rl, label, defaultValue) {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await rl.question(`${label}${suffix}: `);
  return answer.trim() || defaultValue || "";
}

function parseModelSelection(value, modelOptions) {
  const tokens = parseList(value);
  const selected = [];

  for (const token of tokens) {
    const numeric = Number(token);
    const byIndex = Number.isInteger(numeric) ? modelOptions[numeric - 1] : null;
    const byId = modelOptions.find((model) => model.id === token);
    const model = byIndex || byId;

    if (model && !selected.some((item) => item.id === model.id)) {
      selected.push(model);
    }
  }

  return selected;
}

function selectedCloudProviders(models) {
  return [...new Set(models.filter((model) => model.kind === "cloud").map((model) => model.provider))];
}

function parseAgentAssignments(value) {
  const assignments = {};
  for (const item of parseList(value)) {
    const [agentId, modelId] = item.split("=", 2).map((part) => part?.trim());
    if (agentId && modelId) assignments[agentId] = modelId;
  }
  return assignments;
}

function parseList(value) {
  if (Array.isArray(value)) return value.flatMap(parseList);
  if (!value) return [];
  return String(value)
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function loadDefaultConfig() {
  const configPath = path.join(PROJECT_ROOT, "configs", "agents.json");
  return JSON.parse(await fs.readFile(configPath, "utf8"));
}

async function ensureRepository(settings) {
  const packagePath = path.join(settings.installPath, "package.json");
  if (fsSync.existsSync(packagePath)) return;

  const parent = path.dirname(settings.installPath);
  await fs.mkdir(parent, { recursive: true });

  if (fsSync.existsSync(settings.installPath)) {
    const entries = await fs.readdir(settings.installPath);
    if (entries.length > 0) {
      throw new Error(`Install path exists but is not a DevAgent Hub repo: ${settings.installPath}`);
    }
  }

  console.log(`\nCloning ${settings.repoUrl} into ${settings.installPath}...`);
  await runCommand("git", ["clone", "--depth", "1", settings.repoUrl, settings.installPath], {
    cwd: parent,
  });
}

async function writeSecretsEnv(settings) {
  const entries = [];
  if (settings.externalAccess && settings.authToken) {
    entries.push(`DEVAGENT_AUTH_TOKEN=${settings.authToken}`);
  }
  entries.push(...Object.entries(settings.apiKeys || {})
    .filter(([, value]) => String(value || "").trim())
    .map(([provider, value]) => `${providerApiKeyName(provider)}=${value}`));
  if (settings.apiKey) {
    entries.push(`${providerApiKeyName(settings.cloudProvider)}=${settings.apiKey}`);
  }
  if (entries.length === 0) return;

  const secretsPath = path.join(settings.installPath, "services", "secrets.env");
  const content = `${[...new Set(entries)].join("\n")}\n`;
  await fs.writeFile(secretsPath, content, "utf8");

  if (process.platform !== "win32") {
    await fs.chmod(secretsPath, 0o600);
  }
}

function providerApiKeyName(provider) {
  if (provider === "openai") return "AGENT_STUDIO_OPENAI_API_KEY";
  if (provider === "openrouter") return "AGENT_STUDIO_OPENROUTER_API_KEY";
  return "AGENT_STUDIO_API_KEY";
}

function printPreparation(result) {
  if (result.warnings.length > 0) {
    console.log("\nWarnings:");
    result.warnings.forEach((warning) => console.log(`  - ${warning}`));
  }

  console.log("\nGenerated files:");
  result.files.forEach((file) => console.log(`  - ${file}`));
}

async function runInstall(settings) {
  console.log("\nRunning installation steps...");
  const runner = new InstallCommandRunner({
    steps: buildInstallExecutionSteps(settings),
    env: buildProcessEnv(settings),
  });

  runner.on("event", (event) => {
    if (event.type === "step-start") {
      console.log(`\n[${event.index + 1}/${event.totalSteps}] ${event.label}`);
      console.log(`$ ${event.command}`);
      return;
    }

    if (event.type === "stdout") {
      process.stdout.write(event.message);
      return;
    }

    if (event.type === "stderr") {
      process.stderr.write(event.message);
      return;
    }

    if (event.type === "step-complete") {
      console.log(`Done: ${event.label}`);
      return;
    }

    if (event.type === "step-warning") {
      console.warn(`Warning: ${event.label}: ${event.message}`);
      return;
    }

    if (event.type === "run-failed") {
      console.error(`Failed: ${event.label || event.stepId}: ${event.message}`);
    }
  });

  await runner.run();
}

async function installService(settings) {
  console.log("\nInstalling background service...");
  const serviceDir = path.join(settings.installPath, "services");

  if (process.platform === "win32") {
    await runCommand("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(serviceDir, "install-windows-task.ps1"),
    ], { cwd: serviceDir });
    return;
  }

  await runCommand(path.join(serviceDir, "install-linux-systemd.sh"), [], {
    cwd: serviceDir,
  });
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      shell: false,
      windowsHide: true,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function parseArgs(argv) {
  const result = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = toCamelCase(rawKey);

    if (["yes", "nonInteractive", "prepareOnly", "skipInstall", "skipService", "startService", "noModelPull", "externalAccess", "help"].includes(key)) {
      result[key] = true;
      continue;
    }

    if (key === "noService") {
      result.skipService = true;
      continue;
    }
    if (key === "noExternalAccess") {
      result.externalAccess = false;
      continue;
    }

    const value = inlineValue !== undefined ? inlineValue : argv[index + 1];
    if (inlineValue === undefined) index += 1;
    result[key] = value;
  }

  return result;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function printHelp() {
  console.log(`
DevAgent Hub terminal installer

Usage:
  node installer/cli.js [options]

Options:
  --yes                         Non-interactive install with defaults.
  --install-path <path>          Target repo path.
  --repo-url <url>               Git repository URL.
  --models <ids>                 Comma-separated model ids to expose in UI.
  --model <id>                   Default model assigned to all agents.
  --agent-models <pairs>          Comma-separated agent=model pairs.
  --runner-mode <auto|live|mock> Agent runner mode.
  --proxy <url>                  HTTP/HTTPS proxy URL.
  --external-access              Bind the service to LAN with token protection.
  --no-external-access           Force localhost-only service binding.
  --auth-token <token>           Token for LAN API/terminal access.
  --port <port>                  Service port, default 3000.
  --cloud-provider <provider>    openrouter, openai, or custom.
  --cloud-base-url <url>         Custom OpenAI-compatible base URL.
  --api-key <key>                Key written to services/secrets.env.
  --openrouter-api-key <key>      OpenRouter key written to services/secrets.env.
  --openai-api-key <key>          OpenAI key written to services/secrets.env.
  --prepare-only                 Generate config and service files only.
  --skip-install                 Do not run dependency/build/smoke steps.
  --skip-service                 Do not install/start background service.
  --no-model-pull                Do not run ollama pull for local models.
`);
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

main().catch((error) => {
  console.error(`\nInstaller failed: ${error.message}`);
  process.exitCode = 1;
});
