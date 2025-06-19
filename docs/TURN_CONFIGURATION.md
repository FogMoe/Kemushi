# TURN 服务器配置指南

## 概述

kemushi 现在支持 TURN (Traversal Using Relays around NAT) 服务器，这可以显著提高在复杂网络环境下的连接成功率。

## STUN vs TURN

- **STUN 服务器**：帮助客户端发现自己的公网 IP 地址，用于 NAT 穿透
- **TURN 服务器**：不仅提供 STUN 功能，还可以在 P2P 连接无法建立时作为中继服务器

## Cloudflare TURN 服务器配置

kemushi 已预配置了 Cloudflare 的 TURN 服务器：

- **主服务器**: `turn.cloudflare.com:3478` (UDP/TCP)
- **备用端口**:
  - `:53/udp` - DNS 端口，通常不会被防火墙阻止
  - `:80/tcp` - HTTP 端口，通常不会被防火墙阻止

## 使用场景

TURN 服务器特别适用于以下场景：

1. **严格的企业防火墙**：某些企业网络只允许特定端口的流量
2. **对称型 NAT**：最严格的 NAT 类型，普通 STUN 无法穿透
3. **移动网络**：某些移动运营商使用复杂的 NAT 配置
4. **跨国传输**：不同国家的网络策略可能导致直连困难

## 配置说明

### 1. 启用/禁用 TURN

在 `src/main/config.js` 中：

```javascript
webrtc: {
  enableTURN: true,  // 设置为 false 可禁用 TURN
  // ...
}
```

### 2. 配置认证信息

如果您的 TURN 服务器需要认证，请更新用户名和密码：

```javascript
{
  urls: 'turn:turn.cloudflare.com:3478',
  username: 'your-username',  // 替换为实际用户名
  credential: 'your-password'  // 替换为实际密码
}
```

### 3. 添加自定义 TURN 服务器

您可以添加自己的 TURN 服务器：

```javascript
iceServers: [
  // ... 现有服务器
  {
    urls: 'turn:your-turn-server.com:3478',
    username: 'username',
    credential: 'password'
  }
]
```

## 性能影响

- **直连优先**：WebRTC 会优先尝试直接 P2P 连接
- **自动回退**：只有在直连失败时才会使用 TURN 中继
- **带宽消耗**：使用 TURN 中继会消耗服务器带宽

## 故障排除

1. **检查防火墙**：确保允许 UDP/TCP 流量通过配置的端口
2. **验证认证**：如果 TURN 需要认证，确保凭据正确
3. **查看控制台**：打开开发者控制台查看 ICE 连接状态
4. **测试备用端口**：如果主端口不通，会自动尝试备用端口

## 注意事项

1. 免费的公共 TURN 服务器可能有使用限制
2. 对于生产环境，建议部署自己的 TURN 服务器
3. TURN 中继会增加延迟，但能确保连接成功

## 相关资源

- [WebRTC ICE 工作原理](https://webrtc.org/getting-started/peer-connections)
- [Cloudflare TURN 服务](https://developers.cloudflare.com/calls/turn/)
- [部署自己的 TURN 服务器 (coturn)](https://github.com/coturn/coturn) 