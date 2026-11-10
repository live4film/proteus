// Exposes a minimal, safe bridge for saving files and menu commands.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('proteusDesktop', {
  saveFile: (filename, bytes) => ipcRenderer.invoke('proteus:save-file', { filename, data: bytes }),
  reveal: (p) => ipcRenderer.invoke('proteus:reveal', p),
  onMenu: (cb) => ipcRenderer.on('proteus:menu', (_e, act) => cb(act)),
  isDesktop: true,
});
