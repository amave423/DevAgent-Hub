const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("node:path");

const {
  checkSystem,
  getInstallerDefaults,
  prepareInstall,
} = require("./install-service");

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
