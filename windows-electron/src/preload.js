const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('surgeRelayWindows', {
  platform: 'windows-electron-prototype'
});
