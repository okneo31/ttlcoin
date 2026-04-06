const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ttl', {
  createWallet: () => ipcRenderer.invoke('wallet:create'),
  importWallet: (key) => ipcRenderer.invoke('wallet:import', key),
  getBalance: (addr) => ipcRenderer.invoke('wallet:balance', addr),
  send: (data) => ipcRenderer.invoke('wallet:send', data),
  getHistory: (addr) => ipcRenderer.invoke('wallet:history', addr),
  getQR: (addr) => ipcRenderer.invoke('wallet:qr', addr),
  getChain: () => ipcRenderer.invoke('wallet:chain'),
  applyMiner: (data) => ipcRenderer.invoke('wallet:applyMiner', data),
  minerStatus: (addr) => ipcRenderer.invoke('wallet:minerStatus', addr),
  nodeStatus: () => ipcRenderer.invoke('wallet:nodeStatus'),
  setAddress: (addr) => ipcRenderer.invoke('wallet:setAddress', addr),
  startMining: (data) => ipcRenderer.invoke('wallet:startMining', data),
  isMining: () => ipcRenderer.invoke('wallet:isMining'),
  getGasPrice: () => ipcRenderer.invoke('wallet:gasPrice'),
});
