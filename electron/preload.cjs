const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tecnomesDesktop", Object.freeze({
  getAppInfo: () => ipcRenderer.invoke("tecnomes:app-info"),
}));
