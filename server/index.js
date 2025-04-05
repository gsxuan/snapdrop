var process = require('process')
// Handle SIGINT
process.on('SIGINT', () => {
  console.info("SIGINT收到，正在退出...")
  process.exit(0)
})

// Handle SIGTERM
process.on('SIGTERM', () => {
  console.info("SIGTERM收到，正在退出...")
  process.exit(0)
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
            console.log('讯传已在端口', port, '上启动');
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
                // 处理二进制数据
                if (message instanceof Buffer) {
                    // 如果有最后的对等设备ID，用它来查找接收者
                    if (peer.lastPeerId && this._rooms[peer.ip] && this._rooms[peer.ip][peer.lastPeerId]) {
                        const recipient = this._rooms[peer.ip][peer.lastPeerId];
                        if (recipient) {
                            this._sendBinary(recipient, message);
                            return;
                        }
                    }
                    console.log(`无法转发二进制数据，找不到接收者`);
                    return;
                }
                
                // 处理文本消息
                this._onMessage(peer, message);
            });
        }
        
        // 发送欢迎信息给新连接的对等设备
        this._send(peer, {
            type: 'display-name',
            message: {
                displayName: peer.name.displayName,
                deviceName: peer.name.deviceName,
                peerId: peer.id  // 明确发送对等设备ID
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
            if (peerIdMatch && peerIdMatch[1] && peerIdMatch[1].length < 50) {
                hasPeerId = true;
            }
        }
        
        // 如果没有有效的peerid，设置一个新的
        if (!hasPeerId) {
            response.peerId = Peer.uuid();
            headers.push('Set-Cookie: peerid=' + response.peerId + "; SameSite=Strict; Secure");
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
            case 'file':
            case 'file-chunk':
            case 'file-chunk-header':
            case 'file-transfer-complete':
            case 'file-received-feedback':
            case 'text':
                // 文件、文件块、文件传输完成、文件接收反馈和文本消息需要添加发送者信息
                message.sender = sender.id;
                // 转发到接收者，继续执行下面的中继逻辑
            default:
                // relay message to recipient
                if (message.to && this._rooms[sender.ip]) {
                    const recipientId = message.to; // TODO: sanitize
                    const recipient = this._rooms[sender.ip][recipientId];
                    if (!recipient) {
                        console.log(`接收者 ${recipientId} 不存在`);
                        return;
                    }
                    
                    // 复制消息以避免修改原始对象
                    const msgToSend = JSON.parse(JSON.stringify(message));
                    delete msgToSend.to;
                    // 添加发送者ID
                    msgToSend.sender = sender.id;
                    
                    // 记录通信对等设备ID，供二进制传输使用
                    sender.lastPeerId = recipientId;
                    recipient.lastPeerId = sender.id;
                    
                    console.log(`转发消息: ${message.type} 从 ${sender.id} 到 ${recipientId}`);
                    this._send(recipient, msgToSend);
                    return;
                }
        }
    }

    _joinRoom(peer) {
        // if room doesn't exist, create it
        if (!this._rooms[peer.ip]) {
            this._rooms[peer.ip] = {};
        }

        // notify all other peers
        for (const otherPeerId in this._rooms[peer.ip]) {
            const otherPeer = this._rooms[peer.ip][otherPeerId];
            this._send(otherPeer, {
                type: 'peer-joined',
                peer: peer.getInfo()
            });
        }

        // notify peer about the other peers
        const otherPeers = [];
        for (const otherPeerId in this._rooms[peer.ip]) {
            otherPeers.push(this._rooms[peer.ip][otherPeerId].getInfo());
        }

        this._send(peer, {
            type: 'peers',
            peers: otherPeers
        });

        // add peer to room
        this._rooms[peer.ip][peer.id] = peer;
    }

    _leaveRoom(peer) {
        if (!this._rooms[peer.ip] || !this._rooms[peer.ip][peer.id]) return;
        this._cancelKeepAlive(this._rooms[peer.ip][peer.id]);

        // delete the peer
        delete this._rooms[peer.ip][peer.id];

        peer.socket.terminate();
        //if room is empty, delete the room
        if (!Object.keys(this._rooms[peer.ip]).length) {
            delete this._rooms[peer.ip];
        } else {
            // notify all other peers
            for (const otherPeerId in this._rooms[peer.ip]) {
                const otherPeer = this._rooms[peer.ip][otherPeerId];
                this._send(otherPeer, { type: 'peer-left', peerId: peer.id });
            }
        }
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
        
        // set name 
        this._setName(request);
        
        // for keepalive
        this.timerId = 0;
        this.lastBeat = Date.now();
    }

    _setIP(request) {
        if (request.headers['x-forwarded-for']) {
            this.ip = request.headers['x-forwarded-for'].split(/\s*,\s*/)[0];
        } else {
            this.ip = request.connection.remoteAddress;
        }
        // IPv4 and IPv6 use different values to refer to localhost
        if (this.ip == '::1' || this.ip == '::ffff:127.0.0.1') {
            this.ip = '127.0.0.1';
        }
    }

    _setPeerId(request) {
        if (request.peerId) {
            this.id = request.peerId;
        } else {
            // 从cookie中提取纯粹的peerid值，而不是整个cookie字符串
            const cookies = request.headers.cookie || '';
            const peerIdMatch = cookies.match(/peerid=([^;]+)/);
            this.id = peerIdMatch ? peerIdMatch[1] : Peer.uuid();
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

        // 使用中文名称
        const colorIndex = Math.abs(this.id.hashCode() % chineseColors.length);
        const animalIndex = Math.abs((this.id.hashCode() >> 4) % chineseAnimals.length);
        const displayName = chineseColors[colorIndex] + chineseAnimals[animalIndex];

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
