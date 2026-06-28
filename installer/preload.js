const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("installerApi", {
  getDefaults: () => ipcRenderer.invoke("installer:defaults"),
  checkSystem: () => ipcRenderer.invoke("system:check"),
  getSecretStatus: (settings) => ipcRenderer.invoke("secrets:status", settings),
  selectInstallDir: () => ipcRenderer.invoke("dialog:select-install-dir"),
  prepareInstall: (settings) => ipcRenderer.invoke("install:prepare", settings),
  startInstall: (settings) => ipcRenderer.invoke("install:start", settings),
  cancelInstall: (runId) => ipcRenderer.invoke("install:cancel", runId),
  startDevHub: (settings) => ipcRenderer.invoke("devhub:start", settings),
  stopDevHub: (runId) => ipcRenderer.invoke("devhub:stop", runId),
  onInstallEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("install:event", listener);
    return () => ipcRenderer.removeListener("install:event", listener);
  },
  onDevHubEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("devhub:event", listener);
    return () => ipcRenderer.removeListener("devhub:event", listener);
  },
});
