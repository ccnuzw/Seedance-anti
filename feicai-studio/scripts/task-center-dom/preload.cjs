/* eslint-disable no-undef, @typescript-eslint/no-require-imports */
// Dedicated test channels only; never import the production preload.
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('testCapture', (name) =>
  ipcRenderer.invoke('capture', name)
)
contextBridge.exposeInMainWorld('testKeys', (key) =>
  ipcRenderer.invoke('keys', key)
)
contextBridge.exposeInMainWorld('testResize', (width) =>
  ipcRenderer.invoke('resize', width)
)
contextBridge.exposeInMainWorld('testFinish', (result) =>
  ipcRenderer.invoke('finish', result)
)
