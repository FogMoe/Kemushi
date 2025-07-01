# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Kemushi** is a cross-platform P2P file sharing desktop application built with Electron. It implements a sophisticated multi-mode transfer system using WebRTC, Socket.IO, and direct TCP connections for optimal file sharing across different network environments.

## Development Commands

```bash
# Start the application
npm start

# Start in development mode (with DevTools)
npm run dev

# Build for current platform
npm run build

# Build Windows installer
npm run build:win

# Build Windows portable (64-bit)
npm run build:portable64

# Install dependencies
npm install
```

## Architecture

### Core Components

- **Main Process** (`src/main/index.js`): Electron app initialization, built-in signaling server, WebRTC orchestration
- **Preload Script** (`src/preload/preload.js`): Secure IPC bridge using contextBridge
- **Renderer Process** (`public/js/renderer.js`): Frontend UI logic with file transfer management
- **Configuration** (`src/main/config.js`): WebRTC/STUN/TURN settings and transfer parameters

### Multi-Mode Transfer System

The application intelligently selects between three transfer modes:

1. **LAN Direct**: TCP direct connection within local networks (fastest)
2. **WebRTC P2P**: NAT traversal for cross-network transfers (most common)
3. **Server Relay**: Fallback through signaling server when P2P fails

### Key Architecture Patterns

- **Built-in Signaling Server**: Express + Socket.IO server runs within the Electron app
- **Room-Based Connections**: 6-digit codes create isolated transfer rooms
- **Chunked Transfer**: Large files split into configurable chunks with progress tracking
- **Reconnection Logic**: Automatic retry and resume capabilities for interrupted transfers
- **Security**: Context isolation, disabled node integration, secure IPC communication

## File Structure

```
src/
├── main/           # Main process (Node.js backend)
├── preload/        # Security bridge scripts
├── renderer/       # Renderer process files (mostly unused)
└── i18n/           # Internationalization files

public/             # Frontend assets
├── index.html      # Main UI
├── js/renderer.js  # Frontend logic
└── css/style.css   # Styling

docs/               # Documentation
└── DEPLOYMENT.md   # Server deployment guide
```

## Configuration

### WebRTC Configuration (`src/main/config.js`)
- STUN/TURN server settings for NAT traversal
- Transfer chunk sizes and timeouts
- Network detection parameters
- Reconnection and resume settings

### Build Configuration (`package.json`)
- Electron-builder setup for Windows (NSIS + Portable)
- Resource inclusion (i18n files, icons)
- Output directory: `dist/`

## Internationalization

The app supports multiple languages via JSON files in `src/i18n/`:
- `zh-CN.json`: Simplified Chinese
- `zh-TW.json`: Traditional Chinese

Language files are dynamically loaded by `public/js/i18n.js`.

## Security Considerations

- Uses Electron security best practices (context isolation, disabled node integration)
- End-to-end encryption for direct transfers (LAN and WebRTC modes)
- Server relay mode uses encrypted transmission
- No persistent storage of sensitive data

## Development Notes

- The application includes its own signaling server, eliminating external dependencies for basic operation
- Transfer mode selection is automatic based on network topology detection
- File history is stored locally with configurable retention
- Custom window controls implemented for frameless design
- Uses CommonJS module system throughout