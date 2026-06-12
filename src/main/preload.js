const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("notionPdf", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  validateSettings: () => ipcRenderer.invoke("settings:validate"),
  openPdf: () => ipcRenderer.invoke("pdf:open"),
  createCapture: (payload) => ipcRenderer.invoke("capture:create", payload),
  deleteCapture: (hash) => ipcRenderer.invoke("capture:delete", hash),
  listCaptures: () => ipcRenderer.invoke("capture:list"),
  retryQueue: () => ipcRenderer.invoke("queue:retry")
});
