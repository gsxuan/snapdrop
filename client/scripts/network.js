window.URL = window.URL || window.webkitURL;
window.isRtcSupported = !!(window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection);

class ServerConnection {

    constructor() {
        this._connect();
        Events.on('beforeunload', async e => this._disconnect());
        Events.on('pagehide', async e => this._disconnect());
        document.addEventListener('visibilitychange', e => this._onVisibilityChange());
        this._connectLossCount = 0;
        this._fileInfo = null;
        this._lastBinaryId = null;
        this.lastSendPeerId = null; // 添加最后发送目标的ID记录
        this._selfId = null; // 存储自己的设备ID
    }

    _connect() {
        clearTimeout(this._reconnectTimer);
        if (this._isConnected() || this._isConnecting()) return;
        
        // 使用低延迟选项
        const url = this._endpoint();
        console.log('连接到WS服务器:', url);
        
        const ws = new WebSocket(url);
        // 设置为二进制缓冲区类型提高传输效率
        ws.binaryType = 'arraybuffer';
        
        // 设置连接超时
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
            
            // 设置心跳保持连接活跃
            this._startHeartbeat();
            
            // 清除所有断开连接提示消息
            Events.fire('notify-user', {
                message: '连接已恢复',
                timeout: 3000,
                persistent: false,
                type: 'clearAll'
            });
            
            // 清除定时器
            if (this._countdownTimer) {
                clearInterval(this._countdownTimer);
                this._countdownTimer = null;
            }
        };
        
        ws.onmessage = e => {
            // 重置心跳计时器
            this._resetHeartbeat();
            
            // 处理二进制数据
            if (e.data instanceof ArrayBuffer) {
                this._onBinaryData(e.data);
            } else {
                // 处理文本消息
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
            case 'signal':
                Events.fire('signal', msg);
                break;
            case 'ping':
                this.send({ type: 'pong' });
                break;
            case 'display-name':
                // Store server-assigned peerId
                if (msg.message && msg.message.peerId) {
                    console.log('Received server-assigned peerId:', msg.message.peerId);
                    this._selfId = msg.message.peerId;
                    // Trigger UI update event
                    msg.message.selfId = msg.message.peerId;
                }
                Events.fire('display-name', msg);
                break;
            case 'file':
                // Handle file metadata
                if (!this._fileInfo) this._fileInfo = {};
                
                // Use fileId as key instead of sender ID to allow multiple files
                const fileId = msg.fileId || msg.sender;
                
                // 检查是否已存在此文件的临时记录
                const existingInfo = this._fileInfo[fileId];
                if (existingInfo && existingInfo.isTemporary) {
                    console.log(`收到文件元数据，合并现有临时记录: ${msg.name}`);
                    
                    // 保留已收到的数据块
                    const existingData = existingInfo.data;
                    const existingChunks = existingInfo.chunksWithIndex || [];
                    const existingPendingChunks = existingInfo.pendingChunks || [];
                    const existingBytesReceived = existingInfo.bytesReceived || 0;
                    const existingChunksReceived = existingInfo.chunksReceived || 0;
                    
                    // 更新文件信息
                    this._fileInfo[fileId] = {
                        name: msg.name,
                        mime: msg.mime,
                        size: msg.size,
                        sender: msg.sender,
                        fileId: msg.fileId,
                        bytesReceived: existingBytesReceived,
                        chunksReceived: existingChunksReceived,
                        totalChunks: Math.ceil(msg.size / (256 * 1024)), // 使用当前的块大小
                        data: existingData,
                        chunksWithIndex: existingChunks,
                        pendingChunks: existingPendingChunks,
                        lastActivityAt: Date.now()
                    };
                    
                    console.log(`合并后的文件信息: ${msg.name}, 已接收 ${existingChunksReceived} 块, ${existingBytesReceived} 字节`);
                } else {
                    // 创建新的文件信息
                    this._fileInfo[fileId] = {
                        name: msg.name,
                        mime: msg.mime,
                        size: msg.size,
                        sender: msg.sender,
                        fileId: msg.fileId,
                        bytesReceived: 0,
                        chunksReceived: 0,
                        totalChunks: Math.ceil(msg.size / (256 * 1024)), // 使用当前的块大小
                        data: []
                    };
                    
                    console.log(`接收文件元数据: ${msg.name}, 大小: ${msg.size} 字节, FileID: ${msg.fileId || '未指定'}`);
                }
                break;
            case 'file-chunk':
                // Handle legacy file chunk data
                if (!this._fileInfo || !this._fileInfo[msg.sender]) {
                    console.error('Received chunk but no metadata');
                    break;
                }
                
                const fileInfo = this._fileInfo[msg.sender];
                fileInfo.bytesReceived += msg.chunk.byteLength;
                fileInfo.data.push(msg.chunk);
                
                // Update progress
                const progress = fileInfo.bytesReceived / fileInfo.size;
                Events.fire('file-progress', {
                    sender: msg.sender,
                    progress: Math.min(1, progress)
                });
                
                // Check if transfer complete
                if (fileInfo.bytesReceived >= fileInfo.size) {
                    // Create complete file blob
                    const blob = new Blob(fileInfo.data, {type: fileInfo.mime});
                    
                    // Trigger file received event
                    Events.fire('file-received', {
                        name: fileInfo.name,
                        mime: fileInfo.mime,
                        size: fileInfo.size,
                        blob: blob,
                        sender: fileInfo.sender
                    });
                    
                    // Cleanup
                    delete this._fileInfo[msg.sender];
                }
                break;
            case 'file-chunk-header':
                // Track current file ID and expected size for binary data
                const chunkFileId = msg.fileId || msg.sender;
                const previousId = this._lastBinaryId;
                this._lastBinaryId = chunkFileId;
                
                // 添加更多调试信息，避免重复输出
                if (previousId !== this._lastBinaryId) {
                    console.log(`设置_lastBinaryId: ${previousId} -> ${this._lastBinaryId}, 发送者: ${msg.sender}, 文件: ${msg.name || '未知'}`);
                }
                
                // Ensure file info exists
                if (!this._fileInfo || !this._fileInfo[chunkFileId]) {
                    // 创建临时记录，但不输出为错误，因为这是正常处理流程的一部分
                    console.log(`接收到文件块头信息但元数据尚未到达，创建临时记录 (fileId: ${chunkFileId})`);
                    
                    // Create temporary record
                    if (!this._fileInfo) this._fileInfo = {};
                    
                    // 保存更多信息以便后续合并
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
                        chunksWithIndex: [], // 用于存储带索引的数据块
                        currentChunkIndex: msg.currentChunk || 1, // 保存当前块索引
                        expectedChunkSize: msg.size,
                        createdAt: Date.now(),
                        lastUpdated: Date.now(),
                        isTemporary: true, // 标记为临时记录
                        pendingChunks: [] // 用于存储可能先于文件元数据到达的数据块
                    };
                    
                    // 如果第一个块的索引不是1，可能已经丢失了部分数据
                    if (msg.currentChunk && msg.currentChunk > 1) {
                        console.warn(`警告：第一个接收到的块索引为 ${msg.currentChunk}，可能已丢失前面的块`);
                    }
                } else {
                    // Save chunk info
                    const fileInfo = this._fileInfo[chunkFileId];
                    fileInfo.expectedChunkSize = msg.size;
                    fileInfo.currentChunkIndex = msg.currentChunk;
                    fileInfo.sender = msg.sender; // 确保发送者ID是最新的
                    fileInfo.lastUpdated = Date.now(); // 更新最后活动时间
                    
                    // Update offset and size if provided
                    if (msg.offset !== undefined) {
                        fileInfo.offset = msg.offset;
                    }
                    
                    // 更新文件总大小和块数
                    if (msg.totalSize && (!fileInfo.size || fileInfo.size === 0)) {
                        fileInfo.size = msg.totalSize;
                    }
                    if (msg.totalChunks && (!fileInfo.totalChunks || fileInfo.totalChunks === 0)) {
                        fileInfo.totalChunks = msg.totalChunks;
                    }
                    
                    // 更新文件名(如果之前是未知的)
                    if (msg.name && (!fileInfo.name || fileInfo.name === '未知文件' || fileInfo.name === 'Unknown file')) {
                        fileInfo.name = msg.name;
                    }
                    
                    // 检测并修复文件类型
                    if (msg.mime && (!fileInfo.mime || fileInfo.mime === 'application/octet-stream')) {
                        fileInfo.mime = msg.mime;
                    }
                    
                    // 如果是重试消息，记录日志
                    if (msg.isRetry) {
                        console.log(`收到重试块: 文件=${fileInfo.name}, 块=${msg.currentChunk}/${msg.totalChunks}`);
                    } else {
                        // 仅在文件信息有变更时输出日志
                        if (msg.currentChunk === 1 || msg.currentChunk % 50 === 0) {
                            console.log(`文件传输进度: ${fileInfo.name}, 当前块=${msg.currentChunk}/${msg.totalChunks || '?'}`);
                        }
                    }
                    
                    // 重置文件自动完成计时器
                    if (fileInfo._completionTimer) {
                        clearTimeout(fileInfo._completionTimer);
                    }
                    
                    // 设置新的完成计时器
                    fileInfo._completionTimer = setTimeout(() => {
                        console.log(`文件数据流超时: ${fileInfo.name}`);
                        this._finalizeFileTransfer(fileInfo, msg.sender, chunkFileId);
                    }, 5000); // 5秒内如果没有新数据则完成文件传输
                }
                
                // 记录日志，但只在需要时输出详细信息，减少控制台刷屏
                if (msg.currentChunk === 1 || msg.currentChunk % 100 === 0 || msg.isRetry) {
                    console.log(`预期文件块: 大小=${msg.size}字节, 块=${msg.currentChunk}/${msg.totalChunks}, fileId=${msg.fileId || '未指定'}, 发送者=${msg.sender}`);
                }
                break;
            case 'file-transfer-complete':
                // Handle file transfer completion
                const transferFileId = msg.fileId || msg.sender;
                console.log(`Received file transfer complete: ${msg.name}, size: ${msg.size} bytes, chunks: ${msg.chunkCount}, fileId: ${transferFileId}, isLast: ${msg.isLast}`);
                
                // Check for pending file info
                if (this._fileInfo && this._fileInfo[transferFileId]) {
                    const fileInfo = this._fileInfo[transferFileId];
                    
                    // Update file info if needed
                    if (msg.size && !fileInfo.size) {
                        fileInfo.size = msg.size;
                    }
                    if (msg.name && (!fileInfo.name || fileInfo.name === 'Unknown file')) {
                        fileInfo.name = msg.name;
                    }
                    if (msg.chunkCount && (!fileInfo.totalChunks || fileInfo.totalChunks === 0)) {
                        fileInfo.totalChunks = msg.chunkCount;
                    }
                    
                    // Check if we need to finalize
                    if (fileInfo.bytesReceived > 0) {
                        console.log(`File transfer complete signal: ${fileInfo.name}, received: ${fileInfo.bytesReceived}/${fileInfo.size} bytes, chunks: ${fileInfo.chunksReceived}/${msg.chunkCount}`);
                        // Force completion
                        this._finalizeFileTransfer(fileInfo, msg.sender, transferFileId);
                    } else {
                        console.log(`Received transfer complete but no data for ${fileInfo.name}`);
                    }
                    
                    // Clear lastBinaryId if this is the last message
                    if (msg.isLast && this._lastBinaryId === transferFileId) {
                        console.log(`Clearing last binary ID: ${this._lastBinaryId}`);
                        this._lastBinaryId = null;
                    }
                } else {
                    console.log(`Received transfer complete but no file info: ${transferFileId}`);
                }
                break;
            case 'file-received-feedback':
                // Handle file received feedback
                console.log(`Received file feedback: ${msg.fileName}, size: ${msg.size} bytes, status: ${msg.success ? 'success' : 'failure'}`);
                
                // Show notification
                Events.fire('notify-user', {
                    message: `文件 ${msg.fileName} 已被对方接收`,
                    timeout: 3000
                });
                break;
            case 'text':
                // Handle WebSocket text message
                if (msg.text) {
                    try {
                        // Decode text using same method as RTCPeer
                        const escaped = decodeURIComponent(escape(atob(msg.text)));
                        
                        // Get sender name
                        let peerName = '';
                        const peerElement = document.getElementById(msg.sender);
                        if (peerElement) {
                            const nameElement = peerElement.querySelector('.name');
                            if (nameElement) {
                                peerName = nameElement.textContent;
                            }
                        }
                        
                        // Trigger single event with all info
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
        
        // 如果消息有目标，保存为最后发送的目标ID
        if (message.to) {
            this.lastSendPeerId = message.to;
        }
        
        this._socket.send(JSON.stringify(message));
    }

    sendBinary(buffer) {
        if (!this._socket || this._socket.readyState !== WebSocket.OPEN) return;
        
        // 如果没有目标ID，使用最后一次发送消息的目标ID
        if (!this.lastSendPeerId) {
            console.error('Cannot send binary data: No recipient specified');
            Events.fire('notify-user', '无法发送二进制数据：未指定接收方');
            return;
        }
        
        this._socket.send(buffer);
    }

    _endpoint() {
        // hack to detect if deployment or development environment
        const protocol = location.protocol.startsWith('https') ? 'wss' : 'ws';
        // 移除webrtc路径，直接使用/server路径
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
        
        // 清除之前的定时器和计数器
        if (this._countdownTimer) {
            clearInterval(this._countdownTimer);
        }
        clearTimeout(this._reconnectTimer);
        
        // 初始倒计时时间（秒）
        const countdownTime = 5;
        let remainingTime = countdownTime;
        
        // 发送初始断开连接消息
        Events.fire('notify-user', {
            message: `连接已断开，${remainingTime}秒后重试...`,
            persistent: true
        });
        
        // 设置倒计时定时器
        this._countdownTimer = setInterval(() => {
            remainingTime--;
            if (remainingTime <= 0) {
                clearInterval(this._countdownTimer);
                return;
            }
            // 更新倒计时消息
            Events.fire('notify-user', {
                message: `连接已断开，${remainingTime}秒后重试...`,
                persistent: true
            });
        }, 1000);
        
        // 设置重连定时器
        this._reconnectTimer = setTimeout(_ => {
            clearInterval(this._countdownTimer);
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
        // Process binary data (typically file chunks)
        // Check if we have sender/file ID info
        const fileKey = this._lastBinaryId;
        if (!fileKey || !this._fileInfo || !this._fileInfo[fileKey]) {
            console.error(`无法处理二进制数据：未找到文件信息 (lastBinaryId: ${fileKey})`);
            return;
        }
        
        // Add data to file info
        const fileInfo = this._fileInfo[fileKey];
        if (!fileInfo) {
            console.error('文件信息未找到:', fileKey);
            return;
        }
        
        // Skip if file already finalized
        if (fileInfo._finalized) {
            console.log(`忽略额外的二进制数据，文件 ${fileInfo.name} 已完成`);
            return;
        }
        
        // 更新最后活动时间
        fileInfo.lastUpdated = Date.now();
        
        // 获取当前块索引
        const currentChunkIndex = fileInfo.currentChunkIndex || fileInfo.chunksReceived + 1;
        
        // 检查当前块索引是否已存在，避免重复数据
        if (fileInfo.chunksWithIndex && 
            fileInfo.chunksWithIndex.some(chunk => chunk.index === currentChunkIndex)) {
            console.log(`忽略重复块: ${currentChunkIndex}`);
            return;
        }
        
        // Ensure proper number types
        const byteLength = Number(binaryData.byteLength) || 0;
        fileInfo.bytesReceived = Number(fileInfo.bytesReceived) || 0;
        fileInfo.bytesReceived += byteLength;
        
        // 保存数据块及其索引
        if (!fileInfo.chunksWithIndex) {
            fileInfo.chunksWithIndex = [];
        }
        
        // 添加到带索引的块集合中
        const chunkData = {
            index: currentChunkIndex,
            data: binaryData,
            timestamp: Date.now()
        };
        
        fileInfo.chunksWithIndex.push(chunkData);
        
        // 如果是临时记录，也保存到pendingChunks中，以便后续合并
        if (fileInfo.isTemporary && !fileInfo.pendingChunks) {
            fileInfo.pendingChunks = [];
        }
        
        if (fileInfo.isTemporary && fileInfo.pendingChunks) {
            fileInfo.pendingChunks.push(chunkData);
        }
        
        // 仍然保留原始数据数组用于向后兼容
        fileInfo.data.push(binaryData);
        fileInfo.chunksReceived = (fileInfo.chunksReceived || 0) + 1;
        
        // Ensure file size is numeric
        fileInfo.size = Number(fileInfo.size) || 0;
        
        // 减少进度更新频率，提高性能
        if (fileInfo.size > 0) {
            const progress = fileInfo.bytesReceived / fileInfo.size;
            // 每10%更新一次进度
            const progressPercent = Math.floor(progress * 100);
            if (progressPercent % 10 === 0 && progressPercent !== fileInfo._lastReportedPercent) {
                fileInfo._lastReportedPercent = progressPercent;
                Events.fire('file-progress', {
                    sender: fileInfo.sender,
                    progress: Math.min(1, progress),
                    name: fileInfo.name
                });
                
                // 在进度更新时输出当前状态
                if (!fileInfo.isTemporary) {
                    console.log(`文件进度: ${fileInfo.name} - ${progressPercent}% (${(fileInfo.bytesReceived/1024/1024).toFixed(2)}MB/${(fileInfo.size/1024/1024).toFixed(2)}MB)`);
                }
            }
        } else if (fileInfo.totalChunks > 0 && !fileInfo.isTemporary) {
            // 仅在块计数是10的倍数时更新进度
            if (fileInfo.chunksReceived % 10 === 0) {
                const progress = fileInfo.chunksReceived / fileInfo.totalChunks;
                Events.fire('file-progress', {
                    sender: fileInfo.sender,
                    progress: Math.min(1, progress),
                    name: fileInfo.name
                });
            }
        }
        
        // 对于临时记录，不尝试完成文件，等待接收到真正的文件元数据后再处理
        if (fileInfo.isTemporary) {
            return;
        }
        
        // 更新完成计时器
        if (fileInfo._completionTimer) {
            clearTimeout(fileInfo._completionTimer);
        }
        
        // 设置新的完成计时器
        fileInfo._completionTimer = setTimeout(() => {
            console.log(`尝试自动完成文件传输: ${fileInfo.name}`);
            this._finalizeFileTransfer(fileInfo, fileInfo.sender, fileKey);
        }, 3000); // 3秒无新数据到达后自动完成
        
        // Check if transfer is complete
        const isComplete = fileInfo.size > 0 && fileInfo.bytesReceived >= fileInfo.size;
        const isChunksComplete = fileInfo.totalChunks > 0 && fileInfo.chunksReceived >= fileInfo.totalChunks;
        
        // If file is complete
        if (isComplete || isChunksComplete) {
            // 立即完成
            clearTimeout(fileInfo._completionTimer);
            fileInfo._completionTimer = null;
            
            // 如果满足完成条件，立即处理文件
            console.log(`满足文件完成条件: ${fileInfo.name}`);
            this._finalizeFileTransfer(fileInfo, fileInfo.sender, fileKey);
        }
    }
    
    _finalizeFileTransfer(fileInfo, senderId, fileKey) {
        // Check if already processed to avoid duplication
        if (fileInfo._finalized) {
            return;
        }
        
        // 检查是否为临时记录
        if (fileInfo.isTemporary) {
            console.log(`跳过处理临时文件记录 (${fileInfo.name}), 等待完整元数据`);
            return;
        }
        
        // 清除任何延迟完成计时器
        if (fileInfo._finalizeRetryTimer) {
            clearTimeout(fileInfo._finalizeRetryTimer);
            fileInfo._finalizeRetryTimer = null;
        }
        
        // 清除任何活动的定时器
        if (fileInfo._completionTimer) {
            clearTimeout(fileInfo._completionTimer);
            fileInfo._completionTimer = null;
        }
        
        // 检查数据是否足够完整
        if (fileInfo.size > 0 && fileInfo.bytesReceived < fileInfo.size * 0.98) {
            console.warn(`文件数据不完整: ${fileInfo.name} - 仅接收到 ${Math.floor(fileInfo.bytesReceived/fileInfo.size*100)}%`);
            
            // 检查是否已经到达最大等待时间
            if (fileInfo._finalizeAttempts && fileInfo._finalizeAttempts >= 3) {
                console.warn(`已尝试多次完成文件，将尝试处理已接收的部分`);
            } else {
                // 设置延迟完成计时器，等待更多数据
                fileInfo._finalizeAttempts = (fileInfo._finalizeAttempts || 0) + 1;
                console.log(`等待更多数据，这是第 ${fileInfo._finalizeAttempts} 次尝试`);
                
                fileInfo._finalizeRetryTimer = setTimeout(() => {
                    console.log(`延迟完成文件: ${fileInfo.name}`);
                    this._finalizeFileTransfer(fileInfo, senderId, fileKey);
                }, 1500);
                return;
            }
        }
        
        // Mark as processed
        fileInfo._finalized = true;
        
        console.log(`开始处理文件 ${fileInfo.name}, 大小: ${fileInfo.bytesReceived}/${fileInfo.size} 字节, 收到块数: ${fileInfo.chunksReceived}/${fileInfo.totalChunks}`);
        
        try {
            // 检查是否有索引信息并排序数据
            if (fileInfo.chunksWithIndex && fileInfo.chunksWithIndex.length > 0) {
                console.log(`对 ${fileInfo.chunksWithIndex.length} 个数据块进行排序`);
                
                // 先过滤掉任何无效数据块
                fileInfo.chunksWithIndex = fileInfo.chunksWithIndex.filter(chunk => 
                    chunk && chunk.data && chunk.data.byteLength > 0 && chunk.index > 0
                );
                
                // 检查索引是否连续
                const indices = fileInfo.chunksWithIndex.map(chunk => chunk.index).sort((a, b) => a - b);
                const hasGaps = indices.some((val, idx) => 
                    idx > 0 && val !== indices[idx-1] + 1
                );
                
                if (hasGaps) {
                    console.warn(`文件 ${fileInfo.name} 的数据块不连续，缺少部分块`);
                    
                    // 找出缺失的块
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
                
                // 按索引排序
                fileInfo.chunksWithIndex.sort((a, b) => a.index - b.index);
                
                // 记录排序后的索引，辅助调试
                const sortedIndices = fileInfo.chunksWithIndex.map(chunk => chunk.index);
                console.log(`排序后的块索引: ${sortedIndices[0]}...${sortedIndices[sortedIndices.length-1]}`);
                
                // 提取排序后的数据
                fileInfo.data = fileInfo.chunksWithIndex.map(item => item.data);
            } else {
                console.warn(`文件 ${fileInfo.name} 没有索引信息，使用接收顺序`);
            }
            
            // 确保所有数据块有效
            fileInfo.data = fileInfo.data.filter(chunk => chunk && chunk.byteLength > 0);
            
            // 验证数据合理性
            if (fileInfo.data.length === 0) {
                throw new Error('没有有效的数据块');
            }
            
            if (fileInfo.data.length < fileInfo.chunksReceived * 0.8) {
                console.warn(`文件数据块数量异常: 报告接收 ${fileInfo.chunksReceived} 块，但仅有 ${fileInfo.data.length} 块有效`);
            }
            
            // 使用高效的一次性构建方式创建Blob
            console.log(`创建文件Blob，${fileInfo.data.length} 个数据块，预计大小 ${fileInfo.size} 字节`);
            const blob = new Blob(fileInfo.data, {type: fileInfo.mime || 'application/octet-stream'});
            
            // 验证大小
            console.log(`验证文件大小: 预期 ${fileInfo.size} 字节, 实际 ${blob.size} 字节`);
            
            if (fileInfo.size > 0 && Math.abs(blob.size - fileInfo.size) > fileInfo.size * 0.02) {
                console.warn(`文件大小不匹配: ${fileInfo.name} 预期 ${fileInfo.size} 字节, 实际 ${blob.size} 字节 (${Math.abs(blob.size - fileInfo.size) / fileInfo.size * 100}% 差异)`);
            }
            
            // 释放内存
            fileInfo.data = null;
            fileInfo.chunksWithIndex = null;
            
            // 成功完成
            console.log(`成功完成文件传输: ${fileInfo.name} (${blob.size} 字节)`);
            
            // 通知UI和应用
            Events.fire('file-received', {
                name: fileInfo.name || '未命名文件',
                mime: fileInfo.mime || 'application/octet-stream',
                size: blob.size,
                blob: blob,
                sender: fileInfo.sender || senderId
            });
            
            // 发送反馈
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
            // 清理资源
            delete this._fileInfo[fileKey || senderId];
            
            // 仅当这是当前正在处理的文件时才清除lastBinaryId
            if (this._lastBinaryId === fileKey) {
                this._lastBinaryId = null;
            }
        }
    }

    // 获取自己的设备ID
    getSelfId() {
        return this._selfId;
    }

    // 心跳机制保持连接活跃
    _startHeartbeat() {
        this._stopHeartbeat();
        this._heartbeatInterval = setInterval(() => {
            if (this._isConnected()) {
                this.send({ type: 'heartbeat' });
            }
        }, 30000); // 每30秒发送一次心跳
    }
    
    _resetHeartbeat() {
        // 可以在这里重置心跳计时器，暂不实现
    }
    
    _stopHeartbeat() {
        if (this._heartbeatInterval) {
            clearInterval(this._heartbeatInterval);
            this._heartbeatInterval = null;
        }
    }
}

class Peer {

    constructor(serverConnection, peerId) {
        this._server = serverConnection;
        this._peerId = peerId;
        this._filesQueue = [];
        this._busy = false;
    }

    sendJSON(message) {
        this._send(JSON.stringify(message));
    }

    sendFiles(files) {
        // 创建文件队列
        const fileQueue = Array.from(files);
        if (fileQueue.length === 0) return;
        
        // 递归处理文件队列
        const processNextFile = () => {
            if (fileQueue.length === 0) return;
            
            const file = fileQueue.shift();
            // Generate unique file ID
            const fileId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            
            // Send file metadata
            this._send({
                type: 'file',
                name: file.name,
                mime: file.type,
                size: file.size,
                fileId: fileId
            });
            
            // 降低块大小，提高可靠性
            const chunkSize = 256 * 1024; // 从64KB提高到256KB，提高传输速度
            let offset = 0;
            let chunkCount = Math.ceil(file.size / chunkSize);
            let sentChunks = 0;
            
            // File transfer start marker
            console.log(`开始文件传输: ${file.name}, 大小: ${file.size} 字节, 块数: ${chunkCount}, 目标: ${this._peerId}`);
            
            // 序列化传输，确保顺序
            const processFile = async () => {
                // 按顺序处理每个块，不使用并行传输
                for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
                    const start = chunkIndex * chunkSize;
                    const end = Math.min(start + chunkSize, file.size);
                    const slice = file.slice(start, end);
                    
                    try {
                        // 读取文件块
                        const chunk = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = e => resolve(e.target.result);
                            reader.onerror = e => reject(e);
                            reader.readAsArrayBuffer(slice);
                        });
                        
                        // 发送控制消息
                        this._send({
                            type: 'file-chunk-header',
                            size: chunk.byteLength,
                            offset: start,
                            totalSize: file.size,
                            currentChunk: chunkIndex + 1,
                            totalChunks: chunkCount,
                            fileId: fileId,
                            name: file.name // 每个块头都包含文件名，提高可靠性
                        });
                        
                        // 等待一小段时间确保控制消息先发送
                        await new Promise(resolve => setTimeout(resolve, 5));
                        
                        // 发送二进制数据
                        this._server.sendBinary(chunk);
                        
                        // 更新计数
                        sentChunks++;
                        
                        // 更新进度
                        const progress = Math.min(1, (start + chunk.byteLength) / file.size);
                        Events.fire('file-progress', {
                            recipient: this._peerId,
                            progress: progress,
                            name: file.name
                        });
                        
                        // 每个块后短暂延迟，防止浏览器和服务器缓冲区溢出
                        await new Promise(resolve => setTimeout(resolve, 2));
                    } catch (error) {
                        console.error(`处理文件块错误 (${chunkIndex+1}/${chunkCount}):`, error);
                        // 重试当前块 (最多3次)
                        let retries = 0;
                        let success = false;
                        
                        while (retries < 3 && !success) {
                            try {
                                console.log(`重试发送文件块 ${chunkIndex+1}/${chunkCount} (第${retries+1}次尝试)`);
                                
                                // 等待一小段时间后重试
                                await new Promise(resolve => setTimeout(resolve, 500));
                                
                                const chunk = await new Promise((resolve, reject) => {
                                    const reader = new FileReader();
                                    reader.onload = e => resolve(e.target.result);
                                    reader.onerror = e => reject(e);
                                    reader.readAsArrayBuffer(slice);
                                });
                                
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
                                this._server.sendBinary(chunk);
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
                
                // 文件块全部发送完成后，等待确认所有数据已到达
                await new Promise(resolve => setTimeout(resolve, 200));
                
                // 发送文件传输完成标记
                this._send({
                    type: 'file-transfer-complete',
                    name: file.name,
                    size: file.size,
                    chunkCount: sentChunks,
                    fileId: fileId,
                    isLast: true
                });
                
                console.log(`文件传输完成: ${file.name}, 总大小: ${file.size} 字节, 已发送块数: ${sentChunks}`);
                
                // 再次确认接收方已处理完所有块
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // 再发送一次完成标记，确保接收方能正确处理
                this._send({
                    type: 'file-transfer-complete',
                    name: file.name,
                    size: file.size,
                    chunkCount: sentChunks,
                    fileId: fileId,
                    isLast: true,
                    isFinalConfirmation: true
                });
                
                // 通知UI
                Events.fire('notify-user', {
                    message: `文件 ${file.name} 传输完成`,
                    timeout: 3000
                });
            };
            
            // 处理当前文件，然后继续处理队列中的下一个文件
            processFile()
                .then(() => {
                    // 处理下一个文件前，确保当前文件已完全处理
                    console.log(`等待处理下一个文件...`);
                    setTimeout(processNextFile, 2000);
                })
                .catch(error => {
                    console.error('文件传输过程中出错:', error);
                    Events.fire('notify-user', {
                        message: '文件传输失败: ' + file.name,
                        timeout: 5000
                    });
                    // 继续处理下一个文件
                    setTimeout(processNextFile, 2000);
                });
        };
        
        // 开始处理第一个文件
        processNextFile();
    }

    _onPartitionEnd(offset) {
        this.sendJSON({ type: 'partition', offset: offset });
    }

    _onReceivedPartitionEnd(offset) {
        this.sendJSON({ type: 'partition-received', offset: offset });
    }

    _sendNextPartition() {
        if (!this._chunker || this._chunker.isFileEnd()) return;
        this._chunker.nextPartition();
    }

    _sendProgress(progress) {
        this.sendJSON({ type: 'progress', progress: progress });
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
            case 'partition':
                this._onReceivedPartitionEnd(message);
                break;
            case 'partition-received':
                this._sendNextPartition();
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

        // occasionally notify sender about our progress 
        if (progress - this._lastProgress < 0.01) return;
        this._lastProgress = progress;
        this._sendProgress(progress);
    }

    _onDownloadProgress(progress) {
        Events.fire('file-progress', { sender: this._peerId, progress: progress });
    }

    _onFileReceived(proxyFile) {
        Events.fire('file-received', proxyFile);
        
        // 发送传输历史事件
        const peerName = this._peerId ? document.querySelector('[data-peer-id="' + this._peerId + '"] .name').textContent : '';
        Events.fire('file-received', {
            name: proxyFile.name,
            mime: proxyFile.mime,
            size: proxyFile.size,
            peerName: peerName
        });
    }

    _onTransferCompleted() {
        this._onDownloadProgress(1);
        this._reader = null;
        this._busy = false;
        this._dequeueFile();
        Events.fire('notify-user', {
            message: '文件传输完成',
            persistent: false
        });
        
        this.sendJSON({ type: 'transfer-complete' });
    }

    sendText(text) {
        const unescaped = btoa(unescape(encodeURIComponent(text)));
        this.sendJSON({ type: 'text', text: unescaped });
        
        // 发送文本传输历史事件
        const peerName = this._peerId ? document.querySelector('[data-peer-id="' + this._peerId + '"] .name').textContent : '';
        Events.fire('text-sent', {
            text: text,
            peerName: peerName
        });
    }

    _onTextReceived(message) {
        try {
            const escaped = decodeURIComponent(escape(atob(message.text)));
            
            // 获取发送者名称
            let peerName = '';
            const peerElement = document.getElementById(this._peerId);
            if (peerElement) {
                const nameElement = peerElement.querySelector('.name');
                if (nameElement) {
                    peerName = nameElement.textContent;
                }
            }
            
            // 触发单一事件
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
        if (!peerId) return; // we will listen for a caller
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
            reliable: true // Obsolete. See https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/reliable
        });
        channel.onopen = e => this._onChannelOpened(e);
        this._conn.createOffer().then(d => this._onDescription(d)).catch(e => this._onError(e));
    }

    _onDescription(description) {
        // description.sdp = description.sdp.replace('b=AS:30', 'b=AS:1638400');
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
        if (!this.isCaller) return;
        this._connect(this._peerId, true); // reopen the channel
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
        // check if channel is open. otherwise create one
        if (this._isConnected() || this._isConnecting()) return;
        this._connect(this._peerId, this._isCaller);
    }

    _isConnected() {
        return this._channel && this._channel.readyState === 'open';
    }

    _isConnecting() {
        return this._channel && this._channel.readyState === 'connecting';
    }
}

class PeersManager {

    constructor(serverConnection) {
        this.peers = {};
        this._server = serverConnection;
        this._selfId = null;
        
        // 监听事件
        Events.on('signal', e => this._onMessage(e.detail));
        Events.on('peers', e => this._onPeers(e.detail));
        Events.on('files-selected', e => this._onFilesSelected(e.detail));
        Events.on('send-text', e => this._onSendText(e.detail));
        Events.on('peer-left', e => this._onPeerLeft(e.detail));
        Events.on('peer-joined', e => this._onPeerJoined(e.detail));
        Events.on('display-name', e => {
            // 保存自己的ID
            if (e.detail && e.detail.message && e.detail.message.peerId) {
                const oldId = this._selfId;
                this._selfId = e.detail.message.peerId;
                console.log(`PeersManager: 设置自身ID为 ${this._selfId}${oldId ? ` (原ID: ${oldId})` : ''}`);
                
                // 更新页面显示元素的自己的设备ID
                const selfElement = document.getElementById('displayName');
                if (selfElement) {
                    selfElement.dataset.selfId = this._selfId;
                }
            }
        });
        
        // 初始化调试辅助函数
        this._setupDebugHelpers();
    }
    
    // 添加调试辅助函数
    _setupDebugHelpers() {
        // 添加全局函数，用于在控制台查看当前peers列表
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
        
        // 当收到空列表时，可能是重新连接，保留现有连接
        if (peers.length === 0) {
            console.log('收到空的对等设备列表，保留现有连接');
            return;
        }
        
        // 创建设备ID映射，用于验证
        const peerIds = peers.map(p => p.id);
        console.log('有效的对等设备ID列表:', peerIds);
        
        // 移除不在新列表中的旧连接
        for (const oldPeerId in this.peers) {
            if (!peerIds.includes(oldPeerId)) {
                console.log(`移除不再存在的peer连接: ${oldPeerId}`);
                this._onPeerLeft(oldPeerId);
            }
        }
        
        // 处理每个对等设备
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
        
        // 记录目标设备ID
        console.log(`正在尝试发送文件到设备: ${message.to}`);
        
        // 尝试查找对应的Peer，如果不存在则创建新的WSPeer
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
        
        // 记录目标设备ID
        console.log(`正在尝试发送文本到设备: ${message.to}`);
        
        // 尝试查找对应的Peer，如果不存在则创建新的WSPeer
        if (!this.peers[message.to]) {
            console.log(`目标设备未在peers列表中，尝试创建新的WSPeer连接: ${message.to}`);
            console.log(`现有的peers: ${Object.keys(this.peers).join(', ')}`);
            this.peers[message.to] = new WSPeer(this._server, message.to);
        }
        
        this.peers[message.to].sendText(message.text);
    }

    _onPeerLeft(peerId) {
        const peer = this.peers[peerId];
        delete this.peers[peerId];
        if (!peer || !peer._peer) return;
        peer._peer.close();
    }

    _onPeerJoined(peer) {
        console.log(`收到peer加入事件: ${peer.id}`, peer);
        // 如果不存在此设备，则创建新连接
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
    }

    _send(message) {
        message.to = this._peerId;
        this._server.send(message);
    }

    sendText(text) {
        // 使用与RTCPeer相同的编码方式
        const unescaped = btoa(unescape(encodeURIComponent(text)));
        this._send({
            type: 'text',
            text: unescaped
        });
        
        // 发送文本传输历史事件
        const peerName = this._peerId ? document.querySelector(`[id="${this._peerId}"] .name`).textContent : '';
        Events.fire('text-sent', {
            text: text,
            peerName: peerName
        });
    }

    sendFiles(files) {
        // 创建文件队列
        const fileQueue = Array.from(files);
        if (fileQueue.length === 0) return;
        
        // 递归处理文件队列
        const processNextFile = () => {
            if (fileQueue.length === 0) return;
            
            const file = fileQueue.shift();
            // Generate unique file ID
            const fileId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            
            // Send file metadata
            this._send({
                type: 'file',
                name: file.name,
                mime: file.type,
                size: file.size,
                fileId: fileId
            });
            
            // 降低块大小，提高可靠性
            const chunkSize = 256 * 1024; // 从64KB提高到256KB，提高传输速度
            let offset = 0;
            let chunkCount = Math.ceil(file.size / chunkSize);
            let sentChunks = 0;
            
            // File transfer start marker
            console.log(`开始文件传输: ${file.name}, 大小: ${file.size} 字节, 块数: ${chunkCount}, 目标: ${this._peerId}`);
            
            // 序列化传输，确保顺序
            const processFile = async () => {
                // 按顺序处理每个块，不使用并行传输
                for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
                    const start = chunkIndex * chunkSize;
                    const end = Math.min(start + chunkSize, file.size);
                    const slice = file.slice(start, end);
                    
                    try {
                        // 读取文件块
                        const chunk = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = e => resolve(e.target.result);
                            reader.onerror = e => reject(e);
                            reader.readAsArrayBuffer(slice);
                        });
                        
                        // 发送控制消息
                        this._send({
                            type: 'file-chunk-header',
                            size: chunk.byteLength,
                            offset: start,
                            totalSize: file.size,
                            currentChunk: chunkIndex + 1,
                            totalChunks: chunkCount,
                            fileId: fileId,
                            name: file.name // 每个块头都包含文件名，提高可靠性
                        });
                        
                        // 等待一小段时间确保控制消息先发送
                        await new Promise(resolve => setTimeout(resolve, 5));
                        
                        // 发送二进制数据
                        this._server.sendBinary(chunk);
                        
                        // 更新计数
                        sentChunks++;
                        
                        // 更新进度
                        const progress = Math.min(1, (start + chunk.byteLength) / file.size);
                        Events.fire('file-progress', {
                            recipient: this._peerId,
                            progress: progress,
                            name: file.name
                        });
                        
                        // 每个块后短暂延迟，防止浏览器和服务器缓冲区溢出
                        await new Promise(resolve => setTimeout(resolve, 2));
                    } catch (error) {
                        console.error(`处理文件块错误 (${chunkIndex+1}/${chunkCount}):`, error);
                        // 重试当前块 (最多3次)
                        let retries = 0;
                        let success = false;
                        
                        while (retries < 3 && !success) {
                            try {
                                console.log(`重试发送文件块 ${chunkIndex+1}/${chunkCount} (第${retries+1}次尝试)`);
                                
                                // 等待一小段时间后重试
                                await new Promise(resolve => setTimeout(resolve, 500));
                                
                                const chunk = await new Promise((resolve, reject) => {
                                    const reader = new FileReader();
                                    reader.onload = e => resolve(e.target.result);
                                    reader.onerror = e => reject(e);
                                    reader.readAsArrayBuffer(slice);
                                });
                                
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
                                this._server.sendBinary(chunk);
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
                
                // 文件块全部发送完成后，等待确认所有数据已到达
                await new Promise(resolve => setTimeout(resolve, 200));
                
                // 发送文件传输完成标记
                this._send({
                    type: 'file-transfer-complete',
                    name: file.name,
                    size: file.size,
                    chunkCount: sentChunks,
                    fileId: fileId,
                    isLast: true
                });
                
                console.log(`文件传输完成: ${file.name}, 总大小: ${file.size} 字节, 已发送块数: ${sentChunks}`);
                
                // 再次确认接收方已处理完所有块
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // 再发送一次完成标记，确保接收方能正确处理
                this._send({
                    type: 'file-transfer-complete',
                    name: file.name,
                    size: file.size,
                    chunkCount: sentChunks,
                    fileId: fileId,
                    isLast: true,
                    isFinalConfirmation: true
                });
                
                // 通知UI
                Events.fire('notify-user', {
                    message: `文件 ${file.name} 传输完成`,
                    timeout: 3000
                });
            };
            
            // 处理当前文件，然后继续处理队列中的下一个文件
            processFile()
                .then(() => {
                    // 处理下一个文件前，确保当前文件已完全处理
                    console.log(`等待处理下一个文件...`);
                    setTimeout(processNextFile, 2000);
                })
                .catch(error => {
                    console.error('文件传输过程中出错:', error);
                    Events.fire('notify-user', {
                        message: '文件传输失败: ' + file.name,
                        timeout: 5000
                    });
                    // 继续处理下一个文件
                    setTimeout(processNextFile, 2000);
                });
        };
        
        // 开始处理第一个文件
        processNextFile();
    }

    refresh() {
        // 保持连接
    }
}

class FileChunker {

    constructor(file, onChunk, onPartitionEnd) {
        this._chunkSize = 256000; // 从64KB提高到256KB，提高传输速度
        this._maxPartitionSize = 5e6; // 从1MB提高到5MB的分区大小
        this._offset = 0;
        this._partitionSize = 0;
        this._file = file;
        this._onChunk = onChunk;
        this._onPartitionEnd = onPartitionEnd;
        this._reader = new FileReader();
        this._reader.addEventListener('load', e => this._onChunkRead(e.target.result));
    }

    nextPartition() {
        this._partitionSize = 0;
        this._readChunk();
    }

    _readChunk() {
        const chunk = this._file.slice(this._offset, this._offset + this._chunkSize);
        this._reader.readAsArrayBuffer(chunk);
    }

    _onChunkRead(chunk) {
        this._offset += chunk.byteLength;
        this._partitionSize += chunk.byteLength;
        this._onChunk(chunk);
        if (this.isFileEnd()) return;
        if (this._isPartitionEnd()) {
            this._onPartitionEnd(this._offset);
            return;
        }
        this._readChunk();
    }

    repeatPartition() {
        this._offset -= this._partitionSize;
        this._nextPartition();
    }

    _isPartitionEnd() {
        return this._partitionSize >= this._maxPartitionSize;
    }

    isFileEnd() {
        return this._offset >= this._file.size;
    }

    get progress() {
        return this._offset / this._file.size;
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
        // we are done
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
