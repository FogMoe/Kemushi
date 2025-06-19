const os = require('os');
const config = require('./config');

class NetworkUtils {
  // 获取本机IP地址
  static getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        // 跳过内部回环地址和IPv6
        if (iface.internal || iface.family !== 'IPv4') continue;
        ips.push(iface.address);
      }
    }
    
    return ips;
  }
  
  // 检查IP是否在局域网范围内
  static isPrivateIP(ip) {
    const parts = ip.split('.').map(Number);
    
    // 10.0.0.0 - 10.255.255.255
    if (parts[0] === 10) return true;
    
    // 172.16.0.0 - 172.31.255.255
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    
    // 192.168.0.0 - 192.168.255.255
    if (parts[0] === 192 && parts[1] === 168) return true;
    
    // 127.0.0.0 - 127.255.255.255 (localhost)
    if (parts[0] === 127) return true;
    
    return false;
  }
  
  // 检查两个IP是否在同一局域网
  static isSameNetwork(ip1, ip2) {
    // 如果都是私有IP，检查前三段是否相同
    if (this.isPrivateIP(ip1) && this.isPrivateIP(ip2)) {
      const parts1 = ip1.split('.').slice(0, 3);
      const parts2 = ip2.split('.').slice(0, 3);
      return parts1.join('.') === parts2.join('.');
    }
    return false;
  }
  
  // 根据网络情况选择传输模式
  static selectTransferMode(localIP, remoteIP, fileSize) {
    // 同一局域网 - 使用直接P2P
    if (this.isSameNetwork(localIP, remoteIP)) {
      return {
        mode: 'direct-p2p',
        reason: '同一局域网内，使用直接P2P传输',
        useRelay: false
      };
    }
    
    // 跨网络但文件较小 - 尝试WebRTC P2P
    if (fileSize < config.transfer.maxDirectSize) {
      return {
        mode: 'webrtc-p2p',
        reason: '跨网络传输，文件大小适中，尝试WebRTC P2P',
        useRelay: false,
        fallbackToRelay: true
      };
    }
    
    // 大文件 - 建议使用服务器中继
    return {
      mode: 'server-relay',
      reason: '跨网络传输大文件，建议使用服务器中继',
      useRelay: true,
      enableCompression: fileSize > config.transfer.compressionThreshold
    };
  }
  
  // 估算传输时间
  static estimateTransferTime(fileSize, mode) {
    const estimates = {
      'direct-p2p': fileSize / (10 * 1024 * 1024), // 假设局域网10MB/s
      'webrtc-p2p': fileSize / (1 * 1024 * 1024),  // 假设广域网1MB/s
      'server-relay': fileSize / (500 * 1024)       // 假设服务器中继500KB/s
    };
    
    const seconds = estimates[mode] || 0;
    return {
      seconds: Math.ceil(seconds),
      formatted: this.formatTime(seconds)
    };
  }
  
  // 格式化时间
  static formatTime(seconds) {
    if (seconds < 60) return `${Math.ceil(seconds)}秒`;
    if (seconds < 3600) return `${Math.ceil(seconds / 60)}分钟`;
    return `${Math.ceil(seconds / 3600)}小时`;
  }
}

module.exports = NetworkUtils; 