const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listSnippets: (query) => ipcRenderer.invoke('snippets:list', query),
  getSnippet: (id) => ipcRenderer.invoke('snippets:get', id),
  getSnippetsMeta: () => ipcRenderer.invoke('snippets:meta'),
  createSnippet: (data) => ipcRenderer.invoke('snippets:create', data),
  updateSnippet: (id, fields) => ipcRenderer.invoke('snippets:update', id, fields),
  deleteSnippet: (id) => ipcRenderer.invoke('snippets:delete', id),
  copyToClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  uploadImage: (snippetId, filePath, title) => ipcRenderer.invoke('images:upload', snippetId, filePath, title),
  uploadImageBuffer: (snippetId, bytes, ext, title) =>
    ipcRenderer.invoke('images:upload-buffer', snippetId, bytes, ext, title),
  deleteImage: (snippetId, imageId) => ipcRenderer.invoke('images:delete', snippetId, imageId),
  renameImage: (snippetId, imageId, title) => ipcRenderer.invoke('images:rename', snippetId, imageId, title),
  getImagesPath: () => ipcRenderer.invoke('get-images-path'),
  selectImages: () => ipcRenderer.invoke('select-images'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  resetConfigPath: () => ipcRenderer.invoke('reset-config-path'),
  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:show-in-folder', filePath),
  onImagePathChanged: (callback) => {
    const listener = (_event, newPath) => callback(newPath);
    ipcRenderer.on('config:imagePath-changed', listener);
    return () => ipcRenderer.removeListener('config:imagePath-changed', listener);
  }
});
