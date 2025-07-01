# Kemushi 信令服务器部署指南

这是 Kemushi P2P 文件传输应用的独立信令服务器。

## 功能

- 房间管理：创建和加入房间
- WebRTC 信令：P2P 连接协商
- 文件中继：当 P2P 失败时作为中继服务器
- 断点续传：支持传输中断后恢复
- 自动清理：定期清理过期房间

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 或直接启动
npm start
```

服务器将在 http://localhost:3000 启动。

## 生产环境部署

### 1. 服务器要求

- Node.js 16+ 
- 2GB+ 内存
- 5Mbps+ 带宽
- 开放端口 3000 (或自定义)

### 2. 直接部署

```bash
# 克隆代码
git clone <your-repo>
cd Kemushi/server

# 安装依赖
npm install

# 使用 PM2 管理进程
npm install -g pm2
pm2 start signal-server.js --name kemushi-signal

# 设置开机自启
pm2 startup
pm2 save
```

### 3. Docker 部署

创建 `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "signal-server.js"]
```

构建和运行：

```bash
docker build -t kemushi-signal .
docker run -d -p 3000:3000 --name kemushi-signal kemushi-signal
```

### 4. 使用 Nginx 反向代理

配置 `/etc/nginx/sites-available/kemushi`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

启用配置：

```bash
ln -s /etc/nginx/sites-available/kemushi /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

### 5. HTTPS 配置 (推荐)

使用 Let's Encrypt:

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

## 环境变量

可以通过环境变量配置：

```bash
export PORT=3000                    # 服务器端口
export NODE_ENV=production          # 运行环境
```

## 监控和维护

### 查看状态

```bash
# 服务器健康检查
curl http://your-domain.com/health

# 查看房间统计
curl http://your-domain.com/stats

# PM2 进程状态
pm2 status
pm2 logs kemushi-signal

# Docker 日志
docker logs kemushi-signal
```

### 性能监控

```bash
# PM2 监控
pm2 monit

# 系统资源
htop
```

## 客户端配置

部署完成后，需要修改客户端的 `src/main/config.js`:

```javascript
cloud: {
  signalServer: 'https://your-domain.com',
  apiEndpoint: 'https://your-domain.com/api',
  enabled: true
}
```

## 安全建议

1. **使用 HTTPS**: 确保 WebSocket 连接安全
2. **防火墙**: 只开放必要端口
3. **访问限制**: 可考虑添加 API 密钥认证
4. **监控**: 设置异常监控和告警
5. **备份**: 定期备份配置文件

## 故障排查

### 常见问题

1. **连接失败**
   - 检查防火墙设置
   - 确认端口是否开放
   - 验证域名解析

2. **房间找不到**
   - 检查服务器日志
   - 确认房间是否过期被清理

3. **传输缓慢**
   - 检查服务器带宽
   - 考虑使用 CDN

### 日志分析

服务器会输出详细的连接和传输日志，便于排查问题：

```
Client connected: abc123
Room created: XYZ789 Host: abc123
User joined room: XYZ789 Total peers: 2
Relaying chunk 1/100 for room XYZ789
```

## 云服务商部署

### AWS EC2
- 选择 t3.small 或更高配置
- 配置安全组开放端口 80/443
- 使用 Elastic IP 获得固定 IP

### 阿里云 ECS
- 选择 2核4G 配置
- 配置安全组规则
- 可使用 SLB 做负载均衡

### Heroku
- Fork 本项目到 GitHub
- 在 Heroku 创建应用
- 连接 GitHub 仓库自动部署

### Vercel (免费选项)
- 适合小规模使用
- 自动 HTTPS
- 全球 CDN

部署成功后，所有用户都能通过输入 6 位密钥直接连接，无需知道对方 IP 地址！