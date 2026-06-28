const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  buildDevHubLaunchStep,
  buildInstallExecutionSteps,
  buildProcessEnv,
  prepareInstall,
} = require("../installer/install-service");

async function main() {
  const installPath = await fs.mkdtemp(path.join(os.tmpdir(), "devagent-installer-"));

  try {
    const result = await prepareInstall({
      installPath,
      repoUrl: "https://github.com/amave423/DevAgent-Hub.git",
      modelId: "openrouter-auto",
      selectedModelIds: ["ollama-qwen25-coder-7b", "openrouter-auto", "openai-gpt-4o-mini"],
      agentModelAssignments: {
        generator: "ollama-qwen25-coder-7b",
        critic: "openrouter-auto",
        finalizer: "openai-gpt-4o-mini",
      },
      runnerMode: "mock",
      proxyUrl: "http://127.0.0.1:7890",
      cloudProvider: "openrouter",
      apiKeys: {
        openrouter: "test-openrouter-key",
        openai: "test-openai-key",
      },
    });

    const configPath = path.join(installPath, ".devagent", "agents.json");
    const envPath = path.join(installPath, ".env.local");
    const planPath = path.join(installPath, "devagent-install-plan.json");
    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    const envFile = await fs.readFile(envPath, "utf8");
    const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
    const launchStep = buildDevHubLaunchStep({ installPath });
    const env = buildProcessEnv({
      installPath,
      cloudProvider: "openrouter",
      apiKeys: {
        openrouter: "test-openrouter-key",
        openai: "test-openai-key",
      },
    });
    const installSteps = buildInstallExecutionSteps({
      installPath,
      selectedModelIds: ["openrouter-auto"],
      modelId: "openrouter-auto",
      pullLocalModels: false,
    });
    const startScriptPath = path.join(installPath, "services", "start-devagent-hub.ps1");
    const systemdUnitPath = path.join(installPath, "services", "devagent-hub.service");

    assert.equal(result.ok, true);
    assert.equal(config.runtime.runnerMode, "mock");
    assert.equal(config.agents.find((agent) => agent.id === "generator").modelId, "ollama-qwen25-coder-7b");
    assert.equal(config.agents.find((agent) => agent.id === "critic").modelId, "openrouter-auto");
    assert.equal(config.agents.find((agent) => agent.id === "finalizer").modelId, "openai-gpt-4o-mini");
    assert.deepEqual(config.models.map((model) => model.id), ["ollama-qwen25-coder-7b", "openrouter-auto", "openai-gpt-4o-mini"]);
    assert.doesNotMatch(envFile, /test-openrouter-key/);
    assert.doesNotMatch(envFile, /test-openai-key/);
    assert.match(envFile, /AGENT_CONFIG_PATH=/);
    assert.match(envFile, /\.devagent[\\/]+agents\.json/);
    assert.match(envFile, /HTTP_PROXY=http:\/\/127\.0\.0\.1:7890/);
    assert.equal(plan.modelId, "openrouter-auto");
    assert.deepEqual(plan.selectedModelIds, ["openrouter-auto", "ollama-qwen25-coder-7b", "openai-gpt-4o-mini"]);
    assert.equal(plan.agentModelAssignments.critic, "openrouter-auto");
    assert.equal(Array.isArray(plan.commands), true);
    assert.equal(Array.isArray(plan.serviceCommands), true);
    assert.equal(env.AGENT_STUDIO_OPENROUTER_API_KEY, "test-openrouter-key");
    assert.equal(env.AGENT_STUDIO_OPENAI_API_KEY, "test-openai-key");
    assert.equal(env.AGENT_CONFIG_PATH.endsWith(path.join(".devagent", "agents.json")), true);
    assert.equal(launchStep.url, "http://127.0.0.1:3000");
    assert.equal(launchStep.args.includes("app.main:app"), true);
    assert.equal(launchStep.args.includes("openhands.app_server.app:app"), false);
    assert.equal(installSteps.some((step) => step.id === "api-smoke"), true);
    assert.equal(installSteps.some((step) => String(step.id).includes("openhands")), false);
    assert.equal(await fileExists(startScriptPath), true);
    assert.equal(await fileExists(systemdUnitPath), true);

    console.log("Installer prepare smoke: OK");
    console.log(`files=${result.files.length}`);
    console.log(`commands=${result.commands.length}`);
  } finally {
    await fs.rm(installPath, { recursive: true, force: true });
  }
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
