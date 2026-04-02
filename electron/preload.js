const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('otteryElectron', {
  serverPort: parseInt(process.env.OTTERY_SERVER_PORT, 10) || 3737,
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getVersion: () => ipcRenderer.invoke('get-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onOAuthCallback: (callback) => ipcRenderer.on('oauth-callback', (_event, url) => callback(url)),
  openLogFolder: () => ipcRenderer.invoke('open-log-folder'),
  onUpdateReady: (callback) => ipcRenderer.on('update-ready', () => callback()),
  restartForUpdate: () => ipcRenderer.send('restart-for-update'),
  onNavigate: (callback) => ipcRenderer.on('navigate', (_event, route) => callback(route)),
});
