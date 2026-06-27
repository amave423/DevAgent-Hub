const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  buildProcessEnv,
  buildOpenHandsLaunchStep,
  prepareInstall,
} = require("../installer/install-service");

async function main() {
  const installPath = await fs.mkdtemp(path.join(os.tmpdir(), "devagent-installer-"));

  try {
    const result = await prepareInstall({
      installPath,
      repoUrl: "https://github.com/amave423/DevAgent-Hub.git",
      modelId: "openrouter-auto",
      runnerMode: "mock",
      proxyUrl: "http://127.0.0.1:7890",
      cloudProvider: "openrouter",
      apiKey: "test-key",
    });

    const configPath = path.join(installPath, "configs", "agents.json");
    const envPath = path.join(installPath, ".env.local");
    const planPath = path.join(installPath, "devagent-install-plan.json");
    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    const envFile = await fs.readFile(envPath, "utf8");
    const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
    const launchStep = buildOpenHandsLaunchStep({ installPath });
    const env = buildProcessEnv({
      installPath,
      cloudProvider: "openrouter",
      apiKey: "test-key",
    });
    const startScriptPath = path.join(installPath, "services", "start-openhands.ps1");
    const systemdUnitPath = path.join(installPath, "services", "devagent-hub.service");

    assert.equal(result.ok, true);
    assert.equal(config.runtime.runnerMode, "mock");
    assert.equal(config.agents.every((agent) => agent.modelId === "openrouter-auto"), true);
    assert.doesNotMatch(envFile, /test-key/);
    assert.match(envFile, /services\/secrets\.env/);
    assert.match(envFile, /HTTP_PROXY=http:\/\/127\.0\.0\.1:7890/);
    assert.equal(plan.modelId, "openrouter-auto");
    assert.equal(Array.isArray(plan.commands), true);
    assert.equal(Array.isArray(plan.serviceCommands), true);
    assert.equal(env.AGENT_STUDIO_OPENROUTER_API_KEY, "test-key");
    assert.equal(launchStep.url, "http://127.0.0.1:3000");
    assert.equal(launchStep.args.includes("openhands.app_server.app:app"), true);
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
