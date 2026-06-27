const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { prepareInstall } = require("../installer/install-service");

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

    assert.equal(result.ok, true);
    assert.equal(config.runtime.runnerMode, "mock");
    assert.equal(config.agents.every((agent) => agent.modelId === "openrouter-auto"), true);
    assert.match(envFile, /AGENT_STUDIO_OPENROUTER_API_KEY=test-key/);
    assert.match(envFile, /HTTP_PROXY=http:\/\/127\.0\.0\.1:7890/);
    assert.equal(plan.modelId, "openrouter-auto");
    assert.equal(Array.isArray(plan.commands), true);

    console.log("Installer prepare smoke: OK");
    console.log(`files=${result.files.length}`);
    console.log(`commands=${result.commands.length}`);
  } finally {
    await fs.rm(installPath, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
