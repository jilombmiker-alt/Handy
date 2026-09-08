const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('detachPreview', { onState(callback) { ipcRenderer.on('detach:preview', (_event, value) => callback(value)); } });
