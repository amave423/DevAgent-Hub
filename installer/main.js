const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const path = require("node:path");

const {
  buildInstallExecutionSteps,
  buildOpenHandsLaunchStep,
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
let activeOpenHands = null;

function createWindow() {
  const window = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 940,
    minHeight: 660,
    title: "DevAgent Hub Installer",
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
  activeOpenHands?.child.kill();
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("installer:defaults", async () => getInstallerDefaults(app.isPackaged));
ipcMain.handle("system:check", async () => checkSystem());
ipcMain.handle("secrets:status", async (_event, rawSettings) => getSecretStatus(rawSettings));

ipcMain.handle("dialog:select-install-dir", async () => {
  const result = await dialog.showOpenDialog({
    title: "Выберите папку проекта",
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
      error: "Установка уже выполняется",
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
    return { ok: false, error: "Активная установка не найдена" };
  }

  activeInstall.cancelRequested = true;
  activeInstall.runner?.cancel();
  return { ok: true };
});

ipcMain.handle("openhands:start", async (event, rawSettings) => {
  if (activeOpenHands) {
    return {
      ok: false,
      error: "OpenHands уже запущен",
      runId: activeOpenHands.runId,
      url: activeOpenHands.url,
    };
  }

  const runId = randomUUID();
  const settingsWithSecret = await withStoredApiKey(rawSettings);
  const step = buildOpenHandsLaunchStep(settingsWithSecret);
  const child = spawn(step.command, step.args, {
    cwd: step.cwd,
    env: {
      ...buildProcessEnv(settingsWithSecret),
      SERVE_FRONTEND: "true",
    },
    shell: false,
    windowsHide: true,
  });

  activeOpenHands = {
    runId,
    child,
    url: step.url,
  };

  sendOpenHandsEvent(event.sender, runId, {
    type: "process-start",
    message: `OpenHands запускается: ${step.url}`,
    url: step.url,
    command: [step.command, ...step.args].join(" "),
  });

  child.stdout.on("data", (chunk) => {
    sendOpenHandsEvent(event.sender, runId, {
      type: "stdout",
      message: chunk.toString(),
    });
  });

  child.stderr.on("data", (chunk) => {
    sendOpenHandsEvent(event.sender, runId, {
      type: "stderr",
      message: chunk.toString(),
    });
  });

  child.on("error", (error) => {
    sendOpenHandsEvent(event.sender, runId, {
      type: "process-error",
      message: error.message,
    });
    activeOpenHands = null;
  });

  child.on("close", (code) => {
    sendOpenHandsEvent(event.sender, runId, {
      type: "process-exit",
      message: `OpenHands остановлен с кодом ${code}`,
      exitCode: code,
    });
    activeOpenHands = null;
  });

  return { ok: true, runId, url: step.url };
});

ipcMain.handle("openhands:stop", async (_event, runId) => {
  if (!activeOpenHands || activeOpenHands.runId !== runId) {
    return { ok: false, error: "Запущенный OpenHands не найден" };
  }

  activeOpenHands.child.kill();
  return { ok: true };
});

async function runInstall(runId, rawSettings, sender) {
  try {
    sendInstallEvent(sender, runId, {
      type: "prepare-start",
      message: "Подготовка конфигурации",
    });

    const secretResult = await persistApiKey(rawSettings);
    const settingsWithSecret = await withStoredApiKey(rawSettings);
    const prepared = mergeSecretWarning(
      await prepareInstall(withoutApiKey(rawSettings)),
      secretResult,
    );

    sendInstallEvent(sender, runId, {
      type: "prepare-complete",
      message: "Конфигурация подготовлена",
      files: prepared.files,
      warnings: prepared.warnings,
    });

    if (activeInstall?.cancelRequested) {
      sendInstallEvent(sender, runId, {
        type: "run-cancelled",
        message: "Установка отменена",
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

function sendOpenHandsEvent(sender, runId, payload) {
  if (sender.isDestroyed()) return;
  sender.send("openhands:event", {
    runId,
    timestamp: new Date().toISOString(),
    ...payload,
  });
}
