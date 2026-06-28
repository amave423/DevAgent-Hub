const assert = require("node:assert/strict");

const { InstallCommandRunner } = require("../installer/install-runner");

async function main() {
  const events = [];
  const runner = new InstallCommandRunner({
    steps: [
      {
        id: "stdout-step",
        label: "stdout step",
        cwd: process.cwd(),
        command: process.execPath,
        args: ["-e", "console.log('runner stdout ok')"],
      },
      {
        id: "stderr-step",
        label: "stderr step",
        cwd: process.cwd(),
        command: process.execPath,
        args: ["-e", "console.error('runner stderr ok')"],
      },
      {
        id: "optional-failure",
        label: "optional failure",
        cwd: process.cwd(),
        command: process.execPath,
        args: ["-e", "process.exit(17)"],
        optional: true,
      },
    ],
    env: process.env,
  });

  runner.on("event", (event) => events.push(event));
  const result = await runner.run();

  assert.equal(result.ok, true);
  assert.equal(events.some((event) => event.type === "run-start"), true);
  assert.equal(events.filter((event) => event.type === "step-complete").length, 2);
  assert.equal(events.filter((event) => event.type === "step-warning").length, 1);
  assert.equal(events.some((event) => event.type === "stdout" && event.message.includes("runner stdout ok")), true);
  assert.equal(events.some((event) => event.type === "stderr" && event.message.includes("runner stderr ok")), true);
  assert.equal(events.at(-1).type, "run-complete");

  console.log("Installer runner smoke: OK");
  console.log(`events=${events.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
