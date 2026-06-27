const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("installerApi", {
  getDefaults: () => ipcRenderer.invoke("installer:defaults"),
  checkSystem: () => ipcRenderer.invoke("system:check"),
  selectInstallDir: () => ipcRenderer.invoke("dialog:select-install-dir"),
  prepareInstall: (settings) => ipcRenderer.invoke("install:prepare", settings),
});
