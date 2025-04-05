window.URL = window.URL || window.webkitURL;
window.isRtcSupported = !!(window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection);

class ServerConnection {

    constructor() {
        this._connect();
        Events.on('beforeunload', e => this._disconnect());
        Events.on('pagehide', e => this._disconnect());
        document.addEventListener('visibilitychange', e => this._onVisibilityChange());
        this._connectLossCount = 0;
        this._fileInfo = {};
        this._lastBinaryId = null;
        this._selfId = null; // 存储自己的设备ID
    }

    _connect() {
        clearTimeout(this._reconnectTimer);
        if (this._isConnected() || this._isConnecting()) return;
        const ws = new WebSocket(this._endpoint());
        ws.binaryType = 'arraybuffer';
        ws.onopen = e => {
            console.log('WS: 服务器已连接');
            // 清除断开连接提示消息
            Events.fire('notify-user', {
                message: '连接已恢复',
                timeout: 3000,
                persistent: false
            });
        };
        ws.onmessage = e => {
            // 处理二进制数据
            if (e.data instanceof ArrayBuffer) {
                this._onBinaryData(e.data);
            } else {
                // 处理文本消息
                this._onMessage(e.data);
            }
        };
        ws.onclose = e => this._onDisconnect();
        ws.onerror = e => console.error(e);
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
                // 存储服务器分配的peerId
                if (msg.message && msg.message.peerId) {
                    console.log('接收到服务器分配的peerId:', msg.message.peerId);
                    this._selfId = msg.message.peerId;
                    // 触发事件通知UI更新
                    msg.message.selfId = msg.message.peerId;
                }
                Events.fire('display-name', msg);
                break;
            case 'file':
                // 处理文件消息
                // 不直接触发file-received事件，而是收集文件元数据等待后续传输
                if (!this._fileInfo) this._fileInfo = {};
                
                // 使用文件ID而不是发送者ID作为键，允许一个发送者同时发送多个文件
                const fileId = msg.fileId || msg.sender;
                
                this._fileInfo[fileId] = {
                    name: msg.name,
                    mime: msg.mime,
                    size: msg.size,
                    sender: msg.sender,
                    fileId: msg.fileId,
                    bytesReceived: 0,
                    chunksReceived: 0,
                    totalChunks: Math.ceil(msg.size / (64 * 1024)),
                    data: []
                };
                
                console.log('接收到文件元数据:', msg.name, msg.size, '文件ID:', msg.fileId || '未指定');
                break;
            case 'file-chunk':
                // 处理文件块数据
                if (!this._fileInfo || !this._fileInfo[msg.sender]) {
                    console.error('收到文件块但没有元数据');
                    break;
                }
                
                const fileInfo = this._fileInfo[msg.sender];
                fileInfo.bytesReceived += msg.chunk.byteLength;
                fileInfo.data.push(msg.chunk);
                
                // 更新进度
                const progress = fileInfo.bytesReceived / fileInfo.size;
                Events.fire('file-progress', {
                    sender: msg.sender,
                    progress: Math.min(1, progress)
                });
                
                // 检查是否传输完成
                if (fileInfo.bytesReceived >= fileInfo.size) {
                    // 创建完整的文件blob
                    const blob = new Blob(fileInfo.data, {type: fileInfo.mime});
                    
                    // 触发文件接收事件
                    Events.fire('file-received', {
                        name: fileInfo.name,
                        mime: fileInfo.mime,
                        size: fileInfo.size,
                        blob: blob,
                        sender: fileInfo.sender
                    });
                    
                    // 清理存储
                    delete this._fileInfo[msg.sender];
                }
                break;
            case 'file-chunk-header':
                // 记录当前接收的文件ID和预期大小，用于后续的二进制数据处理
                const chunkFileId = msg.fileId || msg.sender;
                this._lastBinaryId = chunkFileId;
                
                // 确保文件信息存在
                if (!this._fileInfo || !this._fileInfo[chunkFileId]) {
                    console.error('收到文件块头信息但没有相关文件元数据，尝试创建临时记录');
                    // 创建临时记录以便接收数据
                    if (!this._fileInfo) this._fileInfo = {};
                    this._fileInfo[chunkFileId] = {
                        name: '未知文件',
                        mime: 'application/octet-stream',
                        size: msg.totalSize || 0,
                        sender: msg.sender,
                        fileId: msg.fileId,
                        bytesReceived: 0,
                        offset: msg.offset || 0,
                        chunksReceived: msg.currentChunk ? msg.currentChunk - 1 : 0,
                        totalChunks: msg.totalChunks || 0,
                        data: [],
                        expectedChunkSize: msg.size
                    };
                } else {
                    // 保存块信息
                    const fileInfo = this._fileInfo[chunkFileId];
                    fileInfo.expectedChunkSize = msg.size;
                    fileInfo.currentChunkIndex = msg.currentChunk;
                    
                    // 如果提供了偏移量和总大小，更新相关信息
                    if (msg.offset !== undefined) {
                        fileInfo.offset = msg.offset;
                    }
                    if (msg.totalSize && !fileInfo.size) {
                        fileInfo.size = msg.totalSize;
                    }
                    if (msg.totalChunks && !fileInfo.totalChunks) {
                        fileInfo.totalChunks = msg.totalChunks;
                    }
                }
                
                console.log(`预期接收文件块，大小: ${msg.size} 字节，块: ${msg.currentChunk}/${msg.totalChunks}，文件ID: ${msg.fileId || '未指定'}`);
                break;
            case 'file-transfer-complete':
                // 处理文件传输完成消息
                const transferFileId = msg.fileId || msg.sender;
                console.log(`接收到文件传输完成消息: ${msg.name}, 大小: ${msg.size} 字节, 块数: ${msg.chunkCount}, 文件ID: ${transferFileId}, 是否最后: ${msg.isLast}`);
                
                // 检查是否有未完成的文件信息
                if (this._fileInfo && this._fileInfo[transferFileId]) {
                    const fileInfo = this._fileInfo[transferFileId];
                    
                    // 确保文件信息的正确性
                    if (msg.size && !fileInfo.size) {
                        fileInfo.size = msg.size;
                    }
                    if (msg.name && (!fileInfo.name || fileInfo.name === '未知文件')) {
                        fileInfo.name = msg.name;
                    }
                    if (msg.chunkCount && (!fileInfo.totalChunks || fileInfo.totalChunks === 0)) {
                        fileInfo.totalChunks = msg.chunkCount;
                    }
                    
                    // 检查是否需要结束传输
                    if (fileInfo.bytesReceived > 0) {
                        console.log(`文件传输完成信号接收: ${fileInfo.name}, 已接收: ${fileInfo.bytesReceived}/${fileInfo.size} 字节, 块: ${fileInfo.chunksReceived}/${msg.chunkCount}`);
                        // 强制完成传输
                        this._finalizeFileTransfer(fileInfo, msg.sender, transferFileId);
                    } else {
                        console.log(`收到文件传输完成消息，但文件 ${fileInfo.name} 未接收到任何数据`);
                    }
                    
                    // 如果是最后的消息，清理lastBinaryId
                    if (msg.isLast && this._lastBinaryId === transferFileId) {
                        console.log(`清理最后二进制ID: ${this._lastBinaryId}`);
                        this._lastBinaryId = null;
                    }
                } else {
                    console.log(`收到文件传输完成消息，但找不到文件信息: ${transferFileId}`);
                }
                break;
            case 'text':
                // 处理WebSocket文本消息
                if (msg.text) {
                    try {
                        // 解码文本，与RTCPeer使用相同的解码方式
                        const escaped = decodeURIComponent(escape(atob(msg.text)));
                        
                        // 获取发送者名称
                        let peerName = '';
                        const peerElement = document.getElementById(msg.sender);
                        if (peerElement) {
                            const nameElement = peerElement.querySelector('.name');
                            if (nameElement) {
                                peerName = nameElement.textContent;
                            }
                        }
                        
                        // 触发单一事件，包含所有需要的信息
                        Events.fire('text-received', {
                            text: escaped,
                            sender: msg.sender,
                            peerName: peerName
                        });
                    } catch (error) {
                        console.error('解码文本消息时出错:', error);
                    }
                }
                break;
            case 'file-received-feedback':
                // 处理文件接收反馈消息
                console.log(`收到文件接收反馈: ${msg.fileName}, 大小: ${msg.size} 字节, 状态: ${msg.success ? '成功' : '失败'}`);
                
                // 显示通知
                Events.fire('notify-user', {
                    message: `文件 ${msg.fileName} 已被对方接收`,
                    timeout: 3000
                });
                break;
            default:
                console.error('WS: unkown message type', msg);
        }
    }

    send(message) {
        if (!this._socket || this._socket.readyState !== WebSocket.OPEN) return;
        this._socket.send(JSON.stringify(message));
    }

    sendBinary(binaryData) {
        if (!this._socket || this._socket.readyState !== WebSocket.OPEN) return;
        this._socket.send(binaryData);
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
        // 处理二进制数据（通常是文件块）
        // 检查是否有等待接收数据的发送者/文件ID
        const fileKey = this._lastBinaryId;
        if (!fileKey || !this._fileInfo || !this._fileInfo[fileKey]) {
            console.error('收到二进制数据但没有相关文件信息，fileKey:', fileKey);
            return;
        }
        
        // 将数据添加到文件信息中
        const fileInfo = this._fileInfo[fileKey];
        if (!fileInfo) {
            console.error('找不到文件信息:', fileKey);
            return;
        }
        
        // 如果文件已经被处理过，则忽略
        if (fileInfo._finalized) {
            console.log(`忽略文件 ${fileInfo.name} 的额外二进制数据，因为文件已完成`);
            return;
        }
        
        // 记录接收到的数据
        console.log(`接收到二进制数据，大小: ${binaryData.byteLength} 字节，文件: ${fileInfo.name || '未知'}, 文件ID: ${fileInfo.fileId || fileKey}, 块: ${fileInfo.chunksReceived + 1}/${fileInfo.totalChunks || '?'}`);
        
        // 确保字节计数是数字类型
        const byteLength = Number(binaryData.byteLength) || 0;
        fileInfo.bytesReceived = Number(fileInfo.bytesReceived) || 0;
        fileInfo.bytesReceived += byteLength;
        fileInfo.data.push(binaryData);
        fileInfo.chunksReceived = (fileInfo.chunksReceived || 0) + 1;
        
        // 确保文件大小是数字类型
        fileInfo.size = Number(fileInfo.size) || 0;
        fileInfo.lastChunkTime = Date.now(); // 记录最近接收块的时间
        
        // 更新进度（仅当文件大小大于0时计算百分比）
        let progressPercent = 0;
        if (fileInfo.size > 0) {
            const progress = fileInfo.bytesReceived / fileInfo.size;
            progressPercent = Math.floor(progress * 100);
        } else if (fileInfo.totalChunks > 0) {
            // 如果知道总块数，使用块数计算进度
            progressPercent = Math.floor((fileInfo.chunksReceived / fileInfo.totalChunks) * 100);
        } else {
            // 如果都不知道，使用一个假定值
            progressPercent = Math.floor((fileInfo.data.length / 10) * 100); // 假设有10个块
        }
        
        console.log(`文件接收进度: ${progressPercent}%, 已接收: ${fileInfo.bytesReceived}/${fileInfo.size || '未知'} 字节, 块: ${fileInfo.chunksReceived}/${fileInfo.totalChunks || '未知'}, 文件: ${fileInfo.name || '未知文件'}`);
        
        Events.fire('file-progress', {
            sender: fileInfo.sender,
            progress: fileInfo.size > 0 ? Math.min(1, fileInfo.bytesReceived / fileInfo.size) : (progressPercent / 100),
            name: fileInfo.name
        });
        
        // 检查传输是否完成
        const isComplete = fileInfo.size > 0 && fileInfo.bytesReceived >= fileInfo.size;
        const isChunksComplete = fileInfo.totalChunks > 0 && fileInfo.chunksReceived >= fileInfo.totalChunks;
        
        // 如果文件已接收完成
        if (isComplete || isChunksComplete) {
            console.log(`文件接收完成: ${fileInfo.name}, 大小: ${fileInfo.bytesReceived} 字节, 块数: ${fileInfo.chunksReceived}/${fileInfo.totalChunks || '?'}`);
            this._finalizeFileTransfer(fileInfo, fileInfo.sender, fileKey);
        } else if (fileInfo.chunksReceived >= 6 && !fileInfo._completionTimer) {
            // 移除自动完成的定时器，我们需要显式完成信号
            console.log(`已接收${fileInfo.chunksReceived}个块，等待文件传输完成信号...`);
        }
    }
    
    _finalizeFileTransfer(fileInfo, senderId, fileKey) {
        // 检查是否已经完成处理，避免重复处理
        if (fileInfo._finalized) {
            console.log(`文件 ${fileInfo.name} 已经处理过，跳过重复处理`);
            return;
        }
        
        // 标记为已处理
        fileInfo._finalized = true;
        
        console.log(`完成文件传输: ${fileInfo.name}, 大小: ${fileInfo.bytesReceived} 字节, 块数: ${fileInfo.chunksReceived}`);
        
        // 创建完整的文件blob
        const blob = new Blob(fileInfo.data, {type: fileInfo.mime});
        
        // 检查文件大小是否与预期一致
        if (fileInfo.size > 0 && blob.size !== fileInfo.size) {
            console.warn(`文件大小不匹配: 预期 ${fileInfo.size} 字节, 实际 ${blob.size} 字节`);
            // 如果文件大小偏差过大，可能是传输错误
            if (Math.abs(blob.size - fileInfo.size) > fileInfo.size * 0.05) {
                console.error(`文件大小偏差过大，可能传输不完整`);
            }
        }
        
        // 清除正在进行中的任何计时器
        if (fileInfo._completionTimer) {
            clearTimeout(fileInfo._completionTimer);
            fileInfo._completionTimer = null;
        }
        
        // 触发文件接收事件
        Events.fire('file-received', {
            name: fileInfo.name || '未命名文件',
            mime: fileInfo.mime || 'application/octet-stream',
            size: fileInfo.bytesReceived,
            blob: blob,
            sender: fileInfo.sender || senderId
        });
        
        // 发送反馈
        this.send({
            type: 'file-received-feedback',
            to: senderId,
            fileName: fileInfo.name,
            fileId: fileInfo.fileId,
            size: fileInfo.bytesReceived,
            chunksReceived: fileInfo.chunksReceived,
            success: true
        });
        
        // 清理存储
        delete this._fileInfo[fileKey || senderId];
        if (this._lastBinaryId === fileKey) {
            this._lastBinaryId = null;
        }
    }

    // 获取自己的设备ID
    getSelfId() {
        return this._selfId;
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
        for (let i = 0; i < files.length; i++) {
            this._filesQueue.push(files[i]);
        }
        if (this._busy) return;
        this._dequeueFile();
    }

    _dequeueFile() {
        if (!this._filesQueue.length) return;
        this._busy = true;
        const file = this._filesQueue.shift();
        this._sendFile(file);
    }

    _sendFile(file) {
        this.sendJSON({
            type: 'header',
            name: file.name,
            mime: file.type,
            size: file.size
        });
        this._chunker = new FileChunker(file,
            chunk => this._send(chunk),
            offset => this._onPartitionEnd(offset));
        this._chunker.nextPartition();
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
        Events.on('display-name', e => {
            // 保存自己的ID
            if (e.detail && e.detail.message && e.detail.message.peerId) {
                this._selfId = e.detail.message.peerId;
                console.log('PeersManager: 设置自身ID为', this._selfId);
            }
        });
    }

    _onMessage(message) {
        if (!this.peers[message.sender]) {
            this.peers[message.sender] = new RTCPeer(this._server);
        }
        this.peers[message.sender].onServerMessage(message);
    }

    _onPeers(peers) {
        peers.forEach(peer => {
            if (this.peers[peer.id]) {
                this.peers[peer.id].refresh();
                return;
            }
            if (window.isRtcSupported && peer.rtcSupported) {
                this.peers[peer.id] = new RTCPeer(this._server, peer.id);
            } else {
                this.peers[peer.id] = new WSPeer(this._server, peer.id);
            }
        })
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
        
        // 尝试查找对应的Peer，如果不存在则创建新的WSPeer
        if (!this.peers[message.to]) {
            console.log('目标设备未在peers列表中，尝试创建新的WSPeer连接:', message.to);
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
        
        // 尝试查找对应的Peer，如果不存在则创建新的WSPeer连接
        if (!this.peers[message.to]) {
            console.log('目标设备未在peers列表中，尝试创建新的WSPeer连接:', message.to);
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
        // 使用WebSocket分块发送文件
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            
            // 防止同时发送多个文件
            if (i > 0) {
                console.log(`将在当前文件完成后发送文件: ${file.name}`);
                setTimeout(() => {
                    // 将剩余文件放入队列
                    const remainingFiles = Array.from(files).slice(i);
                    this.sendFiles(remainingFiles);
                }, 1000);
                return; // 仅处理第一个文件，其余放入队列
            }
            
            // 生成唯一文件ID
            const fileId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            
            // 先发送文件元数据
            this._send({
                type: 'file',
                name: file.name,
                mime: file.type,
                size: file.size,
                fileId: fileId
            });
            
            // 设置每个块的大小（64KB）
            const chunkSize = 64 * 1024;
            
            // 创建文件读取器
            const fileReader = new FileReader();
            let offset = 0;
            let chunkCount = Math.ceil(file.size / chunkSize);
            let sentChunks = 0;
            
            // 文件传输开始标记
            console.log(`开始发送文件: ${file.name}, 大小: ${file.size} 字节, 总块数: ${chunkCount}, 目标: ${this._peerId}`);
            
            // 分块读取并发送文件
            const readNextChunk = () => {
                const slice = file.slice(offset, offset + chunkSize);
                fileReader.readAsArrayBuffer(slice);
            };
            
            // 创建完成标记，避免后续文件误认为是同一文件的部分
            const onTransferComplete = () => {
                // 发送文件传输完成标记
                this._send({
                    type: 'file-transfer-complete',
                    name: file.name,
                    size: file.size,
                    chunkCount: sentChunks,
                    fileId: fileId,
                    isLast: true // 标记这是当前文件的最后一条消息
                });
                
                console.log(`文件发送完成: ${file.name}, 总大小: ${file.size} 字节, 发送块数: ${sentChunks}`);
                
                // 通知UI文件传输已完成
                Events.fire('notify-user', {
                    message: `文件 ${file.name} 传输完成`,
                    timeout: 3000
                });
            };
            
            // 处理文件块读取完成事件
            fileReader.onload = (e) => {
                const chunk = e.target.result;
                sentChunks++;
                
                // 先发送控制消息标识即将发送文件块
                this._send({
                    type: 'file-chunk-header',
                    size: chunk.byteLength,
                    offset: offset,             // 添加偏移量信息
                    totalSize: file.size,       // 添加总大小信息
                    currentChunk: sentChunks,   // 当前块编号
                    totalChunks: chunkCount,    // 总块数
                    fileId: fileId              // 文件ID
                });
                
                // 等待一小段时间确保控制消息已发送
                setTimeout(() => {
                    // 直接发送二进制数据
                    this._server.sendBinary(chunk);
                    
                    // 更新偏移量和进度
                    offset += chunk.byteLength;
                    const progress = Math.min(1, offset / file.size);
                    
                    // 发送进度更新
                    Events.fire('file-progress', {
                        recipient: this._peerId,
                        progress: progress,
                        name: file.name
                    });
                    
                    // 如果还有数据，继续读取下一块
                    if (offset < file.size) {
                        // 添加合适的延迟以防止发送过快导致的丢包，但不要太长
                        setTimeout(readNextChunk, 20);
                    } else {
                        // 文件传输完成，延迟一段时间确保最后一块已经发送完毕
                        setTimeout(onTransferComplete, 300);
                    }
                }, 20);
            };
            
            // 处理文件读取错误
            fileReader.onerror = (error) => {
                console.error('文件读取错误:', error);
                Events.fire('notify-user', {
                    message: '文件传输失败: ' + file.name,
                    timeout: 5000
                });
            };
            
            // 开始读取首个块
            readNextChunk();
        }
    }

    refresh() {
        // 保持连接
    }
}

class FileChunker {

    constructor(file, onChunk, onPartitionEnd) {
        this._chunkSize = 64000; // 64 KB
        this._maxPartitionSize = 1e6; // 1 MB
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
