#!/usr/bin/env node

const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
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

  const modelOptions = await loadModelOptions();
  const interactive = process.stdin.isTTY && !args.yes && !args.nonInteractive;
  const rawSettings = await collectSettings(args, modelOptions, interactive);
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
  console.log("Web UI: http://127.0.0.1:3000");
  console.log(`Install path: ${settings.installPath}`);
}

async function collectSettings(args, modelOptions, interactive) {
  const defaults = getInstallerDefaults(false);
  const base = {
    installPath: args.installPath || defaults.installPath,
    repoUrl: args.repoUrl || defaults.repoUrl,
    selectedModelIds: parseList(args.models || args.selectedModelIds),
    modelId: args.modelId || args.model,
    runnerMode: args.runnerMode || "auto",
    proxyUrl: args.proxyUrl || args.proxy || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "",
    apiKey: args.apiKey || "",
    cloudProvider: args.cloudProvider || "openrouter",
    cloudBaseUrl: args.cloudBaseUrl || "",
    pullLocalModels: args.noModelPull ? false : args.pullLocalModels,
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
    base.repoUrl = await question(rl, "Repository URL", base.repoUrl);

    const selectedModels = await promptModels(rl, modelOptions, base.selectedModelIds);
    base.selectedModelIds = selectedModels.map((model) => model.id);
    base.modelId = await promptDefaultModel(rl, selectedModels, base.modelId);
    base.runnerMode = await promptChoice(rl, "Runner mode", ["auto", "live", "mock"], base.runnerMode);
    base.proxyUrl = await question(rl, "Proxy URL (empty if none)", base.proxyUrl);

    if (selectedModels.some((model) => model.kind === "cloud")) {
      base.cloudProvider = await promptChoice(
        rl,
        "Cloud API key provider",
        ["openrouter", "openai", "custom"],
        base.cloudProvider,
      );
      base.cloudBaseUrl = await question(rl, "Custom/cloud base URL (empty for provider default)", base.cloudBaseUrl);
      base.apiKey = await question(rl, "Cloud API key (empty to skip)", base.apiKey);
    }

    if (selectedModels.some((model) => model.provider === "ollama")) {
      base.pullLocalModels = await yesNo(rl, "Pull selected Ollama models during install", true);
    } else {
      base.pullLocalModels = false;
    }

    base.startService = await yesNo(rl, "Install and start background service", true);
    return base;
  } finally {
    rl.close();
  }
}

async function promptModels(rl, modelOptions, selectedIds) {
  console.log("\nAvailable models:");
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

function parseList(value) {
  if (Array.isArray(value)) return value.flatMap(parseList);
  if (!value) return [];
  return String(value)
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function loadModelOptions() {
  const configPath = path.join(PROJECT_ROOT, "configs", "agents.json");
  const payload = JSON.parse(await fs.readFile(configPath, "utf8"));
  return payload.models;
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
  if (!settings.apiKey) return;

  const secretsPath = path.join(settings.installPath, "services", "secrets.env");
  const content = `${providerApiKeyName(settings.cloudProvider)}=${settings.apiKey}\n`;
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

    if (["yes", "nonInteractive", "prepareOnly", "skipInstall", "skipService", "startService", "noModelPull", "help"].includes(key)) {
      result[key] = true;
      continue;
    }

    if (key === "noService") {
      result.skipService = true;
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
  --runner-mode <auto|live|mock> Agent runner mode.
  --proxy <url>                  HTTP/HTTPS proxy URL.
  --cloud-provider <provider>    openrouter, openai, or custom.
  --cloud-base-url <url>         Custom OpenAI-compatible base URL.
  --api-key <key>                Key written to services/secrets.env.
  --prepare-only                 Generate config and service files only.
  --skip-install                 Do not run dependency/build/smoke steps.
  --skip-service                 Do not install/start background service.
  --no-model-pull                Do not run ollama pull for local models.
`);
}

main().catch((error) => {
  console.error(`\nInstaller failed: ${error.message}`);
  process.exitCode = 1;
});
