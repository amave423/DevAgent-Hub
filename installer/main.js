const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const { execFile } = require("node:child_process");

function createWindow() {
  const window = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 880,
    minHeight: 620,
    title: "AI Agent Studio Installer",
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

ipcMain.handle("system:check", async () => {
  const checks = await Promise.all([
    checkCommand("git", ["--version"]),
    checkCommand("docker", ["--version"]),
    checkCommand("node", ["--version"]),
    checkCommand("python", ["--version"]),
  ]);

  return [
    { id: "git", label: "Git", ...checks[0] },
    { id: "docker", label: "Docker", ...checks[1] },
    { id: "node", label: "Node.js 20+", ...checks[2] },
    { id: "python", label: "Python 3.10+", ...checks[3] },
  ];
});

function checkCommand(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: 8000 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        output: (stdout || stderr || error?.message || "").trim(),
      });
    });
  });
}

