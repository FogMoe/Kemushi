// 应用配置
module.exports = {
  // 本地信令服务器配置
  local: {
    signalPort: 3000,
    host: 'localhost'
  },
  
  // 云服务器配置（请替换为您的实际服务器信息）
  cloud: {
    signalServer: 'http://kemushi.fog.moe:3000',  // 你的信令服务器地址
    apiEndpoint: 'http://kemushi.fog.moe:3000/api', 
    // 如果需要认证
    apiKey: process.env.API_KEY || '',
    enabled: true  // 启用云服务器模式
  },
  
  // WebRTC配置
  webrtc: {
    // 是否启用 TURN 服务器（用于复杂网络环境）
    enableTURN: true,
    
    // ICE服务器配置 
    iceServers: [
      // STUN 服务器 
      { urls: 'stun:195.208.107.138:3478' },
      { urls: 'stun:kemushi.fog.moe:3478' }
    ]
  },
  
  // 传输配置
  transfer: {
    // 分块大小（64KB）
    chunkSize: 64 * 1024,
    // 最大直接P2P文件大小（10000MB以上考虑使用服务器中继）
    maxDirectSize: 10000 * 1024 * 1024,
    // 服务器中继时的分块大小（1MB）
    relayChunkSize: 1024 * 1024,
    // 传输超时时间（5分钟）
    timeout: 5 * 60 * 1000,
    // 是否启用压缩（对于大文件）
    enableCompression: true,
    // 压缩阈值（100MB以上的文件考虑压缩）
    compressionThreshold: 100 * 1024 * 1024
  },
  
  // 网络检测配置
  network: {
    // 本地网络IP范围
    localRanges: [
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '127.0.0.0/8'
    ],
    // 本地端口范围
    portRange: {
      start: 3000,
      end: 3010
    }
  },
  
  // 断线重连配置
  reconnect: {
    // 是否启用自动重连
    enabled: true,
    // 最大重连次数
    maxAttempts: 5,
    // 重连间隔（毫秒）
    interval: 3000,
    // 重连间隔递增倍数
    intervalMultiplier: 1.5,
    // 最大重连间隔（毫秒）
    maxInterval: 30000
  },
  
  // 断点续传配置
  resume: {
    // 是否启用断点续传
    enabled: true,
    // 传输进度保存间隔（每传输多少块保存一次）
    saveProgressInterval: 10,
    // 传输进度缓存时间（毫秒）
    progressCacheTime: 24 * 60 * 60 * 1000, // 24小时
    // 进度文件保存路径（相对于应用数据目录）
    progressFilePath: 'transfer-progress.json'
  }
}; 