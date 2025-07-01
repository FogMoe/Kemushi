const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = createServer(app);

// 启用 CORS
app.use(cors());
app.use(express.json());

// 存储房间信息
const rooms = new Map();

// Socket.IO 服务器配置
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // 创建房间
  socket.on('create-room', (fileInfo, callback) => {
    const roomId = Math.random().toString(36).substr(2, 6).toUpperCase();
    socket.join(roomId);
    
    const roomInfo = {
      host: socket.id,
      peers: [socket.id],
      fileInfo: fileInfo,
      transferMode: null,
      createdAt: Date.now()
    };
    
    rooms.set(roomId, roomInfo);
    console.log('Room created:', roomId, 'Host:', socket.id);
    
    callback({
      roomId: roomId,
      isCloudMode: true
    });
  });

  // 加入房间
  socket.on('join-room', (roomId, callback) => {
    console.log('Attempting to join room:', roomId, 'User:', socket.id);
    const room = rooms.get(roomId);
    
    if (!room) {
      console.log('Room does not exist:', roomId);
      callback({ success: false, message: 'Room does not exist' });
      return;
    }
    
    socket.join(roomId);
    
    if (!room.peers.includes(socket.id)) {
      room.peers.push(socket.id);
    }
    
    console.log('User joined room:', roomId, 'Total peers:', room.peers.length);
    
    callback({ 
      success: true, 
      hostId: room.host,
      fileInfo: room.fileInfo
    });
    
    // 通知房间内其他用户有新用户加入
    socket.to(roomId).emit('peer-joined', socket.id);
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
    
    socket.join(roomId);
    
    if (!room.peers.includes(socket.id)) {
      room.peers.push(socket.id);
    }
    
    if (!room.reconnectedPeers) {
      room.reconnectedPeers = {};
    }
    room.reconnectedPeers[socket.id] = {
      mode: mode,
      transferId: transferId,
      lastChunk: lastChunk,
      reconnectTime: Date.now()
    };
    
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

  // WebRTC 信令
  socket.on('signal', (data) => {
    // 验证输入数据
    if (!data || !data.to || !data.signal) {
      console.error('Invalid signal data from', socket.id, ':', data);
      return;
    }
    
    console.log('Relaying signal from', socket.id, 'to', data.to);
    
    // 检查目标用户是否存在
    const targetSocket = io.sockets.sockets.get(data.to);
    if (!targetSocket) {
      console.error('Target socket not found:', data.to);
      socket.emit('signal-error', { 
        message: 'Target user not found',
        targetId: data.to 
      });
      return;
    }
    
    socket.to(data.to).emit('signal', {
      signal: data.signal,
      from: socket.id
    });
  });

  // 设置传输模式
  socket.on('set-transfer-mode', (data) => {
    const { roomId, mode } = data;
    const room = rooms.get(roomId);
    if (room) {
      room.transferMode = mode;
      console.log('Transfer mode set to', mode, 'for room', roomId);
      
      // 通知房间内所有用户传输模式
      io.to(roomId).emit('transfer-mode-set', { mode: mode });
    }
  });

  // 文件块中继
  socket.on('relay-chunk', (data) => {
    const { roomId, chunk, chunkIndex, totalChunks, transferId } = data;
    const room = rooms.get(roomId);
    
    if (room) {
      // 初始化中继块存储
      if (!room.relayChunks) {
        room.relayChunks = {};
      }
      if (!room.relayChunks[transferId]) {
        room.relayChunks[transferId] = {};
      }
      
      // 存储块数据
      room.relayChunks[transferId][chunkIndex] = chunk;
      
      console.log(`Relaying chunk ${chunkIndex + 1}/${totalChunks} for room ${roomId}`);
      
      // 转发给房间内其他用户
      socket.to(roomId).emit('relay-chunk', {
        chunk: chunk,
        chunkIndex: chunkIndex,
        totalChunks: totalChunks,
        transferId: transferId
      });
    }
  });

  // 请求中继块（断点续传）
  socket.on('request-relay-chunk', (data) => {
    const { roomId, chunkIndex, transferId } = data;
    const room = rooms.get(roomId);
    
    if (room && room.relayChunks && room.relayChunks[transferId]) {
      const chunk = room.relayChunks[transferId][chunkIndex];
      if (chunk) {
        socket.emit('relay-chunk', {
          chunk: chunk,
          chunkIndex: chunkIndex,
          transferId: transferId
        });
      }
    }
  });

  // 文件传输完成
  socket.on('file-transfer-complete', (data) => {
    const { roomId, transferId } = data;
    console.log('File transfer complete for room', roomId);
    
    socket.to(roomId).emit('file-transfer-complete', data);
    
    // 清理中继数据
    const room = rooms.get(roomId);
    if (room && room.relayChunks && room.relayChunks[transferId]) {
      delete room.relayChunks[transferId];
      console.log('Cleaned up relay data for transfer', transferId);
    }
  });

  // 用户断开连接
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // 清理用户相关的房间
    for (const [roomId, room] of rooms.entries()) {
      if (room.peers.includes(socket.id)) {
        room.peers = room.peers.filter(peer => peer !== socket.id);
        
        // 通知房间内其他用户有人离开
        socket.to(roomId).emit('peer-left', socket.id);
        
        // 如果房间为空，删除房间
        if (room.peers.length === 0) {
          rooms.delete(roomId);
          console.log('Room deleted:', roomId);
        }
      }
    }
  });
});

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    rooms: rooms.size,
    timestamp: new Date().toISOString()
  });
});

// 获取房间统计
app.get('/stats', (req, res) => {
  const stats = {
    totalRooms: rooms.size,
    activeConnections: io.sockets.sockets.size,
    roomList: []
  };
  
  for (const [roomId, room] of rooms.entries()) {
    stats.roomList.push({
      roomId: roomId,
      peers: room.peers.length,
      createdAt: room.createdAt,
      hasFile: !!room.fileInfo
    });
  }
  
  res.json(stats);
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`=== Kemushi 信令服务器启动成功 ===`);
  console.log(`端口: ${PORT}`);
  console.log(`健康检查: http://localhost:${PORT}/health`);
  console.log(`统计信息: http://localhost:${PORT}/stats`);
  console.log(`===========================`);
});

// 定期清理过期房间（1小时）
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  for (const [roomId, room] of rooms.entries()) {
    if (now - room.createdAt > oneHour) {
      rooms.delete(roomId);
      console.log('Cleaned up expired room:', roomId);
    }
  }
}, 10 * 60 * 1000); // 每10分钟检查一次