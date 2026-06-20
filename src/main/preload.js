const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("notionPdf", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  validateSettings: () => ipcRenderer.invoke("settings:validate"),
  getConnectionStatus: () => ipcRenderer.invoke("settings:connection-status"),
  connectNotionOAuth: (settings) => ipcRenderer.invoke("settings:notion-oauth-start", settings),
  disconnectNotionOAuth: () => ipcRenderer.invoke("settings:notion-oauth-disconnect"),
  openPdf: () => ipcRenderer.invoke("pdf:open"),
  createCapture: (payload) => ipcRenderer.invoke("capture:create", payload),
  deleteCapture: (hash) => ipcRenderer.invoke("capture:delete", hash),
  listCaptures: () => ipcRenderer.invoke("capture:list"),
  retryQueue: () => ipcRenderer.invoke("queue:retry")
});
