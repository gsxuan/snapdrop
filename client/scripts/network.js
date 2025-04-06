window.URL = window.URL || window.webkitURL;
window.isRtcSupported = !!(window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection);

// 定义常量
const FILE_CHUNK_SIZE = 256 * 1024; // 固定块大小为256KB

// 尝试获取系统用户名或浏览器信息
function getUserInfo() {
    try {
        // 尝试获取系统用户名
        if (window.navigator && window.navigator.userAgentData && window.navigator.userAgentData.getHighEntropyValues) {
            return window.navigator.userAgentData.getHighEntropyValues(['platform', 'platformVersion', 'model'])
                .then(ua => {
                    return {
                        deviceName: ua.platform + ' ' + ua.platformVersion,
                        model: ua.model
                    };
                })
                .catch(err => {
                    console.log('无法获取高熵值:', err);
                    return null;
                });
        }
        
        // 尝试从localStorage获取用户设置的名称
        const savedName = localStorage.getItem('user-display-name');
        if (savedName) {
            return Promise.resolve({
                userName: savedName
            });
        }
    } catch (e) {
        console.log('获取用户信息时出错:', e);
    }
    
    return Promise.resolve(null);
}

class ServerConnection {

    constructor() {
        this._connect();
        Events.on('beforeunload', async e => this._disconnect());
        Events.on('pagehide', async e => this._disconnect());
        document.addEventListener('visibilitychange', e => this._onVisibilityChange());
        this._connectLossCount = 0;
        this._fileInfo = null;
        this._lastBinaryId = null;
        this.lastSendPeerId = null;
        this._selfId = null;
        
        // 监听用户名更新事件
        window.addEventListener('update-user-name', e => {
            if (this._isConnected()) {
                console.log(`正在向服务器发送用户名更新: ${e.detail}`);
                this.send({
                    type: 'user-info',
                    userName: e.detail,
                    updateName: true  // 添加标志，明确表示需要更新名称
                });
            } else {
                console.warn('无法发送用户名更新，WS连接尚未建立');
                // 尝试连接后再发送
                this._connect();
                setTimeout(() => {
                    if (this._isConnected()) {
                        console.log(`连接建立后发送用户名更新: ${e.detail}`);
                        this.send({
                            type: 'user-info',
                            userName: e.detail,
                            updateName: true  // 添加标志，明确表示需要更新名称
                        });
                    } else {
                        console.error('连接失败，无法发送用户名更新');
                        Events.fire('notify-user', {
                            message: '连接服务器失败，无法更新名称',
                            timeout: 3000
                        });
                    }
                }, 1000);
            }
        });
    }

    _connect() {
        clearTimeout(this._reconnectTimer);
        if (this._isConnected() || this._isConnecting()) return;
        
        const url = this._endpoint();
        console.log('连接到WS服务器:', url);
        
        // 获取用户信息
        getUserInfo().then(userInfo => {
            const ws = new WebSocket(url);
            ws.binaryType = 'arraybuffer';
            
            // 如果获取到了用户信息，添加到请求头中
            if (userInfo) {
                if (userInfo.userName) {
                    ws.userName = userInfo.userName;
                }
                if (userInfo.deviceName) {
                    ws.deviceName = userInfo.deviceName;
                }
            }
            
            const connectionTimeout = setTimeout(() => {
                if (ws.readyState !== WebSocket.OPEN) {
                    console.log('WS: 连接超时，关闭并重试');
                    ws.close();
                    this._reconnectTimer = setTimeout(() => this._connect(), 1000);
                }
            }, 5000);
            
            ws.onopen = e => {
                clearTimeout(connectionTimeout);
                console.log('WS: 服务器已连接');
                
                // 连接成功后发送用户信息
                if (userInfo) {
                    this.send({
                        type: 'user-info',
                        userName: userInfo.userName,
                        deviceName: userInfo.deviceName,
                        model: userInfo.model
                    });
                }
                
                this._startHeartbeat();
                
                // 清除倒计时计时器
                if (this._countdownTimer) {
                    clearInterval(this._countdownTimer);
                    this._countdownTimer = null;
                }
                
                // 清除断开连接通知，显示连接成功通知
                Events.fire('notify-user', {
                    message: '连接已恢复',
                    timeout: 3000,
                    type: 'clearAll',
                    id: 'connection-countdown' // 匹配断开通知的ID
                });
            };
            
            ws.onmessage = e => {
                this._resetHeartbeat();
                
                if (e.data instanceof ArrayBuffer) {
                    this._onBinaryData(e.data);
                } else {
                    this._onMessage(e.data);
                }
            };
            
            ws.onclose = e => {
                clearTimeout(connectionTimeout);
                this._stopHeartbeat();
                this._onDisconnect();
            };
            
            ws.onerror = e => {
                console.error('WS错误:', e);
                clearTimeout(connectionTimeout);
                this._stopHeartbeat();
            };
            
            this._socket = ws;
        });
    }

    _onMessage(msg) {
        msg = JSON.parse(msg);
        console.log('WS:', msg);
        switch (msg.type) {
            case 'peers':
                Events.fire('peers', msg.peers);
                break;
            case 'peer-joined':
                Events.fire('peer-joined', msg.peer);
                break;
            case 'peer-left':
                Events.fire('peer-left', msg.peerId);
                break;
            case 'peer-updated':
                console.log('接收到peer-updated事件，对等设备更新:', msg.peer);
                
                // 确保对等设备对象包含完整的名称信息
                if (msg.peer && msg.peer.name) {
                    console.log('设备信息:', 
                        '显示名称=', msg.peer.name.displayName,
                        '设备名称=', msg.peer.name.deviceName);
                } else {
                    console.warn('接收到的peer-updated事件缺少完整的名称信息:', msg.peer);
                }
                
                // 触发UI更新事件
                Events.fire('peer-updated', msg.peer);
                break;
            case 'signal':
                Events.fire('signal', msg);
                break;
            case 'ping':
                this.send({ type: 'pong' });
                break;
            case 'connection-refreshed':
                console.log(`服务器确认连接已刷新，时间戳: ${msg.timestamp}`);
                // 触发连接刷新成功事件，供其他组件使用
                Events.fire('connection-refreshed', {
                    timestamp: msg.timestamp
                });
                break;
            case 'set-cookie':
                if (msg.cookie) {
                    // 解析cookie并在本地存储
                    try {
                        const userNameMatch = msg.cookie.match(/username=([^;]+)/);
                        if (userNameMatch && userNameMatch[1]) {
                            const decodedName = decodeURIComponent(userNameMatch[1]);
                            localStorage.setItem('user-display-name', decodedName);
                            console.log('用户名已保存到cookie:', decodedName);
                            
                            // 创建document cookie来与服务器共享
                            document.cookie = msg.cookie;
                        }
                    } catch (e) {
                        console.error('处理cookie时出错:', e);
                    }
                }
                break;
            case 'display-name':
                if (msg.message && msg.message.peerId) {
                    console.log('Received server-assigned peerId:', msg.message.peerId);
                    this._selfId = msg.message.peerId;
                    msg.message.selfId = msg.message.peerId;
                }
                Events.fire('display-name', msg);
                break;
            case 'file':
                // 文件元数据处理 - 预备接收文件
                if (!this._fileInfo) this._fileInfo = {};
                
                const fileId = msg.fileId || msg.sender;
                
                const existingInfo = this._fileInfo[fileId];
                if (existingInfo && existingInfo.isTemporary) {
                    // 存在临时记录时，合并信息
                    console.log(`收到文件元数据，合并现有临时记录: ${msg.name}`);
                    
                    const existingData = existingInfo.data;
                    const existingChunks = existingInfo.chunksWithIndex || [];
                    const existingPendingChunks = existingInfo.pendingChunks || [];
                    const existingBytesReceived = existingInfo.bytesReceived || 0;
                    const existingChunksReceived = existingInfo.chunksReceived || 0;
                    
                    this._fileInfo[fileId] = {
                        name: msg.name,
                        mime: msg.mime,
                        size: msg.size,
                        sender: msg.sender,
                        fileId: msg.fileId,
                        bytesReceived: existingBytesReceived,
                        chunksReceived: existingChunksReceived,
                        totalChunks: Math.ceil(msg.size / FILE_CHUNK_SIZE), // 使用统一的块大小常量
                        data: existingData,
                        chunksWithIndex: existingChunks,
                        pendingChunks: existingPendingChunks,
                        lastActivityAt: Date.now()
                    };
                    
                    console.log(`合并后的文件信息: ${msg.name}, 已接收 ${existingChunksReceived} 块, ${existingBytesReceived} 字节`);
                } else {
                    // 创建新的文件信息记录
                    this._fileInfo[fileId] = {
                        name: msg.name,
                        mime: msg.mime,
                        size: msg.size,
                        sender: msg.sender,
                        fileId: msg.fileId,
                        bytesReceived: 0,
                        chunksReceived: 0,
                        totalChunks: Math.ceil(msg.size / FILE_CHUNK_SIZE), // 使用统一的块大小常量
                        data: [],
                        chunksWithIndex: [], // 添加索引跟踪
                        createdAt: Date.now(),
                        lastUpdated: Date.now()
                    };
                    
                    console.log(`接收文件元数据: ${msg.name}, 大小: ${msg.size} 字节, FileID: ${msg.fileId || '未指定'}`);
                }
                break;
            case 'file-chunk':
                if (!this._fileInfo || !this._fileInfo[msg.sender]) {
                    console.error('Received chunk but no metadata');
                    break;
                }
                
                const fileInfo = this._fileInfo[msg.sender];
                fileInfo.bytesReceived += msg.chunk.byteLength;
                fileInfo.data.push(msg.chunk);
                
                const progress = fileInfo.bytesReceived / fileInfo.size;
                Events.fire('file-progress', {
                    sender: msg.sender,
                    progress: Math.min(1, progress)
                });
                
                if (fileInfo.bytesReceived >= fileInfo.size) {
                    const blob = new Blob(fileInfo.data, {type: fileInfo.mime});
                    
                    Events.fire('file-received', {
                        name: fileInfo.name,
                        mime: fileInfo.mime,
                        size: fileInfo.size,
                        blob: blob,
                        sender: fileInfo.sender
                    });
                    
                    delete this._fileInfo[msg.sender];
                }
                break;
            case 'file-chunk-header':
                const chunkFileId = msg.fileId || msg.sender;
                const previousId = this._lastBinaryId;
                this._lastBinaryId = chunkFileId;
                
                if (previousId !== this._lastBinaryId) {
                    console.log(`设置_lastBinaryId: ${previousId} -> ${this._lastBinaryId}, 发送者: ${msg.sender}, 文件: ${msg.name || '未知'}`);
                }
                
                if (!this._fileInfo || !this._fileInfo[chunkFileId]) {
                    console.log(`接收到文件块头信息但元数据尚未到达，创建临时记录 (fileId: ${chunkFileId})`);
                    
                    if (!this._fileInfo) this._fileInfo = {};
                    
                    this._fileInfo[chunkFileId] = {
                        name: msg.name || '未知文件',
                        mime: msg.mime || 'application/octet-stream',
                        size: msg.totalSize || 0,
                        sender: msg.sender,
                        fileId: msg.fileId,
                        bytesReceived: 0,
                        offset: msg.offset || 0,
                        chunksReceived: 0,
                        totalChunks: msg.totalChunks || 0,
                        data: [],
                        chunksWithIndex: [],
                        currentChunkIndex: msg.currentChunk || 1,
                        expectedChunkSize: msg.size,
                        createdAt: Date.now(),
                        lastUpdated: Date.now(),
                        isTemporary: true,
                        pendingChunks: []
                    };
                    
                    if (msg.currentChunk && msg.currentChunk > 1) {
                        console.warn(`警告：第一个接收到的块索引为 ${msg.currentChunk}，可能已丢失前面的块`);
                    }
                } else {
                    const fileInfo = this._fileInfo[chunkFileId];
                    fileInfo.expectedChunkSize = msg.size;
                    fileInfo.currentChunkIndex = msg.currentChunk;
                    fileInfo.sender = msg.sender;
                    fileInfo.lastUpdated = Date.now();
                    
                    if (msg.offset !== undefined) {
                        fileInfo.offset = msg.offset;
                    }
                    
                    if (msg.totalSize && (!fileInfo.size || fileInfo.size === 0)) {
                        fileInfo.size = msg.totalSize;
                    }
                    if (msg.totalChunks && (!fileInfo.totalChunks || fileInfo.totalChunks === 0)) {
                        fileInfo.totalChunks = msg.totalChunks;
                    }
                    
                    if (msg.name && (!fileInfo.name || fileInfo.name === '未知文件' || fileInfo.name === 'Unknown file')) {
                        fileInfo.name = msg.name;
                    }
                    
                    if (msg.mime && (!fileInfo.mime || fileInfo.mime === 'application/octet-stream')) {
                        fileInfo.mime = msg.mime;
                    }
                    
                    if (msg.isRetry) {
                        console.log(`收到重试块: 文件=${fileInfo.name}, 块=${msg.currentChunk}/${msg.totalChunks}`);
                    } else {
                        if (msg.currentChunk === 1 || msg.currentChunk % 50 === 0) {
                            console.log(`文件传输进度: ${fileInfo.name}, 当前块=${msg.currentChunk}/${msg.totalChunks || '?'}`);
                        }
                    }
                    
                    if (fileInfo._completionTimer) {
                        clearTimeout(fileInfo._completionTimer);
                    }
                    
                    fileInfo._completionTimer = setTimeout(() => {
                        console.log(`文件数据流超时: ${fileInfo.name}`);
                        this._finalizeFileTransfer(fileInfo, msg.sender, chunkFileId);
                    }, 5000);
                }
                
                if (msg.currentChunk === 1 || msg.currentChunk % 100 === 0 || msg.isRetry) {
                    console.log(`预期文件块: 大小=${msg.size}字节, 块=${msg.currentChunk}/${msg.totalChunks}, fileId=${msg.fileId || '未指定'}, 发送者=${msg.sender}`);
                }
                break;
            case 'file-transfer-complete':
                const transferFileId = msg.fileId || msg.sender;
                console.log(`Received file transfer complete: ${msg.name}, size: ${msg.size} bytes, chunks: ${msg.chunkCount}, fileId: ${transferFileId}, isLast: ${msg.isLast}`);
                
                if (this._fileInfo && this._fileInfo[transferFileId]) {
                    const fileInfo = this._fileInfo[transferFileId];
                    
                    if (msg.size && !fileInfo.size) {
                        fileInfo.size = msg.size;
                    }
                    if (msg.name && (!fileInfo.name || fileInfo.name === 'Unknown file')) {
                        fileInfo.name = msg.name;
                    }
                    if (msg.chunkCount && (!fileInfo.totalChunks || fileInfo.totalChunks === 0)) {
                        fileInfo.totalChunks = msg.chunkCount;
                    }
                    
                    if (fileInfo.bytesReceived > 0) {
                        console.log(`File transfer complete signal: ${fileInfo.name}, received: ${fileInfo.bytesReceived}/${fileInfo.size} bytes, chunks: ${fileInfo.chunksReceived}/${msg.chunkCount}`);
                        this._finalizeFileTransfer(fileInfo, msg.sender, transferFileId);
                    } else {
                        console.log(`Received transfer complete but no data for ${fileInfo.name}`);
                    }
                    
                    if (msg.isLast && this._lastBinaryId === transferFileId) {
                        console.log(`Clearing last binary ID: ${this._lastBinaryId}`);
                        this._lastBinaryId = null;
                    }
                } else {
                    console.log(`Received transfer complete but no file info: ${transferFileId}`);
                }
                break;
            case 'file-received-feedback':
                console.log(`Received file feedback: ${msg.fileName}, size: ${msg.size} bytes, status: ${msg.success ? 'success' : 'failure'}`);
                
                Events.fire('notify-user', {
                    message: `文件 ${msg.fileName} 已被对方接收`,
                    timeout: 3000
                });
                break;
            case 'text':
                if (msg.text) {
                    try {
                        const escaped = decodeURIComponent(escape(atob(msg.text)));
                        
                        let peerName = '';
                        const peerElement = document.getElementById(msg.sender);
                        if (peerElement) {
                            const nameElement = peerElement.querySelector('.name');
                            if (nameElement) {
                                peerName = nameElement.textContent;
                            }
                        }
                        
                        Events.fire('text-received', {
                            text: escaped,
                            sender: msg.sender,
                            peerName: peerName
                        });
                    } catch (error) {
                        console.error('Error decoding text message:', error);
                    }
                }
                break;
            default:
                console.error('WS: unknown message type', msg);
        }
    }

    send(message) {
        if (!this._socket || this._socket.readyState !== WebSocket.OPEN) return;
        
        if (message.to) {
            this.lastSendPeerId = message.to;
        }
        
        this._socket.send(JSON.stringify(message));
    }

    sendBinary(buffer) {
        if (!this._socket || this._socket.readyState !== WebSocket.OPEN) {
            console.error('WebSocket连接未打开，无法发送二进制数据');
            Events.fire('notify-user', {
                message: '连接已断开，无法发送数据',
                timeout: 3000
            });
            return false;
        }
        
        if (!this.lastSendPeerId) {
            console.error('Cannot send binary data: No recipient specified');
            Events.fire('notify-user', {
                message: '无法发送二进制数据：未指定接收方',
                timeout: 3000
            });
            return false;
        }
        
        try {
            this._socket.send(buffer);
            return true;
        } catch (error) {
            console.error('发送二进制数据时出错：', error);
            Events.fire('notify-user', {
                message: '发送数据失败，请重试',
                timeout: 3000
            });
            return false;
        }
    }

    _endpoint() {
        const protocol = location.protocol.startsWith('https') ? 'wss' : 'ws';
        const url = protocol + '://' + location.host + '/server';
        return url;
    }

    _disconnect() {
        this.send({ type: 'disconnect' });
        this._socket.onclose = null;
        this._socket.close();
    }

    _onDisconnect() {
        console.log('WS: 服务器已断开连接');
        
        // 清除现有的计时器
        if (this._countdownTimer) {
            clearInterval(this._countdownTimer);
            this._countdownTimer = null;
        }
        clearTimeout(this._reconnectTimer);
        
        // 设置倒计时时间（秒）
        const countdownTime = 5;
        let remainingTime = countdownTime;
        
        // 显示初始通知
        Events.fire('notify-user', {
            message: `连接已断开，${remainingTime}秒后重试...`,
            persistent: true,
            id: 'connection-countdown' // 添加ID便于后续更新或清除
        });
        
        // 设置倒计时计时器
        this._countdownTimer = setInterval(() => {
            remainingTime--;
            
            // 更新剩余时间通知
            if (remainingTime > 0) {
                Events.fire('notify-user', {
                    message: `连接已断开，${remainingTime}秒后重试...`,
                    persistent: true,
                    id: 'connection-countdown'
                });
            } else {
                // 倒计时结束，清除计时器
                clearInterval(this._countdownTimer);
                this._countdownTimer = null;
                
                // 显示正在连接的消息
                Events.fire('notify-user', {
                    message: '正在尝试重新连接...',
                    persistent: true,
                    id: 'connection-countdown'
                });
            }
        }, 1000);
        
        // 设置重连计时器
        this._reconnectTimer = setTimeout(() => {
            this._connect();
        }, countdownTime * 1000);
    }

    _onVisibilityChange() {
        if (document.hidden) return;
        this._connect();
    }

    _isConnected() {
        return this._socket && this._socket.readyState === this._socket.OPEN;
    }

    _isConnecting() {
        return this._socket && this._socket.readyState === this._socket.CONNECTING;
    }

    _onBinaryData(binaryData) {
        const fileKey = this._lastBinaryId;
        if (!fileKey || !this._fileInfo || !this._fileInfo[fileKey]) {
            console.error(`无法处理二进制数据：未找到文件信息 (lastBinaryId: ${fileKey})`);
            return;
        }
        
        const fileInfo = this._fileInfo[fileKey];
        if (!fileInfo) {
            console.error('文件信息未找到:', fileKey);
            return;
        }
        
        if (fileInfo._finalized) {
            console.log(`忽略额外的二进制数据，文件 ${fileInfo.name} 已完成`);
            return;
        }
        
        fileInfo.lastUpdated = Date.now();
        
        const currentChunkIndex = fileInfo.currentChunkIndex || fileInfo.chunksReceived + 1;
        
        if (fileInfo.chunksWithIndex && 
            fileInfo.chunksWithIndex.some(chunk => chunk.index === currentChunkIndex)) {
            console.log(`忽略重复块: ${currentChunkIndex}`);
            return;
        }
        
        const byteLength = Number(binaryData.byteLength) || 0;
        fileInfo.bytesReceived = Number(fileInfo.bytesReceived) || 0;
        fileInfo.bytesReceived += byteLength;
        
        if (!fileInfo.chunksWithIndex) {
            fileInfo.chunksWithIndex = [];
        }
        
        const chunkData = {
            index: currentChunkIndex,
            data: binaryData,
            timestamp: Date.now()
        };
        
        fileInfo.chunksWithIndex.push(chunkData);
        
        if (fileInfo.isTemporary && !fileInfo.pendingChunks) {
            fileInfo.pendingChunks = [];
        }
        
        if (fileInfo.isTemporary && fileInfo.pendingChunks) {
            fileInfo.pendingChunks.push(chunkData);
        }
        
        fileInfo.data.push(binaryData);
        fileInfo.chunksReceived = (fileInfo.chunksReceived || 0) + 1;
        
        fileInfo.size = Number(fileInfo.size) || 0;
        
        if (fileInfo.size > 0) {
            const progress = fileInfo.bytesReceived / fileInfo.size;
            const progressPercent = Math.floor(progress * 100);
            if (progressPercent % 10 === 0 && progressPercent !== fileInfo._lastReportedPercent) {
                fileInfo._lastReportedPercent = progressPercent;
                Events.fire('file-progress', {
                    sender: fileInfo.sender,
                    progress: Math.min(1, progress),
                    name: fileInfo.name
                });
                
                if (!fileInfo.isTemporary) {
                    console.log(`文件进度: ${fileInfo.name} - ${progressPercent}% (${(fileInfo.bytesReceived/1024/1024).toFixed(2)}MB/${(fileInfo.size/1024/1024).toFixed(2)}MB)`);
                }
            }
        } else if (fileInfo.totalChunks > 0 && !fileInfo.isTemporary) {
            if (fileInfo.chunksReceived % 10 === 0) {
                const progress = fileInfo.chunksReceived / fileInfo.totalChunks;
                Events.fire('file-progress', {
                    sender: fileInfo.sender,
                    progress: Math.min(1, progress),
                    name: fileInfo.name
                });
            }
        }
        
        if (fileInfo.isTemporary) {
            return;
        }
        
        if (fileInfo._completionTimer) {
            clearTimeout(fileInfo._completionTimer);
        }
        
        fileInfo._completionTimer = setTimeout(() => {
            console.log(`尝试自动完成文件传输: ${fileInfo.name}`);
            this._finalizeFileTransfer(fileInfo, fileInfo.sender, fileKey);
        }, 3000);
        
        const isComplete = fileInfo.size > 0 && fileInfo.bytesReceived >= fileInfo.size;
        const isChunksComplete = fileInfo.totalChunks > 0 && fileInfo.chunksReceived >= fileInfo.totalChunks;
        
        if (isComplete || isChunksComplete) {
            clearTimeout(fileInfo._completionTimer);
            fileInfo._completionTimer = null;
            
            console.log(`满足文件完成条件: ${fileInfo.name}`);
            this._finalizeFileTransfer(fileInfo, fileInfo.sender, fileKey);
        }
    }

    _finalizeFileTransfer(fileInfo, senderId, fileKey) {
        // 防止重复处理
        if (fileInfo._finalized) {
            return;
        }
        
        // 跳过处理临时文件记录
        if (fileInfo.isTemporary) {
            console.log(`跳过处理临时文件记录 (${fileInfo.name}), 等待完整元数据`);
            return;
        }
        
        // 清理所有定时器
        if (fileInfo._finalizeRetryTimer) {
            clearTimeout(fileInfo._finalizeRetryTimer);
            fileInfo._finalizeRetryTimer = null;
        }
        
        if (fileInfo._completionTimer) {
            clearTimeout(fileInfo._completionTimer);
            fileInfo._completionTimer = null;
        }
        
        // 检查文件是否接收完整
        if (fileInfo.size > 0 && fileInfo.bytesReceived < fileInfo.size * 0.98) {
            console.warn(`文件数据不完整: ${fileInfo.name} - 仅接收到 ${Math.floor(fileInfo.bytesReceived/fileInfo.size*100)}%`);
            
            // 尝试3次后才放弃重试
            if (fileInfo._finalizeAttempts && fileInfo._finalizeAttempts >= 3) {
                console.warn(`已尝试多次完成文件，将尝试处理已接收的部分`);
            } else {
                fileInfo._finalizeAttempts = (fileInfo._finalizeAttempts || 0) + 1;
                console.log(`等待更多数据，这是第 ${fileInfo._finalizeAttempts} 次尝试`);
                
                // 设置延迟重试
                fileInfo._finalizeRetryTimer = setTimeout(() => {
                    console.log(`延迟完成文件: ${fileInfo.name}`);
                    this._finalizeFileTransfer(fileInfo, senderId, fileKey);
                }, 1500);
                return;
            }
        }
        
        // 标记为已完成，防止重复处理
        fileInfo._finalized = true;
        
        console.log(`开始处理文件 ${fileInfo.name}, 大小: ${fileInfo.bytesReceived}/${fileInfo.size} 字节, 收到块数: ${fileInfo.chunksReceived}/${fileInfo.totalChunks}`);
        
        try {
            if (fileInfo.chunksWithIndex && fileInfo.chunksWithIndex.length > 0) {
                console.log(`对 ${fileInfo.chunksWithIndex.length} 个数据块进行排序`);
                
                fileInfo.chunksWithIndex = fileInfo.chunksWithIndex.filter(chunk => 
                    chunk && chunk.data && chunk.data.byteLength > 0 && chunk.index > 0
                );
                
                const indices = fileInfo.chunksWithIndex.map(chunk => chunk.index).sort((a, b) => a - b);
                const hasGaps = indices.some((val, idx) => 
                    idx > 0 && val !== indices[idx-1] + 1
                );
                
                if (hasGaps) {
                    console.warn(`文件 ${fileInfo.name} 的数据块不连续，缺少部分块`);
                    
                    const missingIndices = [];
                    for (let i = 1; i < indices[indices.length-1]; i++) {
                        if (!indices.includes(i)) {
                            missingIndices.push(i);
                        }
                    }
                    
                    if (missingIndices.length > 0) {
                        console.warn(`缺失的数据块: ${missingIndices.join(', ')}`);
                    }
                }
                
                fileInfo.chunksWithIndex.sort((a, b) => a.index - b.index);
                
                const sortedIndices = fileInfo.chunksWithIndex.map(chunk => chunk.index);
                console.log(`排序后的块索引: ${sortedIndices[0]}...${sortedIndices[sortedIndices.length-1]}`);
                
                fileInfo.data = fileInfo.chunksWithIndex.map(item => item.data);
            } else {
                console.warn(`文件 ${fileInfo.name} 没有索引信息，使用接收顺序`);
            }
            
            fileInfo.data = fileInfo.data.filter(chunk => chunk && chunk.byteLength > 0);
            
            if (fileInfo.data.length === 0) {
                throw new Error('没有有效的数据块');
            }
            
            if (fileInfo.data.length < fileInfo.chunksReceived * 0.8) {
                console.warn(`文件数据块数量异常: 报告接收 ${fileInfo.chunksReceived} 块，但仅有 ${fileInfo.data.length} 块有效`);
            }
            
            console.log(`创建文件Blob，${fileInfo.data.length} 个数据块，预计大小 ${fileInfo.size} 字节`);
            const blob = new Blob(fileInfo.data, {type: fileInfo.mime || 'application/octet-stream'});
            
            console.log(`验证文件大小: 预期 ${fileInfo.size} 字节, 实际 ${blob.size} 字节`);
            
            if (fileInfo.size > 0 && Math.abs(blob.size - fileInfo.size) > fileInfo.size * 0.02) {
                console.warn(`文件大小不匹配: ${fileInfo.name} 预期 ${fileInfo.size} 字节, 实际 ${blob.size} 字节 (${Math.abs(blob.size - fileInfo.size) / fileInfo.size * 100}% 差异)`);
            }
            
            fileInfo.data = null;
            fileInfo.chunksWithIndex = null;
            
            console.log(`成功完成文件传输: ${fileInfo.name} (${blob.size} 字节)`);
            
            Events.fire('file-received', {
                name: fileInfo.name || '未命名文件',
                mime: fileInfo.mime || 'application/octet-stream',
                size: blob.size,
                blob: blob,
                sender: fileInfo.sender || senderId
            });
            
            this.send({
                type: 'file-received-feedback',
                to: senderId,
                fileName: fileInfo.name,
                fileId: fileInfo.fileId,
                size: blob.size,
                chunksReceived: fileInfo.chunksReceived,
                success: true
            });
        } catch (e) {
            console.error(`处理文件时出错: ${e.message}`);
            console.error(e.stack);
            
            Events.fire('notify-user', {
                message: `无法处理文件: ${fileInfo.name} - ${e.message}`,
                timeout: 5000
            });
            
            this.send({
                type: 'file-received-feedback',
                to: senderId,
                fileName: fileInfo.name,
                fileId: fileInfo.fileId,
                success: false,
                error: e.message
            });
        } finally {
            delete this._fileInfo[fileKey || senderId];
            
            if (this._lastBinaryId === fileKey) {
                this._lastBinaryId = null;
            }
        }
    }

    getSelfId() {
        return this._selfId;
    }

    _startHeartbeat() {
        this._stopHeartbeat();
        this._heartbeatInterval = setInterval(() => {
            if (this._isConnected()) {
                this.send({ type: 'heartbeat' });
            }
        }, 30000);
    }
    
    _resetHeartbeat() {
        // 重置心跳计时器，确保连接保持活跃
        if (this._heartbeatTimeout) {
            clearTimeout(this._heartbeatTimeout);
        }
        
        this._heartbeatTimeout = setTimeout(() => {
            if (this._isConnected()) {
                this.send({ type: 'heartbeat' });
            }
        }, 30000);
    }
    
    _stopHeartbeat() {
        if (this._heartbeatInterval) {
            clearInterval(this._heartbeatInterval);
            this._heartbeatInterval = null;
        }
        
        if (this._heartbeatTimeout) {
            clearTimeout(this._heartbeatTimeout);
            this._heartbeatTimeout = null;
        }
    }
}

class Peer {

    constructor(serverConnection, peerId) {
        this._server = serverConnection;
        this._peerId = peerId;
        this._filesQueue = [];
        this._busy = false;
        this._fileTransfer = new FileTransferAdapter(this, this._peerId, this._server);
    }

    sendJSON(message) {
        this._send(JSON.stringify(message));
    }

    sendFiles(files) {
        this._fileTransfer.sendFiles(files);
    }

    sendText(text) {
        const unescaped = btoa(unescape(encodeURIComponent(text)));
        this.sendJSON({ type: 'text', text: unescaped });
        
        const peerName = this._peerId ? document.querySelector('[data-peer-id="' + this._peerId + '"] .name').textContent : '';
        Events.fire('text-sent', {
            text: text,
            peerName: peerName
        });
    }

    _onMessage(message) {
        if (typeof message !== 'string') {
            this._onChunkReceived(message);
            return;
        }
        message = JSON.parse(message);
        console.log('RTC 消息:', message);
        switch (message.type) {
            case 'header':
                this._onFileHeader(message);
                break;
            case 'progress':
                this._onDownloadProgress(message.progress);
                break;
            case 'transfer-complete':
                this._onTransferCompleted();
                break;
            case 'text':
                this._onTextReceived(message);
                break;
        }
    }

    _onFileHeader(header) {
        this._lastProgress = 0;
        this._digester = new FileDigester({
            name: header.name,
            mime: header.mime,
            size: header.size
        }, file => this._onFileReceived(file));
    }

    _onChunkReceived(chunk) {
        if(!chunk.byteLength) return;
        
        this._digester.unchunk(chunk);
        const progress = this._digester.progress;
        this._onDownloadProgress(progress);

        if (progress - this._lastProgress < 0.01) return;
        this._lastProgress = progress;
        this._sendProgress(progress);
    }

    _onDownloadProgress(progress) {
        Events.fire('file-progress', { sender: this._peerId, progress: progress });
    }

    _onFileReceived(proxyFile) {
        // 触发一次文件接收事件
        Events.fire('file-received', proxyFile);
        
        // 获取对等方名称用于显示
        const peerName = this._peerId ? document.querySelector('[data-peer-id="' + this._peerId + '"] .name')?.textContent : '';
        
        // 只添加额外的peerName信息，避免触发新事件
        if (peerName) {
            proxyFile.peerName = peerName;
        }
    }

    _onTransferCompleted() {
        this._onDownloadProgress(1);
        this._reader = null;
        this._busy = false;
        Events.fire('notify-user', {
            message: '文件传输完成',
            persistent: false
        });
        
        this.sendJSON({ type: 'transfer-complete' });
    }

    _sendProgress(progress) {
        this.sendJSON({ type: 'progress', progress: progress });
    }

    _onTextReceived(message) {
        try {
            const escaped = decodeURIComponent(escape(atob(message.text)));
            
            let peerName = '';
            const peerElement = document.getElementById(this._peerId);
            if (peerElement) {
                const nameElement = peerElement.querySelector('.name');
                if (nameElement) {
                    peerName = nameElement.textContent;
                }
            }
            
            Events.fire('text-received', { 
                text: escaped, 
                sender: this._peerId,
                peerName: peerName
            });
        } catch (error) {
            console.error('处理接收到的文本消息时出错:', error);
        }
    }
}

class RTCPeer extends Peer {

    constructor(serverConnection, peerId) {
        super(serverConnection, peerId);
        if (!peerId) return;
        this._connect(peerId, true);
    }

    _connect(peerId, isCaller) {
        if (!this._conn) this._openConnection(peerId, isCaller);

        if (isCaller) {
            this._openChannel();
        } else {
            this._conn.ondatachannel = e => this._onChannelOpened(e);
        }
    }

    _openConnection(peerId, isCaller) {
        this._isCaller = isCaller;
        this._peerId = peerId;
        this._conn = new RTCPeerConnection(RTCPeer.config);
        this._conn.onicecandidate = e => this._onIceCandidate(e);
        this._conn.onconnectionstatechange = e => this._onConnectionStateChange(e);
        this._conn.oniceconnectionstatechange = e => this._onIceConnectionStateChange(e);
    }

    _openChannel() {
        const channel = this._conn.createDataChannel('data-channel', { 
            ordered: true,
            reliable: true
        });
        channel.onopen = e => this._onChannelOpened(e);
        this._conn.createOffer().then(d => this._onDescription(d)).catch(e => this._onError(e));
    }

    _onDescription(description) {
        this._conn.setLocalDescription(description)
            .then(_ => this._sendSignal({ sdp: description }))
            .catch(e => this._onError(e));
    }

    _onIceCandidate(event) {
        if (!event.candidate) return;
        this._sendSignal({ ice: event.candidate });
    }

    onServerMessage(message) {
        if (!this._conn) this._connect(message.sender, false);

        if (message.sdp) {
            this._conn.setRemoteDescription(new RTCSessionDescription(message.sdp))
                .then( _ => {
                    if (message.sdp.type === 'offer') {
                        return this._conn.createAnswer()
                            .then(d => this._onDescription(d));
                    }
                })
                .catch(e => this._onError(e));
        } else if (message.ice) {
            this._conn.addIceCandidate(new RTCIceCandidate(message.ice));
        }
    }

    _onChannelOpened(event) {
        console.log('RTC: 与', this._peerId, '建立通道连接');
        const channel = event.channel || event.target;
        channel.binaryType = 'arraybuffer';
        channel.onmessage = e => this._onMessage(e.data);
        channel.onclose = e => this._onChannelClosed();
        this._channel = channel;
    }

    _onChannelClosed() {
        console.log('RTC: 通道关闭', this._peerId);
        if (!this._isCaller) {
            console.log('RTC: 非调用者尝试重连');
            setTimeout(() => {
                this._connect(this._peerId, false);
            }, 1000);
            return;
        }
        this._connect(this._peerId, true);
    }

    _onConnectionStateChange(e) {
        console.log('RTC: 连接状态变更:', this._conn.connectionState);
        switch (this._conn.connectionState) {
            case 'disconnected':
                this._onChannelClosed();
                break;
            case 'failed':
                this._conn = null;
                this._onChannelClosed();
                break;
        }
    }

    _onIceConnectionStateChange() {
        switch (this._conn.iceConnectionState) {
            case 'failed':
                console.error('ICE 收集失败');
                break;
            default:
                console.log('ICE 收集状态', this._conn.iceConnectionState);
        }
    }

    _onError(error) {
        console.error(error);
    }

    _send(message) {
        if (!this._channel) return this.refresh();
        this._channel.send(message);
    }

    _sendSignal(signal) {
        signal.type = 'signal';
        signal.to = this._peerId;
        this._server.send(signal);
    }

    refresh() {
        if (this._isConnected() || this._isConnecting()) return;
        this._connect(this._peerId, this._isCaller);
    }

    _isConnected() {
        return this._channel && this._channel.readyState === 'open';
    }

    _isConnecting() {
        return this._channel && this._channel.readyState === 'connecting';
    }

    // 添加destroy方法清理资源
    destroy() {
        console.log(`RTCPeer: 清理资源 (${this._peerId})`);
        
        // 关闭数据通道
        if (this._channel) {
            this._channel.onmessage = null;
            this._channel.onclose = null;
            this._channel.onopen = null;
            
            if (this._channel.readyState === 'open') {
                this._channel.close();
            }
            this._channel = null;
        }
        
        // 关闭RTC连接
        if (this._conn) {
            this._conn.onicecandidate = null;
            this._conn.onconnectionstatechange = null;
            this._conn.oniceconnectionstatechange = null;
            this._conn.ondatachannel = null;
            
            if (this._conn.signalingState !== 'closed') {
                this._conn.close();
            }
            this._conn = null;
        }
    }
}

class PeersManager {

    constructor(serverConnection) {
        this.peers = {};
        this._server = serverConnection;
        this._selfId = null;
        
        Events.on('signal', e => this._onMessage(e.detail));
        Events.on('peers', e => this._onPeers(e.detail));
        Events.on('files-selected', e => this._onFilesSelected(e.detail));
        Events.on('send-text', e => this._onSendText(e.detail));
        Events.on('peer-left', e => this._onPeerLeft(e.detail));
        Events.on('peer-joined', e => this._onPeerJoined(e.detail));
        Events.on('display-name', e => {
            if (e.detail && e.detail.message && e.detail.message.peerId) {
                const oldId = this._selfId;
                this._selfId = e.detail.message.peerId;
                console.log(`PeersManager: 设置自身ID为 ${this._selfId}${oldId ? ` (原ID: ${oldId})` : ''}`);
                
                const selfElement = document.getElementById('displayName');
                if (selfElement) {
                    selfElement.dataset.selfId = this._selfId;
                }
            }
        });
        
        this._setupDebugHelpers();
    }
    
    _setupDebugHelpers() {
        window.showPeersList = () => {
            console.log("当前Peers列表:", Object.keys(this.peers));
            return Object.keys(this.peers);
        };
    }

    _onMessage(message) {
        if (!this.peers[message.sender]) {
            this.peers[message.sender] = new RTCPeer(this._server);
        }
        this.peers[message.sender].onServerMessage(message);
    }

    _onPeers(peers) {
        console.log(`收到${peers.length}个对等设备信息:`, peers.map(p => p.id).join(', '));
        
        if (peers.length === 0) {
            console.log('收到空的对等设备列表，保留现有连接');
            return;
        }
        
        const peerIds = peers.map(p => p.id);
        console.log('有效的对等设备ID列表:', peerIds);
        
        for (const oldPeerId in this.peers) {
            if (!peerIds.includes(oldPeerId)) {
                console.log(`移除不再存在的peer连接: ${oldPeerId}`);
                this._onPeerLeft(oldPeerId);
            }
        }
        
        peers.forEach(peer => {
            if (this.peers[peer.id]) {
                console.log(`刷新已存在的peer连接: ${peer.id}`);
                this.peers[peer.id].refresh();
                return;
            }
            console.log(`创建新的peer连接: ${peer.id}, RTC支持: ${window.isRtcSupported && peer.rtcSupported}`);
            if (window.isRtcSupported && peer.rtcSupported) {
                this.peers[peer.id] = new RTCPeer(this._server, peer.id);
            } else {
                this.peers[peer.id] = new WSPeer(this._server, peer.id);
            }
        });
    }

    sendTo(peerId, message) {
        this.peers[peerId].send(message);
    }

    _onFilesSelected(message) {
        if (!message.to) {
            console.error('未指定目标设备');
            Events.fire('notify-user', {
                message: '发送失败：未指定目标设备',
                timeout: 3000
            });
            return;
        }
        
        console.log(`正在尝试发送文件到设备: ${message.to}`);
        
        if (!this.peers[message.to]) {
            console.log(`目标设备未在peers列表中，尝试创建新的WSPeer连接: ${message.to}`);
            console.log(`现有的peers: ${Object.keys(this.peers).join(', ')}`);
            this.peers[message.to] = new WSPeer(this._server, message.to);
        }
        
        this.peers[message.to].sendFiles(message.files);
    }

    _onSendText(message) {
        if (!message.to) {
            console.error('未指定目标设备');
            Events.fire('notify-user', {
                message: '发送失败：未指定目标设备',
                timeout: 3000
            });
            return;
        }
        
        console.log(`正在尝试发送文本到设备: ${message.to}`);
        
        if (!this.peers[message.to]) {
            console.log(`目标设备未在peers列表中，尝试创建新的WSPeer连接: ${message.to}`);
            console.log(`现有的peers: ${Object.keys(this.peers).join(', ')}`);
            this.peers[message.to] = new WSPeer(this._server, message.to);
        }
        
        this.peers[message.to].sendText(message.text);
    }

    _onPeerLeft(peerId) {
        const peer = this.peers[peerId];
        if (peer) {
            // 调用destroy方法清理资源
            if (typeof peer.destroy === 'function') {
                console.log(`调用peer.destroy()清理资源: ${peerId}`);
                peer.destroy();
            }
            
            // 如果有_peer对象，关闭它
            if (peer._peer) {
                peer._peer.close();
            }
            
            // 删除peer引用
            delete this.peers[peerId];
            console.log(`移除了peer: ${peerId}`);
        }
    }

    _onPeerJoined(peer) {
        console.log(`收到peer加入事件: ${peer.id}`, peer);
        if (!this.peers[peer.id]) {
            console.log(`创建新的peer连接(从加入事件): ${peer.id}, RTC支持: ${window.isRtcSupported && peer.rtcSupported}`);
            if (window.isRtcSupported && peer.rtcSupported) {
                this.peers[peer.id] = new RTCPeer(this._server, peer.id);
            } else {
                this.peers[peer.id] = new WSPeer(this._server, peer.id);
            }
        } else {
            console.log(`更新已存在的peer连接: ${peer.id}`);
            this.peers[peer.id].refresh();
        }
    }
}

class WSPeer {
    constructor(server, peerId) {
        this._server = server;
        this._peerId = peerId;
        this._fileTransfer = new WSFileTransferAdapter(this, this._peerId, this._server);
        this._isConnecting = false;
        this._reconnectTimeout = null;
        
        // 监听连接刷新事件
        this._connectionRefreshedHandler = e => this._onConnectionRefreshed(e.detail);
        Events.on('connection-refreshed', this._connectionRefreshedHandler);
    }
    
    _onConnectionRefreshed(detail) {
        if (this._isConnecting) {
            console.log(`WSPeer: 收到连接刷新确认，重置连接状态 (${this._peerId})`);
            this._isConnecting = false;
            
            // 通知UI连接已刷新
            Events.fire('notify-user', {
                message: `与 ${this._peerId} 的连接已刷新`,
                timeout: 1500
            });
        }
    }

    _send(message) {
        message.to = this._peerId;
        this._server.send(message);
    }

    sendText(text) {
        const unescaped = btoa(unescape(encodeURIComponent(text)));
        this._send({
            type: 'text',
            text: unescaped
        });
        
        const peerName = this._peerId ? document.querySelector(`[id="${this._peerId}"] .name`).textContent : '';
        Events.fire('text-sent', {
            text: text,
            peerName: peerName
        });
    }

    sendFiles(files) {
        this._fileTransfer.sendFiles(files);
    }

    refresh() {
        // 避免重复刷新
        if (this._isConnecting) return;
        this._isConnecting = true;
        
        console.log(`WSPeer: 尝试刷新与 ${this._peerId} 的连接`);
        
        // 清除之前的重连定时器
        if (this._reconnectTimeout) {
            clearTimeout(this._reconnectTimeout);
        }
        
        // 通知服务器刷新连接
        this._send({
            type: 'refresh-connection'
        });
        
        // 设置状态重置定时器，以防服务器未响应
        this._reconnectTimeout = setTimeout(() => {
            if (this._isConnecting) {
                this._isConnecting = false;
                console.log(`WSPeer: 刷新与 ${this._peerId} 的连接超时，重置状态`);
                
                // 通知用户刷新失败
                Events.fire('notify-user', {
                    message: `刷新与 ${this._peerId} 的连接失败`,
                    timeout: 3000
                });
            }
        }, 5000);
    }
    
    // 在对象销毁时移除事件监听器
    destroy() {
        Events.off('connection-refreshed', this._connectionRefreshedHandler);
        
        if (this._reconnectTimeout) {
            clearTimeout(this._reconnectTimeout);
            this._reconnectTimeout = null;
        }
    }
}

class FileTransfer {

    constructor(sender, peerId, server) {
        this._sender = sender;
        this._peerId = peerId;
        this._server = server;
    }

    _send(message) {
        throw new Error('_send方法必须由子类实现');
    }

    _sendBinary(chunk) {
        throw new Error('_sendBinary方法必须由子类实现');
    }

    async sendFiles(files) {
        const fileQueue = Array.from(files);
        if (fileQueue.length === 0) return;
        
        const processNextFile = () => {
            if (fileQueue.length === 0) return;
            
            const file = fileQueue.shift();
            const fileId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            
            this._send({
                type: 'file',
                name: file.name,
                mime: file.type,
                size: file.size,
                fileId: fileId
            });
            
            const chunkSize = FILE_CHUNK_SIZE;
            let offset = 0;
            let chunkCount = Math.ceil(file.size / chunkSize);
            let sentChunks = 0;
            
            console.log(`开始文件传输: ${file.name}, 大小: ${file.size} 字节, 块数: ${chunkCount}, 目标: ${this._peerId}`);
            
            const processFile = async () => {
                for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
                    const start = chunkIndex * chunkSize;
                    const end = Math.min(start + chunkSize, file.size);
                    const slice = file.slice(start, end);
                    
                    try {
                        const chunk = await this._readFileChunk(slice);
                        
                        this._send({
                            type: 'file-chunk-header',
                            size: chunk.byteLength,
                            offset: start,
                            totalSize: file.size,
                            currentChunk: chunkIndex + 1,
                            totalChunks: chunkCount,
                            fileId: fileId,
                            name: file.name
                        });
                        
                        await new Promise(resolve => setTimeout(resolve, 5));
                        
                        this._sendBinary(chunk);
                        
                        sentChunks++;
                        
                        const progress = Math.min(1, (start + chunk.byteLength) / file.size);
                        Events.fire('file-progress', {
                            recipient: this._peerId,
                            progress: progress,
                            name: file.name
                        });
                        
                        await new Promise(resolve => setTimeout(resolve, 2));
                    } catch (error) {
                        console.error(`处理文件块错误 (${chunkIndex+1}/${chunkCount}):`, error);
                        
                        // 通知用户传输中断
                        Events.fire('notify-user', {
                            message: `文件 ${file.name} 传输中断，正在重试...`,
                            timeout: 2000
                        });
                        
                        let retries = 0;
                        let success = false;
                        
                        while (retries < 3 && !success) {
                            try {
                                console.log(`重试发送文件块 ${chunkIndex+1}/${chunkCount} (第${retries+1}次尝试)`);
                                
                                await new Promise(resolve => setTimeout(resolve, 500));
                                
                                const chunk = await this._readFileChunk(slice);
                                
                                this._send({
                                    type: 'file-chunk-header',
                                    size: chunk.byteLength,
                                    offset: start,
                                    totalSize: file.size,
                                    currentChunk: chunkIndex + 1,
                                    totalChunks: chunkCount,
                                    fileId: fileId,
                                    name: file.name,
                                    isRetry: true
                                });
                                
                                await new Promise(resolve => setTimeout(resolve, 50));
                                this._sendBinary(chunk);
                                sentChunks++;
                                success = true;
                            } catch (retryError) {
                                console.error(`重试失败 (${retries+1}/3):`, retryError);
                                retries++;
                            }
                        }
                        
                        if (!success) {
                            console.error(`无法发送文件块 ${chunkIndex+1}/${chunkCount}，跳过`);
                        }
                    }
                }
                
                await new Promise(resolve => setTimeout(resolve, 200));
                
                this._send({
                    type: 'file-transfer-complete',
                    name: file.name,
                    size: file.size,
                    chunkCount: sentChunks,
                    fileId: fileId,
                    isLast: true
                });
                
                console.log(`文件传输完成: ${file.name}, 总大小: ${file.size} 字节, 已发送块数: ${sentChunks}`);
                
                await new Promise(resolve => setTimeout(resolve, 500));
                
                this._send({
                    type: 'file-transfer-complete',
                    name: file.name,
                    size: file.size,
                    chunkCount: sentChunks,
                    fileId: fileId,
                    isLast: true,
                    isFinalConfirmation: true
                });
                
                Events.fire('notify-user', {
                    message: `文件 ${file.name} 传输完成`,
                    timeout: 3000
                });
            };
            
            processFile()
                .then(() => {
                    console.log(`等待处理下一个文件...`);
                    setTimeout(processNextFile, 2000);
                })
                .catch(error => {
                    console.error('文件传输过程中出错:', error);
                    Events.fire('notify-user', {
                        message: '文件传输失败: ' + file.name,
                        timeout: 5000
                    });
                    setTimeout(processNextFile, 2000);
                });
        };
        
        processNextFile();
    }
    
    async _readFileChunk(slice) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = e => reject(e);
            reader.readAsArrayBuffer(slice);
        });
    }
}

class FileTransferAdapter extends FileTransfer {
    constructor(peer, peerId, server) {
        super(peer, peerId, server);
        this._peer = peer;
    }
    
    _send(message) {
        this._peer._send(message);
    }
    
    _sendBinary(chunk) {
        this._server.sendBinary(chunk);
    }
}

class WSFileTransferAdapter extends FileTransfer {
    constructor(peer, peerId, server) {
        super(peer, peerId, server);
        this._peer = peer;
    }
    
    _send(message) {
        this._peer._send(message);
    }
    
    _sendBinary(chunk) {
        this._server.sendBinary(chunk);
    }
}

class FileDigester {

    constructor(meta, callback) {
        this._buffer = [];
        this._bytesReceived = 0;
        this._size = meta.size;
        this._mime = meta.mime || 'application/octet-stream';
        this._name = meta.name;
        this._callback = callback;
    }

    unchunk(chunk) {
        this._buffer.push(chunk);
        this._bytesReceived += chunk.byteLength || chunk.size;
        const totalChunks = this._buffer.length;
        this.progress = this._bytesReceived / this._size;
        if (isNaN(this.progress)) this.progress = 1

        if (this._bytesReceived < this._size) return;
        let blob = new Blob(this._buffer, { type: this._mime });
        this._callback({
            name: this._name,
            mime: this._mime,
            size: this._size,
            blob: blob
        });
    }
}

class Events {
    static fire(type, detail) {
        window.dispatchEvent(new CustomEvent(type, { detail: detail }));
    }

    static on(type, callback) {
        return window.addEventListener(type, callback, false);
    }

    static off(type, callback) {
        return window.removeEventListener(type, callback, false);
    }
}

RTCPeer.config = {
    'sdpSemantics': 'unified-plan',
    'iceServers': [{
        urls: 'stun:stun.l.google.com:19302'
    }]
}

class FileChunker {
    constructor(file, onChunk) {
        this._chunkSize = FILE_CHUNK_SIZE;
        this._offset = 0;
        this._file = file;
        this._onChunk = onChunk;
        this._reader = new FileReader();
        this._reader.addEventListener('load', e => this._onChunkRead(e.target.result));
    }

    nextPartition() {
        this._readChunk();
    }

    _readChunk() {
        const chunk = this._file.slice(this._offset, this._offset + this._chunkSize);
        this._reader.readAsArrayBuffer(chunk);
    }

    _onChunkRead(chunk) {
        this._offset += chunk.byteLength;
        this._onChunk(chunk);
        if (this.isFileEnd()) return;
        this._readChunk();
    }

    isFileEnd() {
        return this._offset >= this._file.size;
    }

    get progress() {
        return this._offset / this._file.size;
    }
}
