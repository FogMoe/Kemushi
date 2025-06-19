# kemushi 混合模式部署指南

## 概述

kemushi 支持三种传输模式：
1. **局域网直连** - 同一网络内最快速的传输
2. **WebRTC P2P** - 跨网络的点对点传输
3. **服务器中继** - 大文件或网络限制时的备用方案

## 云服务器部署

### 1. 准备工作

- 一台云服务器（推荐配置：2核4G，带宽5Mbps+）
- 域名（可选，但建议使用）
- SSL证书（如果使用域名）

### 2. 修改配置文件

编辑 `src/main/config.js`：

```javascript
cloud: {
    signalServer: 'wss://your-domain.com:3000', // 您的服务器地址
    apiEndpoint: 'https://your-domain.com/api',
    apiKey: 'your-api-key' // 如果需要认证
}
```

### 3. 服务器端部署

在云服务器上：

```bash
# 克隆代码
git clone https://github.com/your-repo/kemushi.git
cd kemushi

# 安装依赖
npm install

# 创建服务器端脚本
mkdir server
cd server
```

创建 `server.js`：

```javascript
const express = require('express');
const https = require('https');
const { Server } = require('socket.io');
const fs = require('fs');

const app = express();

// SSL证书（如果使用HTTPS）
const server = https.createServer({
    key: fs.readFileSync('path/to/private.key'),
    cert: fs.readFileSync('path/to/certificate.crt')
}, app);

// 或者使用HTTP（不推荐生产环境）
// const server = require('http').createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// 复制主程序中的socket.io逻辑
// ... (从 src/main/index.js 复制信令服务器代码)

server.listen(3000, () => {
    console.log('Signal server running on port 3000');
});
```

### 4. 使用 PM2 管理进程

```bash
# 安装 PM2
npm install -g pm2

# 启动服务器
pm2 start server.js --name kemushi-signal

# 设置开机自启
pm2 startup
pm2 save
```

### 5. 配置防火墙

开放必要端口：
- 3000 (WebSocket信令)
- 80/443 (如果使用Web界面)

```bash
# 以 Ubuntu 为例
sudo ufw allow 3000
sudo ufw allow 80
sudo ufw allow 443
```

### 6. 添加 TURN 服务器（可选但推荐）

安装 coturn：

```bash
sudo apt-get install coturn
```

配置 `/etc/turnserver.conf`：

```conf
listening-port=3478
fingerprint
lt-cred-mech
user=username:password
realm=your-domain.com
cert=/path/to/certificate.crt
pkey=/path/to/private.key
```

启动 TURN 服务器：

```bash
sudo systemctl start coturn
sudo systemctl enable coturn
```

更新配置文件中的 TURN 服务器信息。

## 使用说明

### 局域网模式

当双方在同一网络时，应用会自动选择局域网直连模式：
- 无需服务器中继
- 传输速度最快
- 不消耗服务器流量

### 跨网络模式

当检测到跨网络传输时：

1. **小文件**：优先尝试 WebRTC P2P
2. **大文件**：建议使用服务器中继
3. **连接失败**：自动切换到服务器中继

### 优化建议

1. **带宽优化**
   - 设置合理的块大小（配置文件中的 `relayChunkSize`）
   - 启用文件压缩（大于10MB的文件）

2. **存储优化**
   - 服务器中继使用流式传输
   - 及时清理临时文件

3. **安全性**
   - 使用 HTTPS/WSS
   - 添加 API 认证
   - 限制文件大小和传输频率

## 监控和维护

### 查看日志

```bash
pm2 logs kemushi-signal
```

### 监控资源使用

```bash
pm2 monit
```

### 更新应用

```bash
git pull
npm install
pm2 restart kemushi-signal
```

## 故障排查

### 连接失败

1. 检查防火墙设置
2. 确认域名解析正确
3. 查看服务器日志

### 传输缓慢

1. 检查服务器带宽
2. 优化块大小设置
3. 考虑使用 CDN

### 内存占用过高

1. 减小中继块大小
2. 实现流式传输
3. 设置文件大小限制

## 成本优化

- 局域网传输不消耗流量
- P2P 传输只需信令流量（极少）
- 服务器中继按需使用
- 可设置文件大小限制避免滥用

通过合理配置，中等频率使用下，每月流量费用可控制在较低水平。 