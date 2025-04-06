var process = require('process')
// Handle SIGINT
process.on('SIGINT', () => {
  log("SIGINT received, exiting...");
  process.exit(0);
})

// Handle SIGTERM
process.on('SIGTERM', () => {
  log("SIGTERM received, exiting...");
  process.exit(0);
})

const parser = require('ua-parser-js');
const { uniqueNamesGenerator, animals, colors } = require('unique-names-generator');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 中文名称字典
const chineseColors = ['红', '橙', '黄', '绿', '青', '蓝', '紫', '黑', '白', '金', '银', '灰'];
const chineseAnimals = ['猫', '狗', '龙', '虎', '兔', '鼠', '牛', '马', '羊', '猴', '鸡', '蛇', '猪', '鹿', '象', '鹰', '鸭', '熊', '狼', '鱼'];

// 添加MIME类型映射
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.woff': 'application/font-woff',
    '.ttf': 'application/font-ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'application/font-otf',
    '.wasm': 'application/wasm',
    '.ogg': 'audio/ogg'
};

// 添加一个日志函数
function log(message) {
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    console.log(`[${timestamp}] ${message}`);
}

class SnapdropServer {

    constructor(port) {
        // 创建HTTP服务器
        this._httpServer = http.createServer((req, res) => this._handleHttpRequest(req, res));
        
        const WebSocket = require('ws');
        this._wss = new WebSocket.Server({ 
            server: this._httpServer,
            path: '/server' 
        });
        this._wss.on('connection', (socket, request) => this._onConnection(new Peer(socket, request)));
        this._wss.on('headers', (headers, response) => this._onHeaders(headers, response));

        this._rooms = {};
        
        // 启动HTTP服务器
        this._httpServer.listen(port, () => {
            log('讯传已在端口 ' + port + ' 上启动');
        });
    }
    
    _handleHttpRequest(req, res) {
        // 默认提供client目录下的文件
        let filePath = path.join(__dirname, '../client', req.url);
        if (req.url === '/' || req.url === '/index.html') {
            filePath = path.join(__dirname, '../client/index.html');
        }
        
        const extname = String(path.extname(filePath)).toLowerCase();
        const contentType = mimeTypes[extname] || 'application/octet-stream';
        
        fs.readFile(filePath, (error, content) => {
            if (error) {
                if(error.code === 'ENOENT') {
                    // 文件不存在
                    res.writeHead(404);
                    res.end('404 未找到');
                } else {
                    // 服务器错误
                    res.writeHead(500);
                    res.end('500 服务器错误: ' + error.code);
                }
            } else {
                // 成功返回文件内容
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content, 'utf-8');
            }
        });
    }

    _onConnection(peer) {
        if (peer.rtcSupported) {
            peer.socket.on('message', message => this._onRtcMessage(peer, message));
        } else {
            peer.socket.on('message', message => {
                // Handle binary data
                if (message instanceof Buffer) {
                    // Find recipient using last peer ID
                    let recipient = null;
                    
                    if (peer.lastPeerId) {
                        // 首先在同一IP房间中查找
                        if (this._rooms[peer.ip] && this._rooms[peer.ip][peer.lastPeerId]) {
                            recipient = this._rooms[peer.ip][peer.lastPeerId];
                        }
                        // 如果在同一IP房间中没找到，则在全局房间中查找
                        else if (this._rooms['global'] && this._rooms['global'][peer.lastPeerId]) {
                            recipient = this._rooms['global'][peer.lastPeerId];
                        }
                    }
                    
                    if (recipient) {
                        this._sendBinary(recipient, message);
                        return;
                    }
                    
                    // 如果找不到收件人但有最后的peer ID，记录日志但不要重复记录太多
                    if (peer.lastPeerId && (!peer.lastBinaryErrorTime || (Date.now() - peer.lastBinaryErrorTime) > 5000)) {
                        log(`无法转发二进制数据，收件人 ${peer.lastPeerId} 未找到`);
                        peer.lastBinaryErrorTime = Date.now();
                    } else if (!peer.lastPeerId && (!peer.lastBinaryErrorTime || (Date.now() - peer.lastBinaryErrorTime) > 5000)) {
                        log(`无法转发二进制数据，收件人未知，请先发送文本消息建立连接`);
                        peer.lastBinaryErrorTime = Date.now();
                    }
                    return;
                }
                
                // Handle text messages
                this._onMessage(peer, message);
            });
        }
        
        // Send welcome message to newly connected peer
        this._send(peer, {
            type: 'display-name',
            message: {
                displayName: peer.name.displayName,
                deviceName: peer.name.deviceName,
                peerId: peer.id,  // 发送完整的复合ID
                originalId: peer.originalId // 同时发送原始ID，以便客户端可以使用
            }
        });
        
        this._joinRoom(peer);
        this._keepAlive(peer);
    }

    _onHeaders(headers, response) {
        // 检查是否已经有效的peerid cookie
        let hasPeerId = false;
        if (response.headers.cookie) {
            const peerIdMatch = response.headers.cookie.match(/peerid=([^;]+)/);
            if (peerIdMatch && peerIdMatch[1] && 
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(peerIdMatch[1])) {
                hasPeerId = true;
            }
        }
        
        // 如果没有有效的peerid，设置一个新的
        if (!hasPeerId) {
            response.peerId = Peer.uuid();
            headers.push('Set-Cookie: peerid=' + response.peerId + "; SameSite=Strict; Secure; Max-Age=2592000"); // 设置30天有效期
            log('为新客户端设置cookie: ' + response.peerId);
        }
    }

    _onMessage(sender, message) {
        // Try to parse message 
        try {
            message = JSON.parse(message);
        } catch (e) {
            return; // TODO: handle malformed JSON
        }

        switch (message.type) {
            case 'disconnect':
                this._leaveRoom(sender);
                break;
            case 'pong':
                sender.lastBeat = Date.now();
                break;
            case 'refresh-connection':
                // 处理客户端刷新连接请求
                log(`收到设备 ${sender.id} 的连接刷新请求`);
                // 更新最后心跳时间
                sender.lastBeat = Date.now();
                // 发送确认消息
                this._send(sender, {
                    type: 'connection-refreshed',
                    timestamp: Date.now()
                });
                // 通知其他设备此设备仍然活跃
                this._notifyPeerUpdate(sender);
                break;
            case 'user-info':
                // 处理用户信息更新
                if (message.userName || message.deviceName) {
                    log(`收到用户 ${sender.id} 的信息更新请求`);
                    
                    let displayNameUpdated = false;
                    
                    // 更新用户名
                    if (message.userName) {
                        sender.userProvidedName = message.userName;
                        sender.name.displayName = message.userName;
                        displayNameUpdated = true;
                        log(`用户 ${sender.id} 更新名称为: ${message.userName}`);
                        
                        // 设置cookie来持久化存储用户名
                        try {
                            // 发送一个带有用户名的cookie给客户端
                            const encodedUserName = encodeURIComponent(message.userName);
                            sender.socket.send(JSON.stringify({
                                type: 'set-cookie',
                                cookie: `username=${encodedUserName}; SameSite=Strict; Secure; Max-Age=31536000; Path=/` // 一年有效期
                            }));
                            log(`已为用户 ${sender.id} 设置用户名cookie: ${encodedUserName}`);
                        } catch (e) {
                            log(`设置用户名cookie时出错: ${e.message}`);
                        }
                    }
                    
                    // 更新设备信息
                    if (message.deviceName && message.model) {
                        sender.name.deviceName = `${message.deviceName} ${message.model}`;
                        log(`用户 ${sender.id} 更新设备信息为: ${sender.name.deviceName}`);
                    } else if (message.deviceName) {
                        sender.name.deviceName = message.deviceName;
                        log(`用户 ${sender.id} 更新设备信息为: ${message.deviceName}`);
                    }
                    
                    // 如果有更新，通知用户自己
                    if (displayNameUpdated) {
                        this._send(sender, {
                            type: 'display-name',
                            message: {
                                displayName: sender.name.displayName,
                                deviceName: sender.name.deviceName,
                                peerId: sender.id
                            }
                        });
                        
                        // 通知其他用户此用户更新了名称
                        log(`正在广播用户 ${sender.id} (${sender.name.displayName}) 的名称更新到所有设备`);
                        this._notifyPeerUpdate(sender);
                    }
                }
                break;
            case 'file':
            case 'file-chunk':
            case 'file-chunk-header':
            case 'file-transfer-complete':
            case 'file-received-feedback':
            case 'text':
                // Add sender info to file, chunk, completion and text messages
                message.sender = sender.id;
                // Continue to relay logic below
            default:
                // Relay message to recipient
                if (message.to && this._rooms[sender.ip]) {
                    const recipientId = message.to; // TODO: sanitize
                    // 首先在同一IP房间中查找
                    let recipient = this._rooms[sender.ip][recipientId];
                    
                    // 如果在同一IP房间中没找到，则在全局房间中查找
                    if (!recipient && this._rooms['global']) {
                        recipient = this._rooms['global'][recipientId];
                    }
                    
                    if (!recipient) {
                        log(`收件人 ${recipientId} 未在房间中找到`);
                        return;
                    }
                    
                    // Clone message to avoid modifying original
                    const msgToSend = JSON.parse(JSON.stringify(message));
                    delete msgToSend.to;
                    // Add sender ID
                    msgToSend.sender = sender.id;
                    
                    // 始终在发送消息前保存对等设备ID，以便处理后续的二进制数据
                    sender.lastPeerId = recipientId;
                    recipient.lastPeerId = sender.id;
                    
                    // 只记录第一次和最后一次文件块传输，或者其他类型的消息
                    const isFileChunkHeader = message.type === 'file-chunk-header';
                    if (!isFileChunkHeader || 
                        (isFileChunkHeader && 
                         (message.currentChunk === 1 || message.currentChunk === message.totalChunks))) {
                        let status = '';
                        if (isFileChunkHeader) {
                            if (message.currentChunk === 1) {
                                status = '开始';
                            } else if (message.currentChunk === message.totalChunks) {
                                status = '最后一块';
                            }
                        }
                        log(`转发消息: ${message.type} ${status} 从 ${sender.id} 到 ${recipientId}`);
                    }
                    
                    this._send(recipient, msgToSend);
                    return;
                }
        }
    }

    _joinRoom(peer) {
        // 创建一个全局房间，所有IP地址都能看到所有设备
        const globalRoomId = 'global';
        
        // 为该IP地址创建一个房间（如果不存在）
        if (!this._rooms[peer.ip]) {
            this._rooms[peer.ip] = {};
        }
        
        // 为全局房间创建一个映射（如果不存在）
        if (!this._rooms[globalRoomId]) {
            this._rooms[globalRoomId] = {};
        }
        
        // 通知IP地址相同房间的所有其他设备
        for (const otherPeerId in this._rooms[peer.ip]) {
            const otherPeer = this._rooms[peer.ip][otherPeerId];
            this._send(otherPeer, {
                type: 'peer-joined',
                peer: peer.getInfo()
            });
        }
        
        // 同时通知全局房间的所有其他设备
        for (const otherPeerId in this._rooms[globalRoomId]) {
            // 避免重复通知
            if (this._rooms[peer.ip] && this._rooms[peer.ip][otherPeerId]) continue;
            
            const otherPeer = this._rooms[globalRoomId][otherPeerId];
            this._send(otherPeer, {
                type: 'peer-joined',
                peer: peer.getInfo()
            });
            
            // 也通知当前设备关于全局房间中的其他设备
            this._send(peer, {
                type: 'peer-joined',
                peer: otherPeer.getInfo()
            });
        }
        
        // 通知当前设备关于当前IP房间中的其他设备
        const otherPeers = [];
        for (const otherPeerId in this._rooms[peer.ip]) {
            otherPeers.push(this._rooms[peer.ip][otherPeerId].getInfo());
        }
        
        // 同时添加全局房间中的其他设备
        for (const otherPeerId in this._rooms[globalRoomId]) {
            // 避免重复添加
            if (this._rooms[peer.ip] && this._rooms[peer.ip][otherPeerId]) continue;
            
            otherPeers.push(this._rooms[globalRoomId][otherPeerId].getInfo());
        }
        
        this._send(peer, {
            type: 'peers',
            peers: otherPeers
        });

        // 将设备添加到对应IP的房间和全局房间
        this._rooms[peer.ip][peer.id] = peer;
        this._rooms[globalRoomId][peer.id] = peer;
        
        log(`设备 ${peer.id} 加入了房间，IP: ${peer.ip}，全局房间设备数: ${Object.keys(this._rooms[globalRoomId]).length}`);
    }

    _leaveRoom(peer) {
        // 检查IP房间是否存在并包含该设备
        const isInIpRoom = this._rooms[peer.ip] && this._rooms[peer.ip][peer.id];
        if (isInIpRoom) {
            this._cancelKeepAlive(this._rooms[peer.ip][peer.id]);
            // 从IP房间删除设备
            delete this._rooms[peer.ip][peer.id];
        }
        
        // 检查全局房间是否存在并包含该设备
        const globalRoomId = 'global';
        const isInGlobalRoom = this._rooms[globalRoomId] && this._rooms[globalRoomId][peer.id];
        if (isInGlobalRoom) {
            // 从全局房间删除设备
            delete this._rooms[globalRoomId][peer.id];
        }
        
        // 关闭socket连接
        peer.socket.terminate();
        
        // 如果IP房间为空，删除IP房间
        if (isInIpRoom && !Object.keys(this._rooms[peer.ip]).length) {
            delete this._rooms[peer.ip];
        }
        
        // 通知所有其他设备
        // 先通知IP房间中的设备
        if (isInIpRoom && this._rooms[peer.ip]) {
            for (const otherPeerId in this._rooms[peer.ip]) {
                const otherPeer = this._rooms[peer.ip][otherPeerId];
                this._send(otherPeer, { type: 'peer-left', peerId: peer.id });
            }
        }
        
        // 再通知全局房间中的设备
        if (isInGlobalRoom && this._rooms[globalRoomId]) {
            for (const otherPeerId in this._rooms[globalRoomId]) {
                // 避免重复通知
                if (this._rooms[peer.ip] && this._rooms[peer.ip][otherPeerId]) continue;
                
                const otherPeer = this._rooms[globalRoomId][otherPeerId];
                this._send(otherPeer, { type: 'peer-left', peerId: peer.id });
            }
        }
        
        log(`设备 ${peer.id} 离开了房间，IP: ${peer.ip}，` + 
            (this._rooms[globalRoomId] ? `全局房间设备数: ${Object.keys(this._rooms[globalRoomId]).length}` : '全局房间已空'));
    }

    _send(peer, message) {
        if (!peer) return;
        if (this._wss.readyState !== this._wss.OPEN) return;
        message = JSON.stringify(message);
        peer.socket.send(message, error => '');
    }

    _sendBinary(peer, binaryData) {
        if (!peer) return;
        if (this._wss.readyState !== this._wss.OPEN) return;
        peer.socket.send(binaryData, error => '');
    }

    _keepAlive(peer) {
        this._cancelKeepAlive(peer);
        var timeout = 30000;
        if (!peer.lastBeat) {
            peer.lastBeat = Date.now();
        }
        if (Date.now() - peer.lastBeat > 2 * timeout) {
            this._leaveRoom(peer);
            return;
        }

        this._send(peer, { type: 'ping' });

        peer.timerId = setTimeout(() => this._keepAlive(peer), timeout);
    }

    _cancelKeepAlive(peer) {
        if (peer && peer.timerId) {
            clearTimeout(peer.timerId);
        }
    }

    _notifyPeerUpdate(updatedPeer) {
        log(`开始通知其他设备 ${updatedPeer.id} 的名称已更新为 ${updatedPeer.name.displayName}`);
        
        // 先通知IP房间中的设备
        if (this._rooms[updatedPeer.ip]) {
            for (const otherPeerId in this._rooms[updatedPeer.ip]) {
                // 不要通知自己
                if (otherPeerId === updatedPeer.id) continue;
                
                const otherPeer = this._rooms[updatedPeer.ip][otherPeerId];
                log(`通知IP房间内设备 ${otherPeerId} 关于 ${updatedPeer.id} 的名称更新`);
                this._send(otherPeer, { 
                    type: 'peer-updated', 
                    peer: updatedPeer.getInfo() 
                });
            }
        }
        
        // 再通知全局房间中的设备
        const globalRoomId = 'global';
        if (this._rooms[globalRoomId]) {
            for (const otherPeerId in this._rooms[globalRoomId]) {
                // 不要通知自己，也不要重复通知IP房间中已通知的设备
                if (otherPeerId === updatedPeer.id || 
                    (this._rooms[updatedPeer.ip] && this._rooms[updatedPeer.ip][otherPeerId])) {
                    continue;
                }
                
                const otherPeer = this._rooms[globalRoomId][otherPeerId];
                log(`通知全局房间内设备 ${otherPeerId} 关于 ${updatedPeer.id} 的名称更新`);
                this._send(otherPeer, { 
                    type: 'peer-updated', 
                    peer: updatedPeer.getInfo() 
                });
            }
        }
        
        // 检查所有房间是否还有其他设备需要通知
        log(`已完成通知设备 ${updatedPeer.id} 的名称更新`);
    }
}



class Peer {

    constructor(socket, request) {
        // set socket
        this.socket = socket;


        // set remote ip
        this._setIP(request);

        // set peer id
        this._setPeerId(request);
        
        // is WebRTC supported ?
        this.rtcSupported = request.url.indexOf('webrtc') > -1;
        
        // 记录最后通信的对等设备ID
        this.lastPeerId = null;
        
        // 记录最后二进制错误的时间，用于限制错误日志频率
        this.lastBinaryErrorTime = 0;
        
        // set name 
        this._setName(request);
        
        // for keepalive
        this.timerId = 0;
        this.lastBeat = Date.now();
    }

    _setIP(request) {
        // 获取客户端IP地址
        let ip;
        const forwarded = request.headers['x-forwarded-for'];
        
        if (forwarded) {
            // 处理代理服务器转发的情况
            ip = forwarded.split(/\s*,\s*/)[0];
        } else if (request.headers['cf-connecting-ip']) {
            // Cloudflare
            ip = request.headers['cf-connecting-ip'];
        } else if (request.headers['x-real-ip']) {
            // Nginx等代理
            ip = request.headers['x-real-ip'];
        } else {
            // 直接连接
            ip = request.connection.remoteAddress;
        }
        
        // IPv4和IPv6处理本地地址
        if (ip == '::1' || ip == '::ffff:127.0.0.1' || ip == '127.0.0.1') {
            ip = '127.0.0.1';
        }
        
        log('客户端连接，IP地址: ' + ip);
        this.ip = ip;
    }

    _setPeerId(request) {
        let peerId = null;
        
        // 首先尝试从请求中直接获取
        if (request.peerId) {
            peerId = request.peerId;
        } else {
            // 否则从cookie中获取
            try {
                const cookies = request.headers.cookie || '';
                const peerIdMatch = cookies.match(/peerid=([^;]+)/);
                
                if (peerIdMatch && peerIdMatch[1]) {
                    // 验证peerid格式是否符合要求（UUID格式）
                    const potentialId = peerIdMatch[1];
                    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(potentialId)) {
                        peerId = potentialId;
                    } else {
                        log('发现无效的peerid格式: ' + potentialId + ' 将生成新ID');
                    }
                }
            } catch (e) {
                console.error('解析cookie时出错:', e);
            }
        }
        
        // 如果没有有效ID，生成一个新的
        if (!peerId) {
            peerId = Peer.uuid();
            log('为客户端生成新ID: ' + peerId);
        }
        
        // 添加设备指纹信息，确保唯一性
        const userAgent = request.headers['user-agent'] || '';
        const deviceFingerprint = userAgent + this.ip;
        const fingerprintHash = deviceFingerprint.hashCode().toString(16);
        
        // 保存原始ID，用于日志和调试
        this.originalId = peerId;
        
        // 生成新的复合ID，确保同一设备使用相同ID
        this.id = peerId + '-' + fingerprintHash.substr(0, 8);
        
        // 记录设备ID分配情况
        log(`设备ID分配: ${this.id} (原始ID: ${this.originalId}, 指纹: ${fingerprintHash.substr(0, 8)})`);
        
        // 检查是否有存储的用户自定义名称
        try {
            // 检查cookie中是否有用户名信息
            const cookies = request.headers.cookie || '';
            const userNameMatch = cookies.match(/username=([^;]+)/);
            
            if (userNameMatch && userNameMatch[1]) {
                // 解码用户名
                try {
                    const decodedName = decodeURIComponent(userNameMatch[1]);
                    this.userProvidedName = decodedName;
                    log(`从cookie加载用户名: ${decodedName} 用于设备: ${this.id}`);
                } catch (e) {
                    log(`解码cookie中的用户名失败: ${e.message}`);
                }
            }
        } catch (e) {
            log(`解析用户名cookie时出错: ${e.message}`);
        }
    }

    toString() {
        return `<Peer id=${this.id} ip=${this.ip} rtcSupported=${this.rtcSupported}>`
    }

    _setName(req) {
        let ua = parser(req.headers['user-agent']);

        let deviceName = '';
        
        if (ua.os && ua.os.name) {
            deviceName = ua.os.name.replace('Mac OS', 'Mac') + ' ';
        }
        
        if (ua.device.model) {
            deviceName += ua.device.model;
        } else {
            deviceName += ua.browser.name;
        }

        if(!deviceName)
            deviceName = '未知设备';

        // 尝试获取用户名称
        let displayName = '';
        
        // 首先检查是否有来自setPeerId读取的cookie中的用户名
        if (this.userProvidedName) {
            displayName = this.userProvidedName;
            log(`使用cookie中存储的用户名: ${displayName}`);
        }
        // 尝试从请求头获取用户名信息
        else if (req.headers['x-user-name']) {
            displayName = req.headers['x-user-name'];
            log(`使用请求头中的用户名: ${displayName}`);
        }
        // 如果没有找到用户名，则检查是否有来自客户端提供的名称
        else if (req.headers['x-device-name']) {
            displayName = req.headers['x-device-name'];
            log(`使用请求头中的设备名称: ${displayName}`);
        }
        
        // 如果仍未找到，则使用随机生成的中文名称
        if (!displayName) {
            // 使用中文名称
            // 使用完整的ID（包括设备指纹）来计算哈希，确保名称唯一性
            const fullId = this.id || '';
            const colorIndex = Math.abs(fullId.hashCode() % chineseColors.length);
            const animalIndex = Math.abs((fullId.hashCode() >> 4) % chineseAnimals.length);
            displayName = chineseColors[colorIndex] + chineseAnimals[animalIndex];
            log(`使用随机生成的名称: ${displayName}`);
        }

        this.name = {
            model: ua.device.model,
            os: ua.os.name,
            browser: ua.browser.name,
            type: ua.device.type,
            deviceName,
            displayName
        };
    }

    getInfo() {
        return {
            id: this.id,
            name: this.name,
            rtcSupported: this.rtcSupported
        }
    }

    // return uuid of form xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    static uuid() {
        let uuid = '',
            ii;
        for (ii = 0; ii < 32; ii += 1) {
            switch (ii) {
                case 8:
                case 20:
                    uuid += '-';
                    uuid += (Math.random() * 16 | 0).toString(16);
                    break;
                case 12:
                    uuid += '-';
                    uuid += '4';
                    break;
                case 16:
                    uuid += '-';
                    uuid += (Math.random() * 4 | 8).toString(16);
                    break;
                default:
                    uuid += (Math.random() * 16 | 0).toString(16);
            }
        }
        return uuid;
    };
}

Object.defineProperty(String.prototype, 'hashCode', {
  value: function() {
    var hash = 0, i, chr;
    for (i = 0; i < this.length; i++) {
      chr   = this.charCodeAt(i);
      hash  = ((hash << 5) - hash) + chr;
      hash |= 0; // Convert to 32bit integer
    }
    return hash;
  }
});

const server = new SnapdropServer(process.env.PORT || 3000);
