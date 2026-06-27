const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("installerApi", {
  getDefaults: () => ipcRenderer.invoke("installer:defaults"),
  checkSystem: () => ipcRenderer.invoke("system:check"),
  selectInstallDir: () => ipcRenderer.invoke("dialog:select-install-dir"),
  prepareInstall: (settings) => ipcRenderer.invoke("install:prepare", settings),
  startInstall: (settings) => ipcRenderer.invoke("install:start", settings),
  cancelInstall: (runId) => ipcRenderer.invoke("install:cancel", runId),
  onInstallEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("install:event", listener);
    return () => ipcRenderer.removeListener("install:event", listener);
  },
});
