const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const path = require("node:path");

const {
  buildDevHubLaunchStep,
  buildInstallExecutionSteps,
  buildProcessEnv,
  checkSystem,
  getInstallerDefaults,
  prepareInstall,
} = require("./install-service");
const { InstallCommandRunner } = require("./install-runner");
const {
  getSecretStatus,
  readApiKey,
  saveApiKey,
} = require("./secret-store");

let activeInstall = null;
let activeDevHub = null;

function createWindow() {
  const window = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 940,
    minHeight: 660,
    title: "Orqen Studio Installer",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  activeDevHub?.child.kill();
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("installer:defaults", async () => getInstallerDefaults(app.isPackaged));
ipcMain.handle("system:check", async () => checkSystem());
ipcMain.handle("secrets:status", async (_event, rawSettings) => getSecretStatus(rawSettings));

ipcMain.handle("dialog:select-install-dir", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select Orqen Studio install folder",
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("install:prepare", async (_event, rawSettings) => {
  const secretResult = await persistApiKey(rawSettings);
  const prepared = await prepareInstall(withoutApiKey(rawSettings));
  return mergeSecretWarning(prepared, secretResult);
});

ipcMain.handle("install:start", async (event, rawSettings) => {
  if (activeInstall) {
    return {
      ok: false,
      error: "Installation is already running.",
      runId: activeInstall.runId,
    };
  }

  const runId = randomUUID();
  const sender = event.sender;
  activeInstall = {
    runId,
    runner: null,
    cancelRequested: false,
  };

  runInstall(runId, rawSettings, sender).catch(() => {
    activeInstall = null;
  });

  return { ok: true, runId };
});

ipcMain.handle("install:cancel", async (_event, runId) => {
  if (!activeInstall || activeInstall.runId !== runId) {
    return { ok: false, error: "Active installation was not found." };
  }

  activeInstall.cancelRequested = true;
  activeInstall.runner?.cancel();
  return { ok: true };
});

ipcMain.handle("devhub:start", async (event, rawSettings) => {
  if (activeDevHub) {
    return {
      ok: false,
      error: "Orqen Studio is already running.",
      runId: activeDevHub.runId,
      url: activeDevHub.url,
    };
  }

  const runId = randomUUID();
  const settingsWithSecret = await withStoredApiKey(rawSettings);
  const step = buildDevHubLaunchStep(settingsWithSecret);
  const child = spawn(step.command, step.args, {
    cwd: step.cwd,
    env: {
      ...buildProcessEnv(settingsWithSecret),
      ...(step.env ?? {}),
    },
    shell: false,
    windowsHide: true,
  });

  activeDevHub = {
    runId,
    child,
    url: step.url,
  };

  sendDevHubEvent(event.sender, runId, {
    type: "process-start",
    message: `Orqen Studio is starting: ${step.url}`,
    url: step.url,
    command: [step.command, ...step.args].join(" "),
  });

  child.stdout.on("data", (chunk) => {
    sendDevHubEvent(event.sender, runId, {
      type: "stdout",
      message: chunk.toString(),
    });
  });

  child.stderr.on("data", (chunk) => {
    sendDevHubEvent(event.sender, runId, {
      type: "stderr",
      message: chunk.toString(),
    });
  });

  child.on("error", (error) => {
    sendDevHubEvent(event.sender, runId, {
      type: "process-error",
      message: error.message,
    });
    activeDevHub = null;
  });

  child.on("close", (code) => {
    sendDevHubEvent(event.sender, runId, {
      type: "process-exit",
      message: `Orqen Studio stopped with code ${code}`,
      exitCode: code,
    });
    activeDevHub = null;
  });

  return { ok: true, runId, url: step.url };
});

ipcMain.handle("devhub:stop", async (_event, runId) => {
  if (!activeDevHub || activeDevHub.runId !== runId) {
    return { ok: false, error: "Running Orqen Studio process was not found." };
  }

  activeDevHub.child.kill();
  return { ok: true };
});

async function runInstall(runId, rawSettings, sender) {
  try {
    sendInstallEvent(sender, runId, {
      type: "prepare-start",
      message: "Preparing configuration.",
    });

    const secretResult = await persistApiKey(rawSettings);
    const settingsWithSecret = await withStoredApiKey(rawSettings);
    const prepared = mergeSecretWarning(
      await prepareInstall(withoutApiKey(rawSettings)),
      secretResult,
    );

    sendInstallEvent(sender, runId, {
      type: "prepare-complete",
      message: "Configuration is ready.",
      files: prepared.files,
      warnings: prepared.warnings,
    });

    if (activeInstall?.cancelRequested) {
      sendInstallEvent(sender, runId, {
        type: "run-cancelled",
        message: "Installation cancelled.",
      });
      return;
    }

    const runner = new InstallCommandRunner({
      steps: buildInstallExecutionSteps(settingsWithSecret),
      env: buildProcessEnv(settingsWithSecret),
    });

    activeInstall.runner = runner;
    runner.on("event", (payload) => sendInstallEvent(sender, runId, payload));

    await runner.run();
  } catch (error) {
    if (!error.stepId) {
      sendInstallEvent(sender, runId, {
        type: "run-failed",
        message: error.message,
      });
    }
  } finally {
    activeInstall = null;
  }
}

async function persistApiKey(rawSettings) {
  if (!String(rawSettings?.apiKey || "").trim()) {
    return { saved: false, available: true };
  }
  return saveApiKey(rawSettings);
}

async function withStoredApiKey(rawSettings) {
  if (String(rawSettings?.apiKey || "").trim()) {
    return rawSettings;
  }
  const apiKey = await readApiKey(rawSettings);
  return apiKey ? { ...rawSettings, apiKey } : rawSettings;
}

function withoutApiKey(rawSettings) {
  return { ...rawSettings, apiKey: "" };
}

function mergeSecretWarning(prepared, secretResult) {
  if (secretResult?.warning) {
    return {
      ...prepared,
      warnings: [...prepared.warnings, secretResult.warning],
    };
  }
  return prepared;
}

function sendInstallEvent(sender, runId, payload) {
  if (sender.isDestroyed()) return;
  sender.send("install:event", {
    runId,
    timestamp: new Date().toISOString(),
    ...payload,
  });
}

function sendDevHubEvent(sender, runId, payload) {
  if (sender.isDestroyed()) return;
  sender.send("devhub:event", {
    runId,
    timestamp: new Date().toISOString(),
    ...payload,
  });
}
