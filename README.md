# Kemushi 🚀

[![构建状态](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/FogMoe/Kemushi)
[![许可证](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)
[![Electron版本](https://img.shields.io/badge/electron-^36.5.0-blueviolet)](https://www.electronjs.org/)

**Kemushi** 是一款现代化的点对点（P2P）文件共享工具，基于 Electron 和 WebRTC 技术构建。它致力于提供一种安全、快速且高效的跨平台文件传输体验。

![Kemushi 截图](https://raw.githubusercontent.com/FogMoe/Kemushi/main/docs/screenshot.png)

## ✨ 核心功能

- **多模式传输**: 智能选择 **局域网直连**、**WebRTC P2P** 或 **服务器中继** 模式，确保在不同网络环境下的最佳传输效率。
- **安全保密**: 文件传输默认采用端到端加密，除中继模式外，文件不经过任何第三方服务器，保护你的隐私安全。
- **简单易用**: 只需一个 6 位数的分享码即可建立连接，无需注册登录，即开即用。
- **跨平台**: 基于 Electron 构建，完美支持 Windows，并可轻松扩展至 macOS 和 Linux。
- **实时进度**: 清晰地显示传输速度、进度百分比和预估剩余时间。
- **多语言支持**: 内置简体中文和繁體中文，并可方便地扩展其他语言。
- **便携版本**: 提供免安装的 Windows portable 版本，方便快捷。
- **历史记录**: 自动保存传输历史，方便追溯和管理。

## 🛠️ 技术栈

- **核心框架**: [Electron](https://www.electronjs.org/)
- **P2P 通信**: [WebRTC (simple-peer)](https://github.com/simple-peer/simple-peer)
- **信令服务**: [Socket.IO](https://socket.io/)
- **前端界面**: HTML5, CSS3, JavaScript (ES6+)
- **打包工具**: [electron-builder](https://www.electron.build/)

## 🚀 如何工作

Kemushi 采用混合传输策略，以实现最优的传输效果：

1.  **局域网优先 (LAN)**: 当发送和接收方在同一个局域网内时，应用会自动采用 TCP 直连进行传输，速度最快，不消耗公网流量。
2.  **WebRTC P2P**: 如果双方不在同一网络，应用会尝试通过 WebRTC 的 "NAT 打洞" 技术建立直接的点对点连接。这是最主要的跨网传输方式。
3.  **服务器中继 (Relay)**: 当 P2P 连接因网络限制（如对称型 NAT）无法建立时，数据将通过云端服务器进行加密中继转发，作为备用方案确保文件能够成功送达。

## 📦 使用说明

### 1. 下载预编译版本

前往项目的 [**Releases**](https://github.com/FogMoe/Kemushi/releases) 页面，下载对应你操作系统的最新版本（安装包或便携版）。

### 2. 从源码运行

如果你是开发者，可以按照以下步骤从源码运行：

```bash
# 1. 克隆仓库
git clone https://github.com/FogMoe/Kemushi.git

# 2. 进入项目目录
cd Kemushi

# 3. 安装依赖
npm install

# 4. 启动应用
npm start

# 启动开发者模式
npm run dev
```

## 🏗️ 开发与构建

本项目使用 `electron-builder` 进行打包。

```bash
# 构建适用于所有平台（根据当前系统）的应用
npm run build

# 仅构建 Windows 应用 (nsis 安装包)
npm run build:win

# 构建 Windows 64位便携版
npm run build:portable64
```

构建产物将位于 `dist` 目录下。

## ☁️ 部署私有服务器

为了获得最佳的稳定性和隐私保护，你可以部署自己的信令服务器和 TURN/STUN 中继服务器。

详细的服务器部署方法，请参考文档：
[**服务器部署指南](./docs/DEPLOYMENT.md)**

## 📄 许可证

本项目基于 [AGPL-3.0](./LICENSE) 许可证。 