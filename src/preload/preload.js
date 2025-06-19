const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 文件选择
  selectFile: () => ipcRenderer.invoke('select-file'),
  
  // 读取文件
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  
  // 选择保存位置
  selectSaveLocation: (fileName) => ipcRenderer.invoke('select-save-location', fileName),
  
  // 保存文件（通过IPC而不是直接使用fs）
  saveFile: (filePath, buffer) => ipcRenderer.invoke('save-file', filePath, buffer),
  
  // 窗口控制
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  
  // 获取平台信息
  platform: process.platform,
  
  // 监听服务器端口
  onServerPort: (callback) => ipcRenderer.on('server-port', callback),
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  
  // 传输记录操作
  saveTransferRecord: (record) => ipcRenderer.invoke('save-transfer-record', record),
  getTransferRecords: () => ipcRenderer.invoke('get-transfer-records'),
  clearTransferRecords: () => ipcRenderer.invoke('clear-transfer-records'),
  
  // 系统操作
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  
  // 网络配置
  getNetworkConfig: () => ipcRenderer.invoke('get-network-config'),
  
  // 传输进度操作
  saveTransferProgress: (progressData) => ipcRenderer.invoke('save-transfer-progress', progressData),
  getTransferProgress: (transferId) => ipcRenderer.invoke('get-transfer-progress', transferId),
  clearTransferProgress: (transferId) => ipcRenderer.invoke('clear-transfer-progress', transferId),
  
  // 打开外部链接
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // 加载语言文件
  loadLanguageFile: (lang) => ipcRenderer.invoke('load-language-file', lang),
  
  // 应用设置相关
  saveAppSettings: (settings) => ipcRenderer.invoke('save-app-settings', settings),
  getAppSettings: () => ipcRenderer.invoke('get-app-settings')
}); 