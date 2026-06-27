const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { randomUUID } = require("node:crypto");
const path = require("node:path");

const {
  buildInstallExecutionSteps,
  buildProcessEnv,
  checkSystem,
  getInstallerDefaults,
  prepareInstall,
} = require("./install-service");
const { InstallCommandRunner } = require("./install-runner");

let activeInstall = null;

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
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("installer:defaults", async () => getInstallerDefaults());
ipcMain.handle("system:check", async () => checkSystem());

ipcMain.handle("dialog:select-install-dir", async () => {
  const result = await dialog.showOpenDialog({
    title: "Выберите папку проекта",
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("install:prepare", async (_event, rawSettings) => {
  return prepareInstall(rawSettings);
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

async function runInstall(runId, rawSettings, sender) {
  try {
    sendInstallEvent(sender, runId, {
      type: "prepare-start",
      message: "Подготовка конфигурации",
    });

    const prepared = await prepareInstall(rawSettings);

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
      steps: buildInstallExecutionSteps(rawSettings),
      env: buildProcessEnv(rawSettings),
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

function sendInstallEvent(sender, runId, payload) {
  if (sender.isDestroyed()) return;
  sender.send("install:event", {
    runId,
    timestamp: new Date().toISOString(),
    ...payload,
  });
}
