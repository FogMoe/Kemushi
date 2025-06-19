// 全局变量
var currentMode = null;
var selectedFile = null;
var currentTransferFile = null; // 保存当前传输的文件信息，用于自发自收
var peer = null;
var fileBuffer = null;
var receivedChunks = [];
var totalChunks = 0;
var receivedSize = 0;
var startTime = null;
var socket = null;
var serverPort = 3000; // 默认端口
var transferMode = null; // 当前传输模式
var networkConfig = null; // 网络配置
var currentRoomId = null; // 当前房间ID

// 断线重连相关变量
var reconnectAttempts = 0;
var reconnectTimer = null;
var isReconnecting = false;
var lastConnectionState = null;

// 断点续传相关变量
var currentTransferId = null; // 当前传输ID
var lastSavedProgress = 0; // 上次保存进度的块索引
var transferProgress = null; // 传输进度信息
var isResumingTransfer = false; // 是否正在恢复传输

// 生成传输ID
function generateTransferId(roomId, fileName, fileSize) {
    const timestamp = Date.now();
    const hash = btoa(`${roomId}-${fileName}-${fileSize}-${timestamp}`).replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
    return `transfer-${hash}`;
}

// 保存传输进度
async function saveTransferProgress(chunkIndex, totalChunks, metadata = {}) {
    if (!networkConfig?.resume?.enabled || !currentTransferId) {
        return;
    }
    
    // 只在达到保存间隔时保存
    if (chunkIndex - lastSavedProgress < (networkConfig.resume.saveProgressInterval || 10)) {
        return;
    }
    
    const progressData = {
        transferId: currentTransferId,
        roomId: currentRoomId,
        mode: currentMode,
        fileName: selectedFile?.name || window.receivedFileName,
        fileSize: selectedFile?.size || receivedSize,
        chunkIndex: chunkIndex,
        totalChunks: totalChunks,
        transferMode: transferMode,
        metadata: metadata,
        timestamp: Date.now()
    };
    
    try {
        const result = await window.electronAPI.saveTransferProgress(progressData);
        if (result.success) {
            lastSavedProgress = chunkIndex;
            console.log('传输进度已保存:', chunkIndex, '/', totalChunks);
        }
    } catch (error) {
        console.error('保存传输进度失败:', error);
    }
}

// 加载传输进度
async function loadTransferProgress(transferId) {
    if (!networkConfig?.resume?.enabled) {
        return null;
    }
    
    try {
        const progress = await window.electronAPI.getTransferProgress(transferId);
        if (progress) {
            console.log('加载传输进度:', progress);
            return progress;
        }
    } catch (error) {
        console.error('加载传输进度失败:', error);
    }
    
    return null;
}

// 清除传输进度
async function clearTransferProgress() {
    if (currentTransferId) {
        try {
            await window.electronAPI.clearTransferProgress(currentTransferId);
            console.log('传输进度已清除');
        } catch (error) {
            console.error('清除传输进度失败:', error);
        }
    }
    
    currentTransferId = null;
    lastSavedProgress = 0;
    transferProgress = null;
    isResumingTransfer = false;
}

// 检查是否可以恢复传输
async function checkResumeTransfer(roomId, fileName, fileSize) {
    if (!networkConfig?.resume?.enabled) {
        return false;
    }
    
    // 生成传输ID
    const transferId = generateTransferId(roomId, fileName, fileSize);
    
    // 尝试加载传输进度
    const progress = await loadTransferProgress(transferId);
    
    if (progress && progress.roomId === roomId && progress.fileName === fileName) {
        // 显示恢复传输对话框
        return new Promise((resolve) => {
            showModal(
                '检测到未完成的传输',
                `文件 "${fileName}" 的传输已完成 ${Math.round((progress.chunkIndex / progress.totalChunks) * 100)}%，是否继续？`,
                '继续传输',
                '重新开始',
                () => {
                    currentTransferId = transferId;
                    transferProgress = progress;
                    isResumingTransfer = true;
                    resolve(true);
                },
                () => {
                    // 清除旧进度
                    window.electronAPI.clearTransferProgress(transferId);
                    resolve(false);
                }
            );
        });
    }
    
    return false;
}

// 窗口控制函数
function minimizeWindow() {
    if (window.electronAPI && window.electronAPI.minimizeWindow) {
        window.electronAPI.minimizeWindow();
    }
}

function maximizeWindow() {
    if (window.electronAPI && window.electronAPI.maximizeWindow) {
        window.electronAPI.maximizeWindow();
    }
}

function closeWindow() {
    if (window.electronAPI && window.electronAPI.closeWindow) {
        window.electronAPI.closeWindow();
    }
}

// 手动保存功能
function manualSave() {
    console.log('Manual save triggered');
    if (receivedChunks.length === 0) {
        showModal('保存失败', '没有接收到任何文件数据', '知道了');
        return;
    }
    
    window.receivedFileName = window.receivedFileName || 'received_file';
    saveReceivedFile();
}

// 等待DOM加载完成
document.addEventListener('DOMContentLoaded', function() {
    console.log('应用已加载');
    
    // 确保SimplePeer可用
    if (typeof SimplePeer === 'undefined') {
        console.error('SimplePeer 未加载');
        return;
    }
    
    // 确保io可用
    if (typeof io === 'undefined') {
        console.error('Socket.io 未加载');
        return;
    }
    
    // 获取网络配置
    loadNetworkConfig().then(() => {
        // 立即初始化socket连接（使用默认端口）
        initializeSocket();
        
        // 监听服务器端口信息，如果收到新端口则重新连接
        if (window.electronAPI && window.electronAPI.onServerPort) {
            window.electronAPI.onServerPort((event, port) => {
                console.log('收到服务器端口:', port);
                if (port !== serverPort) {
                    serverPort = port;
                    // 重新初始化socket连接
                    initializeSocket();
                }
            });
        }
    });
    
    function initializeSocket() {
        console.log(`开始初始化Socket连接，端口: ${serverPort}`);
        
        // 如果已有连接，先断开
        if (socket) {
            console.log('断开现有Socket连接');
            socket.disconnect();
        }
        
        // 创建socket连接
        console.log(`创建新的Socket连接: http://localhost:${serverPort}`);
        socket = io(`http://localhost:${serverPort}`, {
            reconnection: true,
            reconnectionAttempts: networkConfig?.reconnect?.maxAttempts || 5,
            reconnectionDelay: networkConfig?.reconnect?.interval || 3000,
            reconnectionDelayMax: networkConfig?.reconnect?.maxInterval || 30000,
            timeout: 20000
        });
        
        // 监听房间关闭相关事件
        socket.on('room-closing', (data) => {
            console.log('房间即将关闭:', data.message);
            showModal('房间提示', data.message, '知道了');
        });
        
        socket.on('room-closed', (data) => {
            console.log('房间已关闭:', data.message);
            // 清理传输文件信息并重置UI
            currentTransferFile = null;
            setTimeout(() => {
                resetUIAfterTransfer();
            }, 500);
        });
        
        socket.on('connect', () => {
            console.log('✅ Socket连接已建立，端口:', serverPort);
            lastConnectionState = 'connected';
            
            // 如果正在重连，恢复传输
            if (isReconnecting && currentRoomId) {
                handleReconnectSuccess();
            }
            
            isReconnecting = false;
            reconnectAttempts = 0;
        });
        
        socket.on('connect_error', (err) => {
            console.error('❌ Socket连接错误:', err);
            lastConnectionState = 'error';
        });
        
        socket.on('disconnect', (reason) => {
            console.log('Socket连接断开:', reason);
            lastConnectionState = 'disconnected';
            
            // 如果正在传输，启动重连
            if (currentRoomId && (currentMode === 'send' || currentMode === 'receive')) {
                handleDisconnect(reason);
            }
        });
        
        // 重连相关事件
        socket.on('reconnect_attempt', (attemptNumber) => {
            console.log(`正在尝试重连... (第 ${attemptNumber} 次)`);
            isReconnecting = true;
            reconnectAttempts = attemptNumber;
            
            // 显示重连提示
            updateConnectionStatus('reconnecting', attemptNumber);
        });
        
        socket.on('reconnect_failed', () => {
            console.error('重连失败');
            isReconnecting = false;
            updateConnectionStatus('failed');
            
            showModal('连接失败', '无法重新连接到服务器。请检查网络连接后重试。', '知道了');
        });
        
        // 监听传输模式选择
        socket.on('transfer-mode-selected', (data) => {
            console.log('传输模式已选择:', data);
            transferMode = data.mode;
            
            // 显示传输模式信息
            showTransferModeInfo(data);
        });
    }
    
    // 处理断线事件
    function handleDisconnect(reason) {
        console.log('处理断线事件:', reason);
        
        // 暂停传输
        if (peer) {
            peer.pause && peer.pause();
        }
        
        // 保存当前传输进度
        if (currentMode === 'send' && fileBuffer) {
            const currentChunk = Math.floor((receivedSize || 0) / (networkConfig?.transfer?.chunkSize || 64 * 1024));
            saveTransferProgress(currentChunk, totalChunks);
        } else if (currentMode === 'receive' && receivedChunks.length > 0) {
            saveTransferProgress(receivedChunks.length, totalChunks);
        }
        
        updateConnectionStatus('disconnected');
    }
    
    // 处理重连成功
    async function handleReconnectSuccess() {
        console.log('重连成功，恢复传输');
        
        updateConnectionStatus('connected');
        
        // 重新加入房间
        if (currentRoomId) {
            socket.emit('rejoin-room', {
                roomId: currentRoomId,
                mode: currentMode,
                transferId: currentTransferId,
                lastChunk: currentMode === 'receive' ? receivedChunks.length : lastSavedProgress
            }, (response) => {
                if (response.success) {
                    console.log('重新加入房间成功');
                    
                    // 恢复P2P连接或继续传输
                    if (transferMode === 'server-relay') {
                        // 服务器中继模式，继续传输
                        if (currentMode === 'send') {
                            resumeSendFile();
                        } else {
                            resumeReceiveFile();
                        }
                    } else {
                        // P2P模式，重新建立连接
                        initiatePeerConnection(currentMode === 'send');
                    }
                } else {
                    console.error('重新加入房间失败:', response.message);
                    showModal('恢复失败', '无法恢复传输：' + response.message, '知道了');
                }
            });
        }
    }
    
    // 更新连接状态显示
    function updateConnectionStatus(status, attemptNumber = 0) {
        const statusElement = document.getElementById('connectionStatus');
        if (!statusElement) {
            // 创建状态显示元素
            const statusDiv = document.createElement('div');
            statusDiv.id = 'connectionStatus';
            statusDiv.className = 'connection-status';
            document.body.appendChild(statusDiv);
        }
        
        const statusEl = document.getElementById('connectionStatus');
        
        switch (status) {
            case 'connected':
                statusEl.textContent = '✅ 已连接';
                statusEl.className = 'connection-status connected';
                setTimeout(() => {
                    statusEl.style.display = 'none';
                }, 3000);
                break;
                
            case 'disconnected':
                statusEl.textContent = '❌ 连接断开';
                statusEl.className = 'connection-status disconnected';
                statusEl.style.display = 'block';
                break;
                
            case 'reconnecting':
                statusEl.textContent = `🔄 正在重连... (第 ${attemptNumber} 次)`;
                statusEl.className = 'connection-status reconnecting';
                statusEl.style.display = 'block';
                break;
                
            case 'failed':
                statusEl.textContent = '❌ 重连失败';
                statusEl.className = 'connection-status failed';
                statusEl.style.display = 'block';
                break;
        }
    }
    
    // 测试按钮是否存在
    const modeSelection = document.getElementById('modeSelection');
    if (modeSelection) {
        console.log('找到模式选择区域');
    } else {
        console.error('未找到模式选择区域');
    }
    
    // 立即暴露函数到全局作用域
    window.selectMode = selectMode;
    window.backToMenu = backToMenu;
    window.selectFile = selectFile;
    window.copyKey = copyKey;
    window.connectToPeer = connectToPeer;
    window.manualSave = manualSave;
    window.minimizeWindow = minimizeWindow;
    window.maximizeWindow = maximizeWindow;
    window.closeWindow = closeWindow;
    window.showSection = showSection;
    window.showModal = showModal;
    window.closeModal = closeModal;
    window.refreshHistory = refreshHistory;
    window.clearHistory = clearHistory;
    window.openFileLocation = openFileLocation;
    
    // 等待i18n初始化完成
    setTimeout(() => {
        if (window.i18n) {
            // 初始化语言选择器
            const languageSelect = document.getElementById('languageSelect');
            if (languageSelect) {
                languageSelect.value = window.i18n.getCurrentLanguage();
            }
            
            // 监听语言变化事件
            window.addEventListener('languageChanged', (event) => {
                console.log('语言已切换到:', event.detail.language);
                updateDynamicTexts();
            });
        }
    }, 500);
});

// 工具函数：格式化文件大小
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 工具函数：计算传输速度
function calculateSpeed(bytesTransferred, startTime) {
    const duration = (Date.now() - startTime) / 1000; // 秒
    const speed = bytesTransferred / duration; // 字节/秒
    return formatFileSize(speed) + '/s';
}

// 显示指定页面
function showSection(sectionName) {
    // 隐藏所有内容区域
    const sections = document.querySelectorAll('.content-section');
    sections.forEach(section => section.classList.remove('active'));
    
    // 更新导航状态
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => item.classList.remove('active'));
    
    // 显示指定的内容区域
    const targetSection = document.getElementById(sectionName + 'Section');
    if (targetSection) {
        targetSection.classList.add('active');
    }
    
    // 高亮对应的导航项
    const targetNavItem = document.querySelector(`.nav-item[onclick="showSection('${sectionName}')"]`);
    if (targetNavItem) {
        targetNavItem.classList.add('active');
    }
    
    // 如果是发送页面，设置拖拽区域
    if (sectionName === 'send') {
        currentMode = 'send';
        setupDropZone();
    } else if (sectionName === 'receive') {
        currentMode = 'receive';
        // 在接收页面显示提示信息
        if (selectedFile) {
            console.log('检测到已选择文件，可进行自发自收:', selectedFile.name);
        }
    } else if (sectionName === 'history') {
        loadTransferHistory();
    } else if (sectionName === 'settings') {
        // 更新语言选择器的值
        const languageSelect = document.getElementById('languageSelect');
        if (languageSelect && window.i18n) {
            languageSelect.value = window.i18n.getCurrentLanguage();
        }
    }
}

// 模式选择 (保持兼容性)
function selectMode(mode) {
    showSection(mode);
}

// 返回主菜单
function backToMenu() {
    showSection('home');
    
    // 重置所有状态
    if (peer) {
        try {
            peer.destroy();
        } catch (e) {
            console.log('销毁peer连接时出错:', e.message);
        }
        peer = null;
    }
    
    // 清理socket事件监听器
    if (socket) {
        socket.off('peer-joined');
        socket.off('signal');
        socket.off('peer-reconnected');
        socket.off('resume-sending');
    }
    
    // 清理断线重连相关状态
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    isReconnecting = false;
    reconnectAttempts = 0;
    
    // 清理传输进度（可选，根据需要决定是否保留）
    if (!isResumingTransfer) {
        clearTransferProgress();
    }
    
    selectedFile = null;
    currentTransferFile = null; // 重置传输文件信息
    fileBuffer = null;
    receivedChunks = [];
    totalChunks = 0;
    receivedSize = 0;
    startTime = null;
    window.receivedFileName = null;
    window.receivedFileSize = null;
    currentRoomId = null;
    transferMode = null;
    
    // 隐藏所有进度和信息元素
    const elementsToHide = [
        'fileInfo', 'shareInfo', 'sendProgress', 'receiveProgress'
    ];
    elementsToHide.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.classList.add('hidden');
        }
    });
    
    // 清空输入框
    const inputsToClean = ['shareKey', 'receiveKey'];
    inputsToClean.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.value = '';
        }
    });
    
    // 隐藏连接状态
    const statusEl = document.getElementById('connectionStatus');
    if (statusEl) {
        statusEl.style.display = 'none';
    }
    
    console.log('已重置所有状态并返回主菜单');
}

// 设置拖拽区域
function setupDropZone() {
    const dropZone = document.getElementById('dropZone');
    
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });
    
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });
    
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        
        if (e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    });
}

// 选择文件
async function selectFile() {
    const fileInfo = await window.electronAPI.selectFile();
    if (fileInfo) {
        selectedFile = fileInfo;
        currentTransferFile = fileInfo; // 保存到全局变量
        displayFileInfo();
        createRoom();
    }
}

// 处理文件选择
function handleFileSelect(file) {
    selectedFile = {
        file: file,
        name: file.name,
        size: file.size
    };
    
    currentTransferFile = selectedFile; // 保存到全局变量
    
    displayFileInfo();
    createRoom();
}

// 显示文件信息
function displayFileInfo() {
    document.getElementById('fileName').textContent = selectedFile.name;
    document.getElementById('fileSize').textContent = formatFileSize(selectedFile.size);
    document.getElementById('fileInfo').classList.remove('hidden');
}

// 创建房间
async function createRoom() {
    console.log('尝试创建房间...');
    console.log('Socket状态:', socket ? 'initialized' : 'not initialized');
    console.log('Socket连接状态:', socket ? (socket.connected ? 'connected' : 'disconnected') : 'N/A');
    
    if (!socket) {
        console.error('Socket 未初始化');
        showModal('连接错误', 'Socket连接未初始化，请稍后重试', '知道了');
        return;
    }
    
    if (!socket.connected) {
        console.error('Socket 未连接');
        showModal('连接错误', 'Socket未连接到服务器，请稍后重试', '知道了');
        return;
    }
    
    // 清理之前的监听器
    socket.off('peer-joined');
    
    // 准备文件信息
    const fileInfo = {
        name: selectedFile?.name || 'unknown',
        size: selectedFile?.size || 0,
        type: selectedFile?.type || 'unknown'
    };
    
    console.log('发送create-room请求...');
    socket.emit('create-room', fileInfo, async (response) => {
        console.log('房间已创建:', response);
        currentRoomId = response.roomId;
        document.getElementById('shareKey').value = response.roomId;
        document.getElementById('shareInfo').classList.remove('hidden');
        
        // 显示网络信息
        if (response.hostIP) {
            console.log('主机IP:', response.hostIP);
        }
        
        // 检查是否有未完成的传输
        const canResume = await checkResumeTransfer(currentRoomId, fileInfo.name, fileInfo.size);
        if (canResume) {
            console.log('将恢复之前的传输');
        }
        
        // 等待对方加入
        socket.on('peer-joined', (peerId) => {
            console.log('对等端已加入:', peerId);
            initiatePeerConnection(true);
        });
    });
}

// 复制密钥
function copyKey() {
    const keyInput = document.getElementById('shareKey');
    keyInput.select();
    document.execCommand('copy');
    
    const button = event.target;
    const originalText = button.textContent;
    button.textContent = '已复制！';
    setTimeout(() => {
        button.textContent = originalText;
    }, 2000);
}

// 连接到对等端
async function connectToPeer() {
    if (!socket) {
        console.error('Socket 未初始化');
        return;
    }
    
    const roomId = document.getElementById('receiveKey').value.toUpperCase();
    if (roomId.length !== 6) {
        showModal('输入错误', '请输入6位密钥', '知道了');
        return;
    }
    
    socket.emit('join-room', roomId, async (response) => {
        console.log('加入房间响应:', response);
        if (response.success) {
            currentRoomId = roomId;
            
            if (response.selfTransfer) {
                console.log('检测到自发自收，开始本地传输');
                handleSelfTransfer();
            } else {
                console.log('成功加入房间，传输模式:', response.transferMode);
                
                // 保存传输模式
                if (response.transferMode) {
                    transferMode = response.transferMode.mode;
                }
                
                // 检查是否有未完成的传输（需要文件信息）
                if (response.fileInfo) {
                    const canResume = await checkResumeTransfer(roomId, response.fileInfo.name, response.fileInfo.size);
                    if (canResume) {
                        console.log('将恢复之前的传输');
                        window.receivedFileName = response.fileInfo.name;
                        window.receivedFileSize = response.fileInfo.size;
                    }
                }
                
                // 根据传输模式初始化连接
                if (transferMode === 'server-relay') {
                    // 服务器中继模式不需要建立P2P连接
                    console.log('使用服务器中继模式，等待文件传输');
                    setupRelayReceiver();
                } else {
                    // P2P模式
                    console.log('使用P2P模式，开始建立连接');
                    initiatePeerConnection(false);
                }
            }
        } else {
            showModal('连接失败', response.message, '知道了');
        }
    });
}

// 初始化对等连接
function initiatePeerConnection(initiator) {
    if (typeof SimplePeer === 'undefined') {
        console.error('SimplePeer 不可用');
        return;
    }
    
    // 如果已有peer连接，先销毁
    if (peer) {
        try {
            peer.destroy();
        } catch (e) {
            console.log('销毁旧peer连接时出错:', e.message);
        }
        peer = null;
    }
    
    // 清理socket的signal监听器
    if (socket) {
        socket.off('signal');
    }
    
    console.log('创建新的P2P连接，initiator:', initiator);
    
    // 使用配置文件中的 ICE 服务器
    let iceServers = networkConfig?.config?.iceServers || [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stunserver2025.stunprotocol.org' },
        // Cloudflare TURN 服务器 (默认配置)
        {
            urls: 'turn:turn.cloudflare.com:3478',
            username: 'optional',
            credential: 'optional'
        },
        {
            urls: 'turn:turn.cloudflare.com:3478?transport=tcp',
            username: 'optional',
            credential: 'optional'
        },
        {
            urls: 'turn:turn.cloudflare.com:53?transport=udp',
            username: 'optional',
            credential: 'optional'
        },
        {
            urls: 'turn:turn.cloudflare.com:80?transport=tcp',
            username: 'optional',
            credential: 'optional'
        }
    ];
    
    // 根据配置决定是否使用 TURN 服务器
    const enableTURN = networkConfig?.config?.webrtc?.enableTURN !== false; // 默认启用
    if (!enableTURN) {
        iceServers = iceServers.filter(server => !server.urls.startsWith('turn:'));
        console.log('TURN 服务器已禁用，仅使用 STUN 服务器');
    }
    
    console.log('使用 ICE 服务器:', iceServers);
    
    peer = new SimplePeer({
        initiator: initiator,
        trickle: false,
        config: {
            iceServers: iceServers
        }
    });
    
    peer.on('signal', (signal) => {
        console.log('发送信令数据:', signal);
        socket.emit('signal', {
            signal: signal
        });
    });
    
    socket.on('signal', (data) => {
        console.log('接收到信令数据:', data);
        peer.signal(data.signal);
    });
    
    peer.on('connect', () => {
        console.log('P2P连接已建立');
        showModal('连接成功', '已成功建立P2P连接！', '知道了');
        if (currentMode === 'send') {
            sendFile();
        }
    });
    
    peer.on('data', (data) => {
        console.log('接收到数据:', data.length, '字节');
        if (currentMode === 'receive') {
            handleReceivedData(data);
        }
    });
    
    peer.on('error', (err) => {
        console.error('P2P连接错误:', err);
        showModal('连接错误', '连接失败: ' + err.message, '知道了');
    });
}

// 发送文件
async function sendFile() {
    document.getElementById('sendProgress').classList.remove('hidden');
    startTime = Date.now();
    
    // 生成传输ID
    if (!currentTransferId) {
        currentTransferId = generateTransferId(currentRoomId, selectedFile.name, selectedFile.size);
    }
    
    // 根据传输模式选择发送方式
    if (transferMode === 'server-relay') {
        await sendFileViaRelay();
    } else {
        await sendFileViaP2P();
    }
}

// 通过P2P发送文件
async function sendFileViaP2P() {
    // 读取文件
    if (selectedFile.path) {
        // Electron文件选择
        const arrayBuffer = await window.electronAPI.readFile(selectedFile.path);
        fileBuffer = new Uint8Array(arrayBuffer);
    } else {
        // 拖拽文件
        const arrayBuffer = await selectedFile.file.arrayBuffer();
        fileBuffer = new Uint8Array(arrayBuffer);
    }
    
    const chunkSize = networkConfig?.transfer?.chunkSize || 64 * 1024;
    totalChunks = Math.ceil(selectedFile.size / chunkSize);
    
    // 检查是否需要恢复传输
    let startChunk = 0;
    if (isResumingTransfer && transferProgress) {
        startChunk = transferProgress.chunkIndex || 0;
        console.log('恢复传输，从块', startChunk, '开始');
    }
    
    // 发送文件元信息
    const metadata = {
        type: 'metadata',
        name: selectedFile.name,
        size: selectedFile.size,
        chunks: totalChunks,
        resumeFrom: startChunk,
        transferId: currentTransferId
    };
    peer.send(JSON.stringify(metadata));
    
    // 分块发送文件
    let offset = startChunk * chunkSize;
    let chunkIndex = startChunk;
    
    console.log('开始P2P发送文件，总大小:', fileBuffer.length, '字节，总块数:', totalChunks, '，从块', startChunk, '开始');
    
    while (offset < fileBuffer.length) {
        const chunk = fileBuffer.slice(offset, offset + chunkSize);
        
        try {
            peer.send(chunk);
            
            offset += chunkSize;
            chunkIndex++;
            
            // 更新进度
            const progress = Math.min((offset / fileBuffer.length) * 100, 100);
            console.log(`发送进度: ${Math.round(progress)}% (${chunkIndex}/${totalChunks})`);
            updateSendProgress(progress, Math.min(offset, fileBuffer.length));
            
            // 保存进度
            await saveTransferProgress(chunkIndex, totalChunks);
            
            // 给接收方一些处理时间
            await new Promise(resolve => setTimeout(resolve, 10));
        } catch (error) {
            console.error('发送块失败:', error);
            // 如果发送失败，等待重连
            if (networkConfig?.reconnect?.enabled) {
                showModal('传输中断', '连接已断开，正在尝试重连...', '知道了');
                return;
            }
            break;
        }
    }
    
    console.log('文件发送完成，共发送', chunkIndex - startChunk, '个块');
}

// 恢复发送文件
async function resumeSendFile() {
    console.log('恢复发送文件');
    
    if (!fileBuffer && selectedFile) {
        // 重新读取文件
        if (selectedFile.path) {
            const arrayBuffer = await window.electronAPI.readFile(selectedFile.path);
            fileBuffer = new Uint8Array(arrayBuffer);
        } else {
            showModal('恢复失败', '无法重新读取文件，请重新选择文件', '知道了');
            return;
        }
    }
    
    // 从上次中断的位置继续
    if (transferProgress) {
        const chunkSize = networkConfig?.transfer?.chunkSize || 64 * 1024;
        const startChunk = transferProgress.chunkIndex || 0;
        let offset = startChunk * chunkSize;
        let chunkIndex = startChunk;
        
        console.log('从块', startChunk, '恢复发送');
        
        // 继续发送
        while (offset < fileBuffer.length) {
            const chunk = fileBuffer.slice(offset, offset + chunkSize);
            
            try {
                if (transferMode === 'server-relay') {
                    // 服务器中继模式
                    const base64Chunk = btoa(String.fromCharCode.apply(null, chunk));
                    socket.emit('relay-chunk', {
                        roomId: currentRoomId,
                        chunkIndex: chunkIndex,
                        chunk: base64Chunk,
                        metadata: {
                            totalChunks: totalChunks,
                            currentChunk: chunkIndex,
                            transferId: currentTransferId
                        }
                    });
                } else if (peer && peer.connected) {
                    // P2P模式
                    peer.send(chunk);
                } else {
                    throw new Error('连接未就绪');
                }
                
                offset += chunkSize;
                chunkIndex++;
                
                // 更新进度
                const progress = Math.min((offset / fileBuffer.length) * 100, 100);
                updateSendProgress(progress, Math.min(offset, fileBuffer.length));
                
                // 保存进度
                await saveTransferProgress(chunkIndex, totalChunks);
                
                await new Promise(resolve => setTimeout(resolve, transferMode === 'server-relay' ? 50 : 10));
            } catch (error) {
                console.error('恢复发送失败:', error);
                return;
            }
        }
    }
}

// 通过服务器中继发送文件
async function sendFileViaRelay() {
    console.log('使用服务器中继模式发送文件');
    
    // 读取文件
    let fileData;
    if (selectedFile.path) {
        const arrayBuffer = await window.electronAPI.readFile(selectedFile.path);
        fileData = new Uint8Array(arrayBuffer);
    } else {
        const arrayBuffer = await selectedFile.file.arrayBuffer();
        fileData = new Uint8Array(arrayBuffer);
    }
    
    // 使用更大的块进行中继传输
    const chunkSize = networkConfig?.config?.transfer?.relayChunkSize || 1024 * 1024; // 默认1MB
    const totalChunks = Math.ceil(fileData.length / chunkSize);
    
    console.log(`开始中继传输，文件大小: ${fileData.length}，块大小: ${chunkSize}，总块数: ${totalChunks}`);
    
    // 首先发送元数据
    socket.emit('relay-chunk', {
        roomId: currentRoomId,
        chunkIndex: -1, // 特殊索引表示元数据
        chunk: JSON.stringify({
            name: selectedFile.name,
            size: selectedFile.size,
            totalChunks: totalChunks,
            chunkSize: chunkSize
        }),
        metadata: {
            totalChunks: totalChunks,
            isMetadata: true
        }
    });
    
    // 分块发送
    for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, fileData.length);
        const chunk = fileData.slice(start, end);
        
        // 转换为base64以便通过JSON传输
        const base64Chunk = btoa(String.fromCharCode.apply(null, chunk));
        
        socket.emit('relay-chunk', {
            roomId: currentRoomId,
            chunkIndex: i,
            chunk: base64Chunk,
            metadata: {
                totalChunks: totalChunks,
                currentChunk: i
            }
        });
        
        // 更新进度
        const progress = ((i + 1) / totalChunks) * 100;
        updateSendProgress(progress, end);
        
        // 控制发送速度，避免占用过多带宽
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    console.log('中继传输完成');
}

// 更新发送进度
function updateSendProgress(progress, bytesSent) {
    document.getElementById('sendProgressBar').style.width = progress + '%';
    document.getElementById('sendProgressText').textContent = Math.round(progress) + '%';
    document.getElementById('sendSpeedText').textContent = '传输速度: ' + calculateSpeed(bytesSent, startTime);
    
    if (progress >= 100) {
        setTimeout(() => {
            showModal('发送完成', '文件发送完成！', '知道了');
            
            // 保存传输记录
            saveTransferRecord({
                type: 'sent',
                fileName: selectedFile.name,
                fileSize: selectedFile.size,
                status: 'success',
                timestamp: new Date().toISOString(),
                duration: Math.round((Date.now() - startTime) / 1000)
            });
            
            // 通知服务器文件传输完成
            if (socket) {
                socket.emit('file-transfer-complete', { role: 'sender' });
            }
            
            // 延迟重置UI状态
            setTimeout(() => {
                resetUIAfterTransfer();
            }, 3000);
        }, 500);
    }
}

// 处理接收到的数据
function handleReceivedData(data) {
    console.log('收到数据类型:', typeof data, '是否为Uint8Array:', data instanceof Uint8Array);
    
    // 首先尝试解析为字符串（元数据）
    try {
        let dataStr;
        if (typeof data === 'string') {
            dataStr = data;
        } else if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
            dataStr = new TextDecoder().decode(data);
        } else {
            dataStr = data.toString();
        }
        
        console.log('尝试解析数据为JSON:', dataStr.substring(0, 100));
        const metadata = JSON.parse(dataStr);
        
        if (metadata.type === 'metadata') {
            console.log('收到元数据:', metadata);
            handleFileMetadata(metadata);
            return;
        }
    } catch (e) {
        // 不是JSON，继续作为文件数据处理
        console.log('不是JSON数据，作为文件块处理');
    }
    
    // 作为文件块数据处理
    if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
        receivedChunks.push(data);
        receivedSize += data.byteLength || data.length;
        
        console.log(`接收块 ${receivedChunks.length}/${totalChunks}, 大小: ${data.byteLength || data.length} 字节`);
        
        if (totalChunks > 0) {
            const progress = (receivedChunks.length / totalChunks) * 100;
            updateReceiveProgress(progress);
        }
        
        // 检查是否接收完成
        if (receivedChunks.length === totalChunks && totalChunks > 0) {
            console.log('文件接收完成（基于总块数），开始保存');
            saveReceivedFile();
        } else if (totalChunks === 0 && receivedChunks.length > 0) {
            // 如果没有元数据，等待一段时间后尝试保存
            console.log('没有元数据信息，2秒后尝试保存文件');
            setTimeout(() => {
                if (receivedChunks.length > 0 && totalChunks === 0) {
                    window.receivedFileName = window.receivedFileName || 'received_file';
                    console.log('超时保存文件');
                    // 显示手动保存按钮
                    const manualSaveBtn = document.getElementById('manualSaveBtn');
                    if (manualSaveBtn) {
                        manualSaveBtn.style.display = 'block';
                    }
                    saveReceivedFile();
                }
            }, 2000);
        }
    } else {
        console.warn('未知数据类型:', typeof data);
    }
}

// 处理文件元数据
function handleFileMetadata(metadata) {
    totalChunks = metadata.chunks;
    startTime = Date.now();
    
    console.log('开始接收文件:', metadata.name, '大小:', metadata.size, '字节，总块数:', totalChunks);
    
    // 如果有传输ID，使用发送方的ID
    if (metadata.transferId) {
        currentTransferId = metadata.transferId;
    } else {
        // 生成传输ID
        currentTransferId = generateTransferId(currentRoomId, metadata.name, metadata.size);
    }
    
    // 检查是否需要恢复传输
    if (metadata.resumeFrom > 0) {
        console.log('发送方从块', metadata.resumeFrom, '恢复传输');
        // 调整已接收的块数
        if (receivedChunks.length < metadata.resumeFrom) {
            // 填充空块
            while (receivedChunks.length < metadata.resumeFrom) {
                receivedChunks.push(null);
            }
        }
    }
    
    document.getElementById('receivingFileName').textContent = metadata.name;
    document.getElementById('receiveProgress').classList.remove('hidden');
    
    // 保存文件名供后续使用
    window.receivedFileName = metadata.name;
    window.receivedFileSize = metadata.size;
}

// 更新接收进度
function updateReceiveProgress(progress) {
    document.getElementById('receiveProgressBar').style.width = progress + '%';
    document.getElementById('receiveProgressText').textContent = Math.round(progress) + '%';
    document.getElementById('receiveSpeedText').textContent = '传输速度: ' + calculateSpeed(receivedSize, startTime);
    
    // 保存进度
    if (totalChunks > 0) {
        saveTransferProgress(receivedChunks.length, totalChunks);
    }
}

// 保存接收到的文件
async function saveReceivedFile() {
    console.log('开始保存文件，文件名:', window.receivedFileName);
    
    if (!window.receivedFileName) {
        showModal('保存失败', '文件名未设置，无法保存', '知道了');
        return;
    }
    
    if (receivedChunks.length === 0) {
        showModal('保存失败', '没有接收到文件数据', '知道了');
        return;
    }
    
    try {
        // 计算总大小
        const totalSize = receivedChunks.reduce((total, chunk) => {
            return total + (chunk.byteLength || chunk.length);
        }, 0);
        
        console.log('合并文件块，总大小:', totalSize);
        
        // 合并所有块
        const fileBuffer = new Uint8Array(totalSize);
        let offset = 0;
        
        for (const chunk of receivedChunks) {
            if (chunk instanceof Uint8Array) {
                fileBuffer.set(chunk, offset);
                offset += chunk.length;
            } else if (chunk instanceof ArrayBuffer) {
                fileBuffer.set(new Uint8Array(chunk), offset);
                offset += chunk.byteLength;
            }
        }
        
        console.log('选择保存位置...');
        const savePath = await window.electronAPI.selectSaveLocation(window.receivedFileName);
        
        if (savePath) {
            console.log('保存文件到:', savePath);
            await window.electronAPI.saveFile(savePath, Array.from(fileBuffer));
            
            showModal('接收完成', '文件接收完成！已保存到: ' + savePath, '知道了');
            
            // 保存传输记录
            saveTransferRecord({
                type: 'received',
                fileName: window.receivedFileName,
                fileSize: totalSize,
                status: 'success',
                timestamp: new Date().toISOString(),
                duration: startTime ? Math.round((Date.now() - startTime) / 1000) : 0,
                savePath: savePath
            });
            
            // 通知服务器文件传输完成
            if (socket) {
                socket.emit('file-transfer-complete', { role: 'receiver' });
            }
            
            // 延迟重置UI状态
            setTimeout(() => {
                resetUIAfterTransfer();
            }, 3000);
            
            // 重置状态
            receivedChunks = [];
            totalChunks = 0;
            receivedSize = 0;
        } else {
            console.log('用户取消了保存操作');
        }
    } catch (error) {
        console.error('保存文件失败:', error);
        showModal('保存失败', '保存文件失败: ' + error.message, '知道了');
    }
}

// 弹窗相关函数
function showModal(title, message, primaryBtnText = '确定', secondaryBtnText = null, primaryCallback = null, secondaryCallback = null) {
    const modalOverlay = document.getElementById('modalOverlay');
    const modalTitle = document.getElementById('modalTitle');
    const modalMessage = document.getElementById('modalMessage');
    const modalPrimaryBtn = document.getElementById('modalPrimaryBtn');
    const modalSecondaryBtn = document.getElementById('modalSecondaryBtn');

    modalTitle.textContent = title;
    modalMessage.textContent = message;
    modalPrimaryBtn.textContent = primaryBtnText;

    // 设置主按钮回调
    modalPrimaryBtn.onclick = () => {
        if (primaryCallback) {
            primaryCallback();
        }
        closeModal();
    };

    // 处理次要按钮
    if (secondaryBtnText) {
        modalSecondaryBtn.textContent = secondaryBtnText;
        modalSecondaryBtn.style.display = 'inline-block';
        modalSecondaryBtn.onclick = () => {
            if (secondaryCallback) {
                secondaryCallback();
            }
            closeModal();
        };
    } else {
        modalSecondaryBtn.style.display = 'none';
    }

    modalOverlay.classList.add('show');
}

function closeModal() {
    const modalOverlay = document.getElementById('modalOverlay');
    modalOverlay.classList.remove('show');
}

// 测试弹窗函数
function testModal() {
    showModal('检查更新', '您当前使用的应用是最新版本', '知道了');
}

// 将测试函数暴露到全局
window.testModal = testModal;

// 加载网络配置
async function loadNetworkConfig() {
    try {
        if (window.electronAPI && window.electronAPI.getNetworkConfig) {
            networkConfig = await window.electronAPI.getNetworkConfig();
            console.log('网络配置已加载:', networkConfig);
        }
    } catch (error) {
        console.error('加载网络配置失败:', error);
    }
}

// 显示传输模式信息
function showTransferModeInfo(data) {
    let title, message;
    
    switch (data.mode) {
        case 'direct-p2p':
            title = '局域网直连';
            message = '检测到您与对方在同一局域网，将使用最快的直连模式传输文件。';
            break;
            
        case 'webrtc-p2p':
            title = 'P2P传输';
            message = '正在尝试建立P2P连接，文件将直接在您和对方之间传输。';
            break;
            
        case 'server-relay':
            title = '服务器中继';
            message = '由于网络限制或文件较大，将通过服务器中继传输。传输速度可能会受到一定影响。';
            break;
            
        default:
            return;
    }
    
    // 可以在UI上显示传输模式
    console.log(`传输模式: ${title} - ${message}`);
    
    // 可选：显示一个简短的提示
    if (data.mode === 'server-relay') {
        showModal('传输模式', message, '知道了');
    }
}

// 传输记录相关函数
async function saveTransferRecord(record) {
    try {
        if (window.electronAPI && window.electronAPI.saveTransferRecord) {
            const result = await window.electronAPI.saveTransferRecord(record);
            if (result.success) {
                console.log('传输记录已保存:', record);
            } else {
                console.error('保存传输记录失败:', result.error);
            }
        }
    } catch (error) {
        console.error('保存传输记录时出错:', error);
    }
}

async function loadTransferHistory() {
    const historyLoading = document.getElementById('historyLoading');
    const historyEmpty = document.getElementById('historyEmpty');
    const historyList = document.getElementById('historyList');
    
    // 显示加载状态
    historyLoading.classList.remove('hidden');
    historyEmpty.classList.add('hidden');
    historyList.classList.add('hidden');
    
    try {
        if (window.electronAPI && window.electronAPI.getTransferRecords) {
            const records = await window.electronAPI.getTransferRecords();
            
            setTimeout(() => {
                historyLoading.classList.add('hidden');
                
                if (records.length === 0) {
                    historyEmpty.classList.remove('hidden');
                } else {
                    historyList.classList.remove('hidden');
                    renderTransferHistory(records);
                }
            }, 500); // 添加短暂延迟以显示加载动画
        }
    } catch (error) {
        console.error('加载传输记录失败:', error);
        historyLoading.classList.add('hidden');
        historyEmpty.classList.remove('hidden');
    }
}

function renderTransferHistory(records) {
    const historyList = document.getElementById('historyList');
    
    historyList.innerHTML = records.map(record => createHistoryItemHTML(record)).join('');
}

function createHistoryItemHTML(record) {
    const typeIcon = record.type === 'sent' ? 'upload' : 'download';
    const typeText = window.i18n ? window.i18n.t(`history.item.${record.type}`) : (record.type === 'sent' ? '发送' : '接收');
    const typeClass = record.type === 'sent' ? 'sent' : 'received';
    const statusClass = record.status === 'success' ? 'success' : 'failed';
    const statusText = window.i18n ? window.i18n.t(`history.item.${record.status}`) : (record.status === 'success' ? '成功' : '失败');
    
    const date = new Date(record.timestamp);
    const formattedDate = date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    const duration = record.duration ? `${record.duration}${window.i18n ? window.i18n.t('history.item.seconds') : '秒'}` : (window.i18n ? window.i18n.t('history.item.unknown') : '未知');
    const fileSize = formatFileSize(record.fileSize || 0);
    
    const fileNameLabel = window.i18n ? window.i18n.t('history.item.fileName') : '文件名';
    const fileSizeLabel = window.i18n ? window.i18n.t('history.item.fileSize') : '文件大小';
    const durationLabel = window.i18n ? window.i18n.t('history.item.duration') : '传输时长';
    const saveLocationLabel = window.i18n ? window.i18n.t('history.item.saveLocation') : '保存位置';
    const openLocationText = window.i18n ? window.i18n.t('history.item.openLocation') : '打开位置';
    const unknownFile = window.i18n ? window.i18n.t('history.item.unknownFile') : '未知文件';
    
    return `
        <div class="history-item">
            <div class="history-item-header">
                <div class="history-item-type ${typeClass}">
                    <i class="bi bi-${typeIcon}"></i>
                    ${typeText}
                </div>
                <div class="history-item-status ${statusClass}">
                    ${statusText}
                </div>
            </div>
            
            <div class="history-item-info">
                <div class="history-info-item">
                    <div class="history-info-label">${fileNameLabel}</div>
                    <div class="history-info-value">${record.fileName || unknownFile}</div>
                </div>
                <div class="history-info-item">
                    <div class="history-info-label">${fileSizeLabel}</div>
                    <div class="history-info-value">${fileSize}</div>
                </div>
                <div class="history-info-item">
                    <div class="history-info-label">${durationLabel}</div>
                    <div class="history-info-value">${duration}</div>
                </div>
                ${record.savePath ? `
                <div class="history-info-item">
                    <div class="history-info-label">${saveLocationLabel}</div>
                    <div class="history-info-value" title="${record.savePath}">${getFileName(record.savePath)}</div>
                </div>
                ` : ''}
            </div>
            
            <div class="history-item-footer">
                <div class="history-item-time">
                    ${formattedDate}
                </div>
                <div class="history-item-actions">
                    ${record.savePath ? `
                    <button class="history-action-btn" onclick="openFileLocation('${record.savePath.replace(/\\/g, '\\\\')}')">
                        <i class="bi bi-folder2-open"></i>
                        ${openLocationText}
                    </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
}

function getFileName(path) {
    return path.split(/[\\/]/).pop();
}

async function openFileLocation(filePath) {
    try {
        if (window.electronAPI && window.electronAPI.showItemInFolder) {
            const result = await window.electronAPI.showItemInFolder(filePath);
            if (!result.success) {
                showModal('错误', '无法打开文件位置: ' + result.error, '知道了');
            }
        } else {
            showModal('错误', '系统不支持此功能', '知道了');
        }
    } catch (error) {
        console.error('无法打开文件位置:', error);
        showModal('错误', '无法打开文件位置', '知道了');
    }
}

async function refreshHistory() {
    console.log('刷新传输记录...');
    await loadTransferHistory();
}

async function clearHistory() {
    const title = window.i18n ? window.i18n.t('modal.confirmClear.title') : '确认清空';
    const message = window.i18n ? window.i18n.t('modal.confirmClear.message') : '确定要清空所有传输记录吗？此操作不可撤销。';
    const confirmText = window.i18n ? window.i18n.t('modal.confirmClear.confirm') : '确定清空';
    const cancelText = window.i18n ? window.i18n.t('modal.confirmClear.cancel') : '取消';
    
    showModal(
        title, 
        message, 
        confirmText, 
        cancelText,
        async () => {
            try {
                if (window.electronAPI && window.electronAPI.clearTransferRecords) {
                    const result = await window.electronAPI.clearTransferRecords();
                    if (result.success) {
                        const successTitle = window.i18n ? window.i18n.t('modal.clearSuccess.title') : '清空成功';
                        const successMessage = window.i18n ? window.i18n.t('modal.clearSuccess.message') : '传输记录已全部清空';
                        const okText = window.i18n ? window.i18n.t('modal.ok') : '知道了';
                        showModal(successTitle, successMessage, okText);
                        await loadTransferHistory(); // 重新加载空的记录列表
                    } else {
                        const failTitle = window.i18n ? window.i18n.t('modal.clearFailed.title') : '清空失败';
                        const failMessage = window.i18n ? window.i18n.t('modal.clearFailed.message') : '清空记录时出现错误';
                        const okText = window.i18n ? window.i18n.t('modal.ok') : '知道了';
                        showModal(failTitle, `${failMessage}: ${result.error}`, okText);
                    }
                }
            } catch (error) {
                console.error('清空记录失败:', error);
                const failTitle = window.i18n ? window.i18n.t('modal.clearFailed.title') : '清空失败';
                const failMessage = window.i18n ? window.i18n.t('modal.clearFailed.message') : '清空记录时出现错误';
                const okText = window.i18n ? window.i18n.t('modal.ok') : '知道了';
                showModal(failTitle, failMessage, okText);
            }
        }
    );
}

// 处理自发自收的本地传输
async function handleSelfTransfer() {
    try {
        // 显示连接成功提示
        showModal('连接成功', '已成功建立本地传输连接！', '知道了');
        
        // 检查是否有选中的文件用于传输
        const transferFile = currentTransferFile || selectedFile;
        if (!transferFile) {
            showModal('传输错误', '没有可传输的文件', '知道了');
            return;
        }
        
        // 显示接收进度界面
        document.getElementById('receivingFileName').textContent = transferFile.name;
        document.getElementById('receiveProgress').classList.remove('hidden');
        
        console.log('开始自发自收传输:', transferFile.name);
        
        // 模拟传输进度
        startTime = Date.now();
        let progress = 0;
        const totalSize = transferFile.size;
        
        const progressInterval = setInterval(() => {
            progress += Math.random() * 20; // 随机增加进度
            if (progress >= 100) {
                progress = 100;
                clearInterval(progressInterval);
                
                // 完成传输，开始保存文件
                setTimeout(async () => {
                    await handleSelfTransferComplete();
                }, 500);
            }
            
            // 更新进度显示
            document.getElementById('receiveProgressBar').style.width = progress + '%';
            document.getElementById('receiveProgressText').textContent = Math.round(progress) + '%';
            document.getElementById('receiveSpeedText').textContent = '传输速度: ' + calculateSpeed(
                (progress / 100) * totalSize, 
                startTime
            );
        }, 200);
        
    } catch (error) {
        console.error('自发自收传输失败:', error);
        showModal('传输失败', '本地传输失败: ' + error.message, '知道了');
    }
}

// 完成自发自收传输
async function handleSelfTransferComplete() {
    try {
        const transferFile = currentTransferFile || selectedFile;
        if (!transferFile) {
            showModal('传输错误', '文件信息丢失', '知道了');
            return;
        }
        
        // 选择保存位置
        const savePath = await window.electronAPI.selectSaveLocation(transferFile.name);
        
        if (savePath) {
            // 读取原文件并保存到新位置
            let fileData;
            if (transferFile.path) {
                // Electron文件选择
                const arrayBuffer = await window.electronAPI.readFile(transferFile.path);
                fileData = new Uint8Array(arrayBuffer);
            } else {
                // 拖拽文件
                const arrayBuffer = await transferFile.file.arrayBuffer();
                fileData = new Uint8Array(arrayBuffer);
            }
            
            // 保存文件
            await window.electronAPI.saveFile(savePath, Array.from(fileData));
            
            showModal('传输完成', '文件传输完成！已保存到: ' + savePath, '知道了');
            
            // 保存传输记录（发送记录）
            saveTransferRecord({
                type: 'sent',
                fileName: transferFile.name,
                fileSize: transferFile.size,
                status: 'success',
                timestamp: new Date().toISOString(),
                duration: Math.round((Date.now() - startTime) / 1000)
            });
            
            // 保存传输记录（接收记录）
            saveTransferRecord({
                type: 'received',
                fileName: transferFile.name,
                fileSize: transferFile.size,
                status: 'success',
                timestamp: new Date().toISOString(),
                duration: Math.round((Date.now() - startTime) / 1000),
                savePath: savePath
            });
            
            // 通知服务器文件传输完成
            if (socket) {
                socket.emit('file-transfer-complete', { role: 'sender' });
                socket.emit('file-transfer-complete', { role: 'receiver' });
            }
            
            // 清理状态并重置UI
            setTimeout(() => {
                resetUIAfterTransfer();
            }, 2000);
            
        } else {
            console.log('用户取消了保存操作');
        }
    } catch (error) {
        console.error('保存文件失败:', error);
        showModal('保存失败', '保存文件失败: ' + error.message, '知道了');
    }
}

// 设置中继接收器
function setupRelayReceiver() {
    console.log('设置服务器中继接收器');
    
    let relayMetadata = null;
    let relayChunks = {};
    let receivedRelayChunks = 0;
    
    // 监听中继块接收事件
    socket.on('relay-chunk-received', (data) => {
        console.log(`收到中继块通知 ${data.chunkIndex}/${data.totalChunks}`);
        
        // 请求具体的块数据
        socket.emit('request-relay-chunk', {
            roomId: currentRoomId,
            chunkIndex: data.chunkIndex
        });
    });
    
    // 接收中继块数据
    socket.on('relay-chunk-data', (data) => {
        const { chunkIndex, chunk } = data;
        
        if (chunkIndex === -1) {
            // 元数据
            relayMetadata = JSON.parse(chunk);
            console.log('收到文件元数据:', relayMetadata);
            
            // 显示接收进度
            document.getElementById('receivingFileName').textContent = relayMetadata.name;
            document.getElementById('receiveProgress').classList.remove('hidden');
            
            startTime = Date.now();
        } else {
            // 文件块数据
            relayChunks[chunkIndex] = chunk;
            receivedRelayChunks++;
            
            // 更新进度
            const progress = (receivedRelayChunks / relayMetadata.totalChunks) * 100;
            updateReceiveProgress(progress);
            
            // 检查是否接收完成
            if (receivedRelayChunks === relayMetadata.totalChunks) {
                console.log('中继接收完成，开始保存文件');
                saveRelayFile(relayMetadata, relayChunks);
            }
        }
    });
    
    // 处理错误
    socket.on('relay-chunk-error', (data) => {
        console.error('中继块错误:', data);
        showModal('传输错误', '文件块传输失败: ' + data.error, '知道了');
    });
}

// 保存中继接收的文件
async function saveRelayFile(metadata, chunks) {
    try {
        // 按顺序组合所有块
        const sortedChunks = [];
        for (let i = 0; i < metadata.totalChunks; i++) {
            if (!chunks[i]) {
                throw new Error(`缺少文件块 ${i}`);
            }
            // 从base64解码
            const binaryString = atob(chunks[i]);
            const bytes = new Uint8Array(binaryString.length);
            for (let j = 0; j < binaryString.length; j++) {
                bytes[j] = binaryString.charCodeAt(j);
            }
            sortedChunks.push(bytes);
        }
        
        // 合并所有块
        const totalSize = sortedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const fileData = new Uint8Array(totalSize);
        let offset = 0;
        
        for (const chunk of sortedChunks) {
            fileData.set(chunk, offset);
            offset += chunk.length;
        }
        
        // 选择保存位置
        const savePath = await window.electronAPI.selectSaveLocation(metadata.name);
        
        if (savePath) {
            // 保存文件
            await window.electronAPI.saveFile(savePath, Array.from(fileData));
            
            showModal('接收完成', '文件接收完成！已保存到: ' + savePath, '知道了');
            
            // 保存传输记录
            saveTransferRecord({
                type: 'received',
                fileName: metadata.name,
                fileSize: metadata.size,
                status: 'success',
                timestamp: new Date().toISOString(),
                duration: startTime ? Math.round((Date.now() - startTime) / 1000) : 0,
                savePath: savePath
            });
            
            // 通知服务器文件传输完成
            if (socket) {
                socket.emit('file-transfer-complete', { role: 'receiver' });
            }
            
            // 延迟重置UI状态
            setTimeout(() => {
                resetUIAfterTransfer();
            }, 3000);
        }
    } catch (error) {
        console.error('保存中继文件失败:', error);
        showModal('保存失败', '保存文件失败: ' + error.message, '知道了');
    }
}

// 重置传输完成后的UI状态
function resetUIAfterTransfer() {
    console.log('重置传输完成后的UI状态');
    
    // 隐藏所有进度和信息元素
    const elementsToHide = [
        'fileInfo', 'shareInfo', 'sendProgress', 'receiveProgress'
    ];
    elementsToHide.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.classList.add('hidden');
        }
    });
    
    // 清空输入框
    const inputsToClean = ['shareKey', 'receiveKey'];
    inputsToClean.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.value = '';
        }
    });
    
    // 重置全局变量
    selectedFile = null;
    currentTransferFile = null;
    fileBuffer = null;
    receivedChunks = [];
    totalChunks = 0;
    receivedSize = 0;
    startTime = null;
    window.receivedFileName = null;
    
    // 清理peer连接
    if (peer) {
        try {
            peer.destroy();
        } catch (e) {
            console.log('销毁peer连接时出错:', e.message);
        }
        peer = null;
    }
    
    // 清理socket事件监听器
    if (socket) {
        socket.off('peer-joined');
        socket.off('signal');
    }
    
    console.log('UI状态重置完成');
    
    // 自动返回首页
    setTimeout(() => {
        showSection('home');
    }, 500);
}

// 恢复接收文件
async function resumeReceiveFile() {
    console.log('恢复接收文件');
    
    if (transferProgress) {
        // 恢复已接收的块数
        const resumeChunks = transferProgress.chunkIndex || 0;
        console.log('已接收', resumeChunks, '块，等待继续接收');
        
        // 确保数组大小正确
        while (receivedChunks.length < resumeChunks) {
            receivedChunks.push(null);
        }
        
        // 更新进度显示
        if (totalChunks > 0) {
            const progress = (resumeChunks / totalChunks) * 100;
            updateReceiveProgress(progress);
        }
        
        // 如果是服务器中继模式，请求继续传输
        if (transferMode === 'server-relay') {
            socket.emit('resume-relay-transfer', {
                roomId: currentRoomId,
                transferId: currentTransferId,
                fromChunk: resumeChunks
            });
        }
    }
}

// 检查更新函数
function checkUpdate() {
    console.log('检查更新...');
    // 打开浏览器访问更新页面
    if (window.electronAPI && window.electronAPI.openExternal) {
        window.electronAPI.openExternal('https://kemushi.fog.moe');
    } else {
        // 如果Electron API不可用，使用window.open
        window.open('https://kemushi.fog.moe', '_blank');
    }
}

// 将函数暴露到全局作用域
window.checkUpdate = checkUpdate;

// 切换语言函数
async function changeLanguage(lang) {
    console.log('切换语言到:', lang);
    if (window.i18n) {
        await window.i18n.setLanguage(lang);
        
        // 更新动态生成的内容
        updateDynamicTexts();
        
        // 如果在历史记录页面，重新加载记录以更新文本
        if (document.getElementById('historySection').classList.contains('active')) {
            await loadTransferHistory();
        }
    }
}

// 更新动态生成的文本
function updateDynamicTexts() {
    // 更新所有showModal调用中的文本
    if (window.i18n) {
        // 监听语言变化，更新select的值
        const languageSelect = document.getElementById('languageSelect');
        if (languageSelect) {
            languageSelect.value = window.i18n.getCurrentLanguage();
        }
    }
}

// 暴露到全局
window.changeLanguage = changeLanguage;

 