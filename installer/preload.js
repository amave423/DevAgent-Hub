const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("installerApi", {
  checkSystem: () => ipcRenderer.invoke("system:check"),
});

