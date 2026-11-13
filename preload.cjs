const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', Object.freeze({
  getState: () => ipcRenderer.invoke('launcher:get-state'),
  openSite: (id) => ipcRenderer.invoke('launcher:open-site', id),
  addSite: (input) => ipcRenderer.invoke('launcher:add-site', input),
  updateSite: (input) => ipcRenderer.invoke('launcher:update-site', input),
  deleteSite: (id) => ipcRenderer.invoke('launcher:delete-site', id),
  togglePin: (id) => ipcRenderer.invoke('launcher:toggle-pin', id),
  reorderSites: (ids) => ipcRenderer.invoke('launcher:reorder-sites', ids),
  captureSite: (id) => ipcRenderer.invoke('launcher:capture-site', id),
  refreshPreviews: () => ipcRenderer.invoke('launcher:refresh-previews'),
  updateBackground: (color) => ipcRenderer.invoke('launcher:update-background', color),
  addApp: (input) => ipcRenderer.invoke('launcher:add-app', input),
  deleteApp: (id) => ipcRenderer.invoke('launcher:delete-app', id),
  updateAppIcon: (id, iconPath) => ipcRenderer.invoke('launcher:update-app-icon', id, iconPath),
  clearAppIcon: (id) => ipcRenderer.invoke('launcher:clear-app-icon', id),
  launchApp: (id) => ipcRenderer.invoke('launcher:launch-app', id),
  addGroup: (title) => ipcRenderer.invoke('launcher:add-group', title),
  pickApp: () => ipcRenderer.invoke('launcher:pick-app'),
  pickAppFolders: () => ipcRenderer.invoke('launcher:pick-app-folders'),
  scanAppFolders: (folderPaths) => ipcRenderer.invoke('launcher:scan-app-folders', folderPaths),
  addScannedApps: (input) => ipcRenderer.invoke('launcher:add-scanned-apps', input),
  pickImage: () => ipcRenderer.invoke('launcher:pick-image'),
  toggleFullscreen: () => ipcRenderer.invoke('launcher:toggle-fullscreen')
}));
