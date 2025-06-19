const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const NetworkUtils = require('./networkUtils');

// 设置应用名称
app.setName('Kemushi');

let mainWindow;
let server;
let io;
const rooms = new Map(); // 存储房间信息
let isCloudMode = false; // 是否使用云服务器模式

function createWindow() {
  // 设置应用图标路径
  const iconPath = app.isPackaged 
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../../public/icon.png');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    title: 'Kemushi', // 显式设置窗口标题
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    autoHideMenuBar: true,
    minimizable: true,
    maximizable: true,
    resizable: true,
    skipTaskbar: false,
    icon: iconPath, // 设置窗口图标
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/preload.js')
    }
  });

  const htmlPath = path.join(__dirname, '../../public/index.html');
  mainWindow.loadFile(htmlPath);

  // 窗口准备显示时显示
  mainWindow.once('ready-to-show', () => {
    // 确保隐藏菜单栏和标题栏
    ensureFrameless();
    mainWindow.show();
    
    // 发送服务器端口信息（如果服务器已启动）
    if (global.serverPort) {
      mainWindow.webContents.send('server-port', global.serverPort);
    }
    
    // 开发模式下打开开发者工具
    if (process.argv.includes('--dev')) {
      mainWindow.webContents.openDevTools();
    }
  });

  // 窗口控制事件
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 监听窗口状态变化，确保始终隐藏标题栏
  mainWindow.on('focus', () => {
    setTimeout(ensureFrameless, 50);
  });

  mainWindow.on('show', () => {
    setTimeout(ensureFrameless, 50);
  });

  mainWindow.on('restore', () => {
    setTimeout(ensureFrameless, 50);
  });

  mainWindow.on('maximize', () => {
    setTimeout(ensureFrameless, 50);
  });

  mainWindow.on('unmaximize', () => {
    setTimeout(ensureFrameless, 50);
  });
}

// 确保窗口保持frameless状态的函数
function ensureFrameless() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.setMenuBarVisibility(false);
      mainWindow.setAutoHideMenuBar(true);
      
      // 在Windows上，强制重新应用frameless设置
      if (process.platform === 'win32') {
        // 使用setWindowButtonVisibility隐藏原生窗口按钮（如果存在）
        if (typeof mainWindow.setWindowButtonVisibility === 'function') {
          mainWindow.setWindowButtonVisibility(false);
        }
      }
    } catch (error) {
      console.log('Error ensuring frameless state:', error.message);
    }
  }
}

// 创建信令服务器
function createSignalingServer() {
  const express = require('express');
  const app = express();
  
  // 提供静态文件服务
  app.use(express.static(path.join(__dirname, '../../public')));
  
  server = createServer(app);
  io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // 创建房间
    socket.on('create-room', (fileInfo, callback) => {
      const roomId = uuidv4().substring(0, 6).toUpperCase();
      socket.join(roomId);
      
      // 获取创建者的网络信息
      const localIPs = NetworkUtils.getLocalIPs();
      const roomInfo = {
        host: socket.id,
        peers: [socket.id],
        fileInfo: fileInfo,
        hostIP: localIPs[0] || 'unknown',
        transferMode: null,
        createdAt: Date.now()
      };
      
      rooms.set(roomId, roomInfo);
      console.log('Room created:', roomId, 'Host:', socket.id, 'IP:', roomInfo.hostIP);
      
      callback({
        roomId: roomId,
        hostIP: roomInfo.hostIP,
        isCloudMode: isCloudMode
      });
    });

    // 重新加入房间（断线重连）
    socket.on('rejoin-room', (data, callback) => {
      console.log('Client attempting to rejoin room:', data);
      const { roomId, mode, transferId, lastChunk } = data;
      
      const room = rooms.get(roomId);
      if (!room) {
        console.log('Room no longer exists:', roomId);
        callback({ success: false, message: '房间已关闭' });
        return;
      }
      
      // 将用户重新加入房间
      socket.join(roomId);
      
      // 如果用户不在房间列表中，添加进去
      if (!room.peers.includes(socket.id)) {
        room.peers.push(socket.id);
      }
      
      // 标记用户已重连
      if (!room.reconnectedPeers) {
        room.reconnectedPeers = {};
      }
      room.reconnectedPeers[socket.id] = {
        mode: mode,
        transferId: transferId,
        lastChunk: lastChunk,
        reconnectTime: Date.now()
      };
      
      // 通知房间内其他用户有人重连
      socket.to(roomId).emit('peer-reconnected', {
        peerId: socket.id,
        mode: mode,
        transferId: transferId,
        lastChunk: lastChunk
      });
      
      callback({ 
        success: true,
        transferMode: room.transferMode,
        fileInfo: room.fileInfo
      });
      
      console.log('User rejoined room successfully:', roomId, 'Mode:', mode);
    });

    // 处理恢复中继传输
    socket.on('resume-relay-transfer', (data) => {
      const { roomId, transferId, fromChunk } = data;
      const room = rooms.get(roomId);
      
      if (!room || !room.relayChunks) {
        console.log('No relay data found for room:', roomId);
        socket.emit('resume-relay-error', { error: '无法找到传输数据' });
        return;
      }
      
      console.log(`Resuming relay transfer from chunk ${fromChunk} for room ${roomId}`);
      
      // 通知发送方从指定块继续发送
      socket.to(roomId).emit('resume-sending', {
        transferId: transferId,
        fromChunk: fromChunk
      });
    });

    // 加入房间
    socket.on('join-room', (roomId, callback) => {
      console.log('Attempting to join room:', roomId, 'User:', socket.id);
      const room = rooms.get(roomId);
      
      if (!room) {
        console.log('Failed to join room:', roomId, 'Room does not exist');
        callback({ success: false, message: 'Room does not exist' });
        return;
      }
      
      // 检查是否是房间主人试图加入自己的房间（自发自收场景）
      if (room.host === socket.id) {
        console.log('Host attempting self-transfer in room:', roomId);
        // 对于自发自收，我们直接触发连接建立
        callback({ success: true, hostId: room.host, selfTransfer: true });
        // 延迟一点触发peer-joined事件，模拟第二个用户加入
        setTimeout(() => {
          socket.emit('peer-joined', socket.id);
        }, 100);
        return;
      }
      
      // 检查用户是否已在房间中
      if (room.peers.includes(socket.id)) {
        console.log('User already in room:', roomId);
        callback({ success: true, hostId: room.host, fileInfo: room.fileInfo });
        return;
      }
      
      // 检查房间是否已满
      if (room.peers.length >= 2) {
        console.log('Failed to join room:', roomId, 'Room is full');
        callback({ success: false, message: 'Room is full' });
        return;
      }
      
      // 正常加入房间
      socket.join(roomId);
      room.peers.push(socket.id);
      
      // 获取加入者的网络信息
      const localIPs = NetworkUtils.getLocalIPs();
      const joinerIP = localIPs[0] || 'unknown';
      
      // 选择传输模式
      const transferMode = NetworkUtils.selectTransferMode(
        room.hostIP,
        joinerIP,
        room.fileInfo?.size || 0
      );
      room.transferMode = transferMode;
      
      console.log('Successfully joined room:', roomId, 'Transfer mode:', transferMode.mode);
      
      // 通知双方传输模式
      io.to(roomId).emit('transfer-mode-selected', {
        mode: transferMode.mode,
        reason: transferMode.reason,
        hostIP: room.hostIP,
        joinerIP: joinerIP
      });
      
      socket.to(roomId).emit('peer-joined', socket.id);
      callback({ 
        success: true, 
        hostId: room.host,
        transferMode: transferMode,
        hostIP: room.hostIP,
        fileInfo: room.fileInfo
      });
    });

    // 转发WebRTC信令
    socket.on('signal', (data) => {
      console.log('Forwarding signal from', socket.id, 'to other users in room');
      // 转发给房间中的其他用户
      rooms.forEach((room, roomId) => {
        if (room.peers.includes(socket.id)) {
          // 发送给房间中的其他用户
          room.peers.forEach(peerId => {
            if (peerId !== socket.id) {
              io.to(peerId).emit('signal', {
                from: socket.id,
                signal: data.signal
              });
              console.log('Signal forwarded to:', peerId);
            }
          });
        }
      });
    });
    
    // 服务器中继模式：接收文件块
    socket.on('relay-chunk', (data) => {
      const { roomId, chunkIndex, chunk, metadata } = data;
      const room = rooms.get(roomId);
      
      if (!room) return;
      
      // 存储块数据（实际部署时应该使用临时文件或流）
      if (!room.relayChunks) {
        room.relayChunks = {};
      }
      
      room.relayChunks[chunkIndex] = chunk;
      
      // 转发给接收方
      socket.to(roomId).emit('relay-chunk-received', {
        chunkIndex,
        totalChunks: metadata.totalChunks,
        chunkSize: chunk.length
      });
      
      console.log(`Relay chunk ${chunkIndex}/${metadata.totalChunks} for room ${roomId}`);
    });
    
    // 服务器中继模式：请求文件块
    socket.on('request-relay-chunk', (data) => {
      const { roomId, chunkIndex } = data;
      const room = rooms.get(roomId);
      
      if (!room || !room.relayChunks || !room.relayChunks[chunkIndex]) {
        socket.emit('relay-chunk-error', { chunkIndex, error: 'Chunk not found' });
        return;
      }
      
      // 发送块数据
      socket.emit('relay-chunk-data', {
        chunkIndex,
        chunk: room.relayChunks[chunkIndex]
      });
      
      // 可选：传输完成后清理块数据以节省内存
      // delete room.relayChunks[chunkIndex];
    });

    // 处理文件传输完成事件
    socket.on('file-transfer-complete', (data) => {
      console.log('File transfer completed by:', socket.id, 'Role:', data.role);
      
      // 找到用户所在的房间
      let targetRoomId = null;
      rooms.forEach((room, roomId) => {
        if (room.peers.includes(socket.id)) {
          targetRoomId = roomId;
        }
      });
      
      if (targetRoomId) {
        const room = rooms.get(targetRoomId);
        if (!room.transferComplete) {
          room.transferComplete = {};
        }
        
        // 为每个socket维护角色列表，而不是单一角色
        if (!room.transferComplete[socket.id]) {
          room.transferComplete[socket.id] = [];
        }
        if (!room.transferComplete[socket.id].includes(data.role)) {
          room.transferComplete[socket.id].push(data.role);
        }
        
        // 检查是否完成传输
        let hasReceiver = false;
        let hasSender = false;
        let isSelfTransfer = false;
        
        // 遍历所有用户的角色
        Object.values(room.transferComplete).forEach(roles => {
          if (roles.includes('sender')) hasSender = true;
          if (roles.includes('receiver')) hasReceiver = true;
        });
        
        // 检查是否是自发自收（单个socket同时有两个角色）
        Object.values(room.transferComplete).forEach(roles => {
          if (roles.includes('sender') && roles.includes('receiver')) {
            isSelfTransfer = true;
          }
        });
        
        if ((hasReceiver && hasSender) || isSelfTransfer) {
          // 双方都完成传输，关闭房间
          console.log('Both parties completed transfer, closing room:', targetRoomId);
          
          // 通知房间内所有用户房间即将关闭
          io.to(targetRoomId).emit('room-closing', {
            message: '文件传输完成，房间将在3秒后自动关闭'
          });
          
          // 3秒后关闭房间
          setTimeout(() => {
            io.to(targetRoomId).emit('room-closed', {
              message: '房间已关闭'
            });
            
            // 断开房间内所有连接并清理房间
            room.peers.forEach(peerId => {
              const peerSocket = io.sockets.sockets.get(peerId);
              if (peerSocket) {
                peerSocket.leave(targetRoomId);
              }
            });
            
            // 清理中继数据
            if (room.relayChunks) {
              delete room.relayChunks;
            }
            
            rooms.delete(targetRoomId);
            console.log('Room', targetRoomId, 'has been closed and deleted');
          }, 3000);
        }
      }
    });

    // 断开连接处理
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      // 清理房间信息
      rooms.forEach((room, roomId) => {
        const index = room.peers.indexOf(socket.id);
        if (index !== -1) {
          room.peers.splice(index, 1);
          if (room.peers.length === 0) {
            rooms.delete(roomId);
          }
        }
      });
    });
  });

  // 尝试找到可用端口
  const findAvailablePort = (startPort) => {
    return new Promise((resolve, reject) => {
      const server = require('net').createServer();
      server.listen(startPort, (err) => {
        if (err) {
          server.close();
          if (startPort < 3010) {
            findAvailablePort(startPort + 1).then(resolve).catch(reject);
          } else {
            reject(new Error('No available port found'));
          }
        } else {
          const port = server.address().port;
          server.close();
          resolve(port);
        }
      });
    });
  };

  findAvailablePort(3000).then(port => {
    server.listen(port, () => {
      console.log(`Signal server running on port ${port}`);
      
      // 存储端口号供后续使用
      global.serverPort = port;
      
      // 将端口信息传递给渲染进程（如果窗口已准备好）
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        // 确保页面已加载完成再发送
        if (mainWindow.webContents.isLoading()) {
          mainWindow.webContents.once('did-finish-load', () => {
            mainWindow.webContents.send('server-port', port);
          });
        } else {
          mainWindow.webContents.send('server-port', port);
        }
      }
    });
  }).catch(err => {
    console.error('Failed to start server:', err);
  });
}

// IPC通信处理
ipcMain.handle('select-file', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile']
    });
    
    // 文件对话框关闭后，确保隐藏标题栏
    setTimeout(ensureFrameless, 100);
    
    if (!result.canceled) {
      const fs = require('fs');
      const path = require('path');
      const filePath = result.filePaths[0];
      const stats = fs.statSync(filePath);
      
      return {
        path: filePath,
        name: path.basename(filePath),
        size: stats.size
      };
    }
    return null;
  } catch (error) {
    console.log('Error in file selection:', error.message);
    // 即使出错也要确保隐藏标题栏
    setTimeout(ensureFrameless, 100);
    return null;
  }
});

ipcMain.handle('read-file', async (event, filePath) => {
  const fs = require('fs');
  return fs.readFileSync(filePath);
});

ipcMain.handle('save-file', async (event, filePath, data) => {
  const fs = require('fs');
  // 如果是数组，转换为Buffer；如果已经是Buffer，直接使用
  const buffer = Array.isArray(data) ? Buffer.from(data) : Buffer.from(data);
  fs.writeFileSync(filePath, buffer);
  return true;
});

// 传输记录相关操作
ipcMain.handle('save-transfer-record', async (event, record) => {
  const fs = require('fs');
  const path = require('path');
  
  try {
    // 创建记录文件的路径（应用目录下的transfer-records.json）
    const recordsPath = path.join(getAppDataDir(), 'transfer-records.json');
    
    let records = [];
    
    // 如果文件存在，读取现有记录
    if (fs.existsSync(recordsPath)) {
      const fileContent = fs.readFileSync(recordsPath, 'utf8');
      records = JSON.parse(fileContent);
    }
    
    // 添加新记录
    records.push(record);
    
    // 保存更新后的记录
    fs.writeFileSync(recordsPath, JSON.stringify(records, null, 2));
    
    return { success: true };
  } catch (error) {
    console.error('保存传输记录失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-transfer-records', async () => {
  const fs = require('fs');
  const path = require('path');
  
  try {
    const recordsPath = path.join(getAppDataDir(), 'transfer-records.json');
    
    if (!fs.existsSync(recordsPath)) {
      return [];
    }
    
    const fileContent = fs.readFileSync(recordsPath, 'utf8');
    const records = JSON.parse(fileContent);
    
    // 按时间倒序排列（最新的在前）
    return records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  } catch (error) {
    console.error('读取传输记录失败:', error);
    return [];
  }
});

ipcMain.handle('clear-transfer-records', async () => {
  const fs = require('fs');
  const path = require('path');
  
  try {
    const recordsPath = path.join(getAppDataDir(), 'transfer-records.json');
    
    if (fs.existsSync(recordsPath)) {
      fs.unlinkSync(recordsPath);
    }
    
    return { success: true };
  } catch (error) {
    console.error('清除传输记录失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('select-save-location', async (event, fileName) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: fileName
    });
    
    // 保存对话框关闭后，确保隐藏标题栏
    setTimeout(ensureFrameless, 100);
    
    if (!result.canceled) {
      return result.filePath;
    }
    return null;
  } catch (error) {
    console.log('Error in save location selection:', error.message);
    // 即使出错也要确保隐藏标题栏
    setTimeout(ensureFrameless, 100);
    return null;
  }
});

// 窗口控制IPC处理
ipcMain.handle('minimize-window', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.handle('maximize-window', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('close-window', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.handle('show-item-in-folder', async (event, filePath) => {
  try {
    shell.showItemInFolder(filePath);
    return { success: true };
  } catch (error) {
    console.error('打开文件位置失败:', error);
    return { success: false, error: error.message };
  }
});

// 打开外部链接
ipcMain.handle('open-external', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('打开外部链接失败:', error);
    return { success: false, error: error.message };
  }
});

// 加载语言文件
ipcMain.handle('load-language-file', async (event, lang) => {
  const fs = require('fs');
  const path = require('path');
  
  try {
    // 开发环境和生产环境的路径处理
    let langFilePath;
    if (app.isPackaged) {
      // 生产环境：从 resources 目录加载
      langFilePath = path.join(process.resourcesPath, 'i18n', `${lang}.json`);
    } else {
      // 开发环境：从源码目录加载
      langFilePath = path.join(__dirname, '../i18n', `${lang}.json`);
    }
    
    if (!fs.existsSync(langFilePath)) {
      console.error('语言文件不存在:', langFilePath);
      return null;
    }
    
    const fileContent = fs.readFileSync(langFilePath, 'utf8');
    return JSON.parse(fileContent);
  } catch (error) {
    console.error('加载语言文件失败:', error);
    return null;
  }
});

// 获取应用数据目录
function getAppDataDir() {
  // 单文件 portable 版专用变量
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }
  if (app.isPackaged) {
    // 普通安装版
    return path.dirname(process.execPath);
  }
  // 开发环境
  return process.cwd();
}

// 保存应用设置
ipcMain.handle('save-app-settings', async (event, settings) => {
  const fs = require('fs');
  const path = require('path');
  
  try {
    // 创建设置文件的路径（应用目录下的app-settings.json）
    const settingsPath = path.join(getAppDataDir(), 'app-settings.json');
    
    let currentSettings = {};
    
    // 如果文件存在，读取现有设置
    if (fs.existsSync(settingsPath)) {
      const fileContent = fs.readFileSync(settingsPath, 'utf8');
      currentSettings = JSON.parse(fileContent);
    }
    
    // 合并新设置
    const updatedSettings = { ...currentSettings, ...settings };
    
    // 保存更新后的设置
    fs.writeFileSync(settingsPath, JSON.stringify(updatedSettings, null, 2));
    
    console.log('应用设置已保存:', updatedSettings);
    return { success: true };
  } catch (error) {
    console.error('保存应用设置失败:', error);
    return { success: false, error: error.message };
  }
});

// 获取应用设置
ipcMain.handle('get-app-settings', async () => {
  const fs = require('fs');
  const path = require('path');
  
  try {
    const settingsPath = path.join(getAppDataDir(), 'app-settings.json');
    
    if (!fs.existsSync(settingsPath)) {
      return {}; // 如果文件不存在，返回空对象
    }
    
    const fileContent = fs.readFileSync(settingsPath, 'utf8');
    const settings = JSON.parse(fileContent);
    
    console.log('读取应用设置:', settings);
    return settings;
  } catch (error) {
    console.error('读取应用设置失败:', error);
    return {};
  }
});

// 获取网络配置信息
ipcMain.handle('get-network-config', async () => {
  const localIPs = NetworkUtils.getLocalIPs();
  return {
    localIPs: localIPs,
    isCloudMode: isCloudMode,
    config: {
      signalServer: isCloudMode ? config.cloud.signalServer : `http://localhost:${global.serverPort || 3000}`,
      iceServers: config.webrtc.iceServers,
      transfer: config.transfer,
      reconnect: config.reconnect,
      resume: config.resume
    }
  };
});

// 传输进度相关操作
ipcMain.handle('save-transfer-progress', async (event, progressData) => {
  const fs = require('fs');
  const path = require('path');
  
  try {
    // 创建进度文件的路径
    const progressPath = path.join(getAppDataDir(), 'transfer-progress.json');
    
    let progressRecords = {};
    
    // 如果文件存在，读取现有进度
    if (fs.existsSync(progressPath)) {
      const fileContent = fs.readFileSync(progressPath, 'utf8');
      progressRecords = JSON.parse(fileContent);
    }
    
    // 添加或更新进度记录
    progressRecords[progressData.transferId] = {
      ...progressData,
      lastUpdated: Date.now()
    };
    
    // 清理过期的进度记录
    const now = Date.now();
    Object.keys(progressRecords).forEach(key => {
      if (now - progressRecords[key].lastUpdated > config.resume.progressCacheTime) {
        delete progressRecords[key];
      }
    });
    
    // 保存更新后的进度
    fs.writeFileSync(progressPath, JSON.stringify(progressRecords, null, 2));
    
    return { success: true };
  } catch (error) {
    console.error('保存传输进度失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-transfer-progress', async (event, transferId) => {
  const fs = require('fs');
  const path = require('path');
  
  try {
    const progressPath = path.join(getAppDataDir(), 'transfer-progress.json');
    
    if (!fs.existsSync(progressPath)) {
      return null;
    }
    
    const fileContent = fs.readFileSync(progressPath, 'utf8');
    const progressRecords = JSON.parse(fileContent);
    
    const progress = progressRecords[transferId];
    
    // 检查进度是否过期
    if (progress && Date.now() - progress.lastUpdated > config.resume.progressCacheTime) {
      return null;
    }
    
    return progress;
  } catch (error) {
    console.error('读取传输进度失败:', error);
    return null;
  }
});

ipcMain.handle('clear-transfer-progress', async (event, transferId) => {
  const fs = require('fs');
  const path = require('path');
  
  try {
    const progressPath = path.join(getAppDataDir(), 'transfer-progress.json');
    
    if (!fs.existsSync(progressPath)) {
      return { success: true };
    }
    
    const fileContent = fs.readFileSync(progressPath, 'utf8');
    const progressRecords = JSON.parse(fileContent);
    
    if (transferId) {
      // 删除特定的进度记录
      delete progressRecords[transferId];
    } else {
      // 清空所有进度记录
      progressRecords = {};
    }
    
    fs.writeFileSync(progressPath, JSON.stringify(progressRecords, null, 2));
    
    return { success: true };
  } catch (error) {
    console.error('清除传输进度失败:', error);
    return { success: false, error: error.message };
  }
});

app.whenReady().then(() => {
  // 设置应用程序图标（Windows任务栏）
  if (process.platform === 'win32') {
    const iconPath = app.isPackaged 
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(__dirname, '../../public/icon.png');
    app.setAppUserModelId('moe.fog.kemushi');
  }
  
  // 显示数据文件保存位置（用于调试）
  const dataDir = getAppDataDir();
  console.log('应用数据保存目录:', dataDir);
  console.log('设置文件路径:', path.join(dataDir, 'app-settings.json'));
  console.log('传输记录路径:', path.join(dataDir, 'transfer-records.json'));
  
  createWindow();
  createSignalingServer();
});

app.on('window-all-closed', () => {
  if (server) {
    server.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});