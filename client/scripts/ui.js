const $ = query => document.getElementById(query);
const $$ = query => document.body.querySelector(query);
const isURL = text => /^((https?:\/\/|www)[^\s]+)/g.test(text.toLowerCase());
window.isDownloadSupported = (typeof document.createElement('a').download !== 'undefined');
window.isProductionEnvironment = !window.location.host.startsWith('localhost');
window.iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

// set display name
Events.on('display-name', e => {
    const me = e.detail.message;
    const $displayName = $('displayName')
    $displayName.textContent = '您的名称为 ' + me.displayName;
    $displayName.title = me.deviceName;
    $displayName.dataset.selfId = me.peerId || me.selfId;
    
    // 设置修改名称的函数
    const updateNameHandler = () => {
        // 获取实际当前显示名称，去掉"您的名称为 "前缀
        const displayText = $displayName.textContent;
        const currentName = displayText.startsWith('您的名称为 ') 
            ? displayText.substring('您的名称为 '.length) 
            : me.displayName;
        
        const newName = prompt('请输入您想要的显示名称', currentName);
        
        if (newName && newName.trim() && newName !== currentName) {
            // 保存到localStorage
            localStorage.setItem('user-display-name', newName);
            
            // 发送到服务器
            const event = new CustomEvent('update-user-name', {
                detail: newName
            });
            window.dispatchEvent(event);
            
            // 临时更新显示
            $displayName.textContent = '您的名称为 ' + newName;
        }
    };
    
    // 点击名称可以修改
    if (!$displayName.hasSetClickHandler) {
        $displayName.hasSetClickHandler = true;
        $displayName.addEventListener('click', updateNameHandler);
    }
    
    // 点击铅笔图标也可以修改
    const $editIcon = $('editNameIcon');
    if ($editIcon && !$editIcon.hasSetClickHandler) {
        $editIcon.hasSetClickHandler = true;
        $editIcon.addEventListener('click', updateNameHandler);
    }
});

// 页面加载完成后初始化版本号显示
document.addEventListener('DOMContentLoaded', () => {
    // 版本号代码已移除
    
    // 添加更新动画样式
    const style = document.createElement('style');
    style.textContent = `
        x-peer.updated {
            position: relative;
            animation: card-pulse 1s ease-in-out;
        }
        
        x-peer.updated .name {
            animation: highlight-update 3s ease-in-out;
            font-weight: bold;
        }
        
        @keyframes highlight-update {
            0% { color: inherit; }
            30% { color: #2196F3; }
            70% { color: #2196F3; }
            100% { color: inherit; font-weight: normal; }
        }
        
        @keyframes card-pulse {
            0% { transform: scale(1); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); }
            50% { transform: scale(1.05); box-shadow: 0 4px 16px rgba(33, 150, 243, 0.3); }
            100% { transform: scale(1); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); }
        }
    `;
    document.head.appendChild(style);
});

class PeersUI {

    constructor() {
        Events.on('peer-joined', e => this._onPeerJoined(e.detail));
        Events.on('peer-left', e => this._onPeerLeft(e.detail));
        Events.on('peers', e => this._onPeers(e.detail));
        Events.on('file-progress', e => this._onFileProgress(e.detail));
        Events.on('paste', e => this._onPaste(e));
        Events.on('peer-updated', e => this._onPeerUpdated(e.detail));
        
        // 初始化静态属性，用于跟踪设备更新通知
        if (!PeersUI._lastNotifyTime) {
            PeersUI._lastNotifyTime = 0;
            PeersUI._updatedPeers = new Set();
        }
    }

    _onPeerJoined(peer) {
        if ($(peer.id)) return; // peer already exists
        const peerUI = new PeerUI(peer);
        $$('x-peers').appendChild(peerUI.$el);
        setTimeout(e => window.animateBackground(false), 1750); // Stop animation
    }

    _onPeers(peers) {
        this._clearPeers();
        peers.forEach(peer => this._onPeerJoined(peer));
    }

    _onPeerLeft(peerId) {
        const $peer = $(peerId);
        if (!$peer) return;
        $peer.remove();
    }

    _onFileProgress(progress) {
        const peerId = progress.sender || progress.recipient;
        const $peer = $(peerId);
        if (!$peer) return;
        $peer.ui.setProgress(progress.progress);
    }

    _clearPeers() {
        const $peers = $$('x-peers').innerHTML = '';
    }

    _onPaste(e) {
        const files = e.clipboardData.files || e.clipboardData.items
            .filter(i => i.type.indexOf('image') > -1)
            .map(i => i.getAsFile());
        const peers = document.querySelectorAll('x-peer');
        // send the pasted image content to the only peer if there is one
        // otherwise, select the peer somehow by notifying the client that
        // "image data has been pasted, click the client to which to send it"
        // not implemented
        if (files.length > 0 && peers.length === 1) {
            Events.fire('files-selected', {
                files: files,
                to: $$('x-peer').id
            });
        }
    }

    _onPeerUpdated(peer) {
        console.log('处理peer-updated事件:', peer); // 添加日志
        
        // 修复选择器 - 尝试多种方式查找对等设备元素
        let $peer = $(peer.id);
        
        // 如果找不到，尝试使用data-peer-id属性查找
        if (!$peer) {
            $peer = $(`.peer[data-peer-id="${peer.id}"]`);
        }
        
        // 可能是ID格式问题，尝试直接查找所有对等设备并比较ID
        if (!$peer) {
            const allPeers = document.querySelectorAll('x-peer');
            for (const el of allPeers) {
                if (el.id === peer.id || el.dataset.peerId === peer.id) {
                    $peer = el;
                    break;
                }
            }
        }
        
        if (!$peer) {
            console.warn(`未找到ID为 ${peer.id} 的对等设备元素，将创建新元素`);
            // 如果仍然找不到，可能需要创建新元素
            const peerUI = new PeerUI(peer);
            $$('x-peers').appendChild(peerUI.$el);
            $peer = peerUI.$el;
        }
        
        if ($peer.classList.contains('peer-connecting')) {
            $peer.classList.remove('peer-connecting');
        }
        
        // 更新名称显示
        const $name = $peer.querySelector('.name');
        const $deviceName = $peer.querySelector('.device-name');
        
        let nameChanged = false;
        
        if ($name && peer.name && peer.name.displayName) {
            // 检查名称是否实际发生了变化
            if ($name.textContent !== peer.name.displayName) {
                console.log(`更新设备显示名称: ${$name.textContent} -> ${peer.name.displayName}`);
                $name.textContent = peer.name.displayName;
                nameChanged = true;
            }
        }
        
        if ($deviceName && peer.name && peer.name.deviceName) {
            // 检查设备名称是否实际发生了变化
            if ($deviceName.textContent !== peer.name.deviceName) {
                console.log(`更新设备型号: ${$deviceName.textContent} -> ${peer.name.deviceName}`);
                $deviceName.textContent = peer.name.deviceName;
                nameChanged = true;
            }
        }
        
        // 如果名称变化了，添加更新动画效果
        if (nameChanged) {
            // 添加更新动画类
            $peer.classList.add('updated');
            
            // 3秒后移除动画类
            setTimeout(() => {
                $peer.classList.remove('updated');
            }, 3000);
        }
        
        if (!$peer.dataset.name || $peer.dataset.name !== peer.name.displayName) {
            $peer.dataset.name = peer.name.displayName;
            // 添加设备到最近更新的设备集合中
            PeersUI._updatedPeers.add(peer.name.displayName);
            
            const now = Date.now();
            const minInterval = 5000; // 至少5秒内不再次通知
            
            // 如果距离上次通知时间过短，不触发新通知
            if (now - PeersUI._lastNotifyTime < minInterval) return;
            
            // 更新上次通知时间
            PeersUI._lastNotifyTime = now;
            
            // 构建通知消息：单设备或多设备更新
            let message;
            const updatedCount = PeersUI._updatedPeers.size;
            
            if (updatedCount === 1) {
                message = `"${peer.name.displayName}" 更新了名称`;
            } else {
                message = `${updatedCount}个设备更新了信息`;
            }
            
            // 发送通知
            Events.fire('notify-user', {
                message: message,
                timeout: 3000
            });
            
            // 清空更新的设备集合
            PeersUI._updatedPeers.clear();
        }
    }
}

class PeerUI {

    html() {
        return `
            <div class="card-wrapper">
                <label class="column center" title="点击发送文件或右键点击发送消息">
                    <input type="file" multiple>
                    <div class="card-content">
                        <x-icon shadow="1">
                            <svg class="icon" viewBox="0 0 24 24">${this._iconPath()}</svg>
                        </x-icon>
                        <div class="progress">
                            <div class="circle"></div>
                            <div class="circle right"></div>
                        </div>
                        <div class="name font-subheading"></div>
                        <div class="device-name font-body2"></div>
                        <div class="status font-body2"></div>
                    </div>
                </label>
                <div class="card-actions">
                    <div class="action-button send-file" title="发送文件">
                        <svg class="icon" viewBox="0 0 24 24">
                            <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-2 16c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm2-10V3.5L18.5 9H14z"></path>
                        </svg>
                    </div>
                    <div class="action-button send-text" title="发送消息">
                        <svg class="icon" viewBox="0 0 24 24">
                            <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"></path>
                        </svg>
                    </div>
                </div>
            </div>`
    }

    constructor(peer) {
        this._peer = peer;
        this._initDom();
        this._bindListeners(this.$el);
    }

    _initDom() {
        const el = document.createElement('x-peer');
        el.id = this._peer.id;
        el.innerHTML = this.html();
        el.ui = this;
        el.classList.add('peer');
        el.dataset.peerId = this._peer.id; // 确保设置data-peer-id属性
        el.querySelector('.name').textContent = this._displayName();
        el.querySelector('.device-name').textContent = this._deviceName();
        
        // 检测是否为长名称，如果是则添加特殊类
        const displayName = this._displayName();
        if (displayName && displayName.length > 12) {
            el.classList.add('long-name');
        }
        
        this.$el = el;
        this.$progress = el.querySelector('.progress');
    }

    _bindListeners(el) {
        el.querySelector('input').addEventListener('change', e => this._onFilesSelected(e));
        el.addEventListener('drop', e => this._onDrop(e));
        el.addEventListener('dragend', e => this._onDragEnd(e));
        el.addEventListener('dragleave', e => this._onDragEnd(e));
        el.addEventListener('dragover', e => this._onDragOver(e));
        el.addEventListener('contextmenu', e => this._onRightClick(e));
        el.addEventListener('touchstart', e => this._onTouchStart(e));
        el.addEventListener('touchend', e => this._onTouchEnd(e));
        
        // 添加卡片操作按钮事件
        const sendFileBtn = el.querySelector('.action-button.send-file');
        if (sendFileBtn) {
            sendFileBtn.addEventListener('click', e => {
                e.stopPropagation();
                e.preventDefault(); // 阻止默认行为，防止label触发input
                el.querySelector('input[type="file"]').click();
            });
        }
        
        const sendTextBtn = el.querySelector('.action-button.send-text');
        if (sendTextBtn) {
            sendTextBtn.addEventListener('click', e => {
                e.stopPropagation();
                e.preventDefault(); // 阻止默认行为，防止label触发
                Events.fire('text-recipient', this._peer.id);
            });
        }
        
        // prevent browser's default file drop behavior
        Events.on('dragover', e => e.preventDefault());
        Events.on('drop', e => e.preventDefault());
    }

    _displayName() {
        return this._peer.name.displayName;
    }

    _deviceName() {
        return this._peer.name.deviceName;
    }

    _iconPath() {
        const device = this._peer.name.device || this._peer.name;
        if (device.type === 'mobile') {
            return '<path d="M15.5 1h-8C6.12 1 5 2.12 5 3.5v17C5 21.88 6.12 23 7.5 23h8c1.38 0 2.5-1.12 2.5-2.5v-17C18 2.12 16.88 1 15.5 1zm-4 21c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4.5-4H7V4h9v14z"></path>';
        }
        if (device.type === 'tablet') {
            return '<path d="M18.5 0h-14C3.12 0 2 1.12 2 2.5v19C2 22.88 3.12 24 4.5 24h14c1.38 0 2.5-1.12 2.5-2.5v-19C21 1.12 19.88 0 18.5 0zm-7 23c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm7.5-4H4V3h15v16z"></path>';
        }
        return '<path d="M21 2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7l-2 3v1h8v-1l-2-3h7c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 12H3V4h18v10z"></path>';
    }

    _icon() {
        return '';
    }

    _onFilesSelected(e) {
        const $input = e.target;
        const files = $input.files;
        const targetId = this.$el.id;
        if (!targetId) {
            console.error('无法确定目标设备ID');
            Events.fire('notify-user', {
                message: '发送失败：无法确定目标设备',
                timeout: 3000
            });
            return;
        }
        Events.fire('files-selected', {
            files: files,
            to: targetId
        });
        $input.value = null; // reset input
    }

    setProgress(progress) {
        if (progress > 0) {
            this.$el.setAttribute('transfer', '1');
        }
        if (progress > 0.5) {
            this.$progress.classList.add('over50');
        } else {
            this.$progress.classList.remove('over50');
        }
        const degrees = `rotate(${360 * progress}deg)`;
        this.$progress.style.setProperty('--progress', degrees);
        if (progress >= 1) {
            this.setProgress(0);
            this.$el.removeAttribute('transfer');
        }
    }

    _onDrop(e) {
        e.preventDefault();
        const files = e.dataTransfer.files;
        // 使用元素ID作为目标设备ID
        const targetId = this.$el.id;
        if (!targetId) {
            console.error('无法确定目标设备ID');
            Events.fire('notify-user', {
                message: '发送失败：无法确定目标设备',
                timeout: 3000
            });
            return;
        }
        Events.fire('files-selected', {
            files: files,
            to: targetId
        });
        this._onDragEnd();
    }

    _onDragOver() {
        this.$el.setAttribute('drop', 1);
    }

    _onDragEnd() {
        this.$el.removeAttribute('drop');
    }

    _onRightClick(e) {
        e.preventDefault();
        Events.fire('text-recipient', this._peer.id);
    }

    _onTouchStart(e) {
        this._touchStart = Date.now();
        this._touchTimer = setTimeout(_ => this._onTouchEnd(), 610);
    }

    _onTouchEnd(e) {
        if (Date.now() - this._touchStart < 500) {
            clearTimeout(this._touchTimer);
        } else { // this was a long tap
            if (e) e.preventDefault();
            Events.fire('text-recipient', this._peer.id);
        }
    }
}


class Dialog {
    constructor(id) {
        this.$el = $(id);
        this.$el.querySelectorAll('[close]').forEach(el => el.addEventListener('click', e => this.hide()))
        this.$autoFocus = this.$el.querySelector('[autofocus]');
    }

    show() {
        this.$el.setAttribute('show', 1);
        if (this.$autoFocus) this.$autoFocus.focus();
    }

    hide() {
        this.$el.removeAttribute('show');
        document.activeElement.blur();
        window.blur();
    }
}

class ReceiveDialog extends Dialog {

    constructor() {
        super('receiveDialog');
        Events.on('file-received', e => this._onFileReceived(e.detail));
        this._filesQueue = [];
        this._busy = false;
        this._downloadSupport = {
            isSupported: typeof document.createElement('a').download !== 'undefined',
            isSafari: /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
        };
    }

    _onFileReceived(file) {
        // 添加到文件队列
        this._filesQueue.push(file);
        
        // 如果当前没有正在处理的文件，则开始处理
        if (!this._busy) {
            this._processNextFile();
        }
    }
    
    _processNextFile() {
        if (this._filesQueue.length === 0) {
            this._busy = false;
            return;
        }
        
        this._busy = true;
        const file = this._filesQueue.shift();
        this._displayFile(file);
    }
    
    _displayFile(file) {
        // 预先生成Blob URL，提高性能
        const url = URL.createObjectURL(file.blob);
        
        // 设置文件信息
        this.$el.querySelector('#fileName').textContent = file.name;
        this.$el.querySelector('#fileSize').textContent = this._formatFileSize(file.size);
        
        // 设置下载链接
        const $a = this.$el.querySelector('#download');
        $a.href = url;
        $a.download = file.name;
        
        // 自动下载处理
        if (this._autoDownload()) {
            URL.revokeObjectURL(url); // 释放URL以避免内存泄漏
            this._downloadFile(file);
            Events.fire('file-progress', {
                sender: file.sender,
                progress: 1
            });
            
            // 处理下一个文件
            setTimeout(() => {
                this._processNextFile();
            }, 0);
            return;
        }
        
        // 只有图片才显示预览
        if (file.mime.split('/')[0] === 'image') {
            this.$el.querySelector('.preview').style.visibility = 'visible';
            this.$el.querySelector('#img-preview').src = url;
        } else {
            this.$el.querySelector('.preview').style.visibility = 'hidden';
        }
        
        // 显示对话框
        this.show();
        
        // iOS下载兼容
        if (!this._downloadSupport.isSupported) {
            // fallback for iOS
            $a.target = '_blank';
            // 使用更快的方式
            if (this._downloadSupport.isSafari) {
                $a.href = url;
            } else {
                const reader = new FileReader();
                reader.onload = e => $a.href = reader.result;
                reader.readAsDataURL(file.blob);
            }
        }
        
        Events.fire('file-progress', {
            sender: file.sender,
            progress: 1
        });
    }
    
    _downloadFile(file) {
        if (!this._downloadSupport.isSupported) {
            // 无法自动下载，通知用户
            Events.fire('notify-user', {
                message: '您的浏览器不支持自动下载，请手动保存文件',
                timeout: 5000
            });
            return;
        }
        
        // 创建临时链接并触发下载
        const a = document.createElement('a');
        const url = URL.createObjectURL(file.blob);
        a.href = url;
        a.download = file.name;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    }

    _formatFileSize(bytes) {
        if (bytes >= 1e9) {
            return (Math.round(bytes / 1e8) / 10) + ' GB';
        } else if (bytes >= 1e6) {
            return (Math.round(bytes / 1e5) / 10) + ' MB';
        } else if (bytes > 1000) {
            return Math.round(bytes / 1000) + ' KB';
        } else {
            return bytes + ' Bytes';
        }
    }

    hide() {
        this.$el.querySelector('.preview').style.visibility = 'hidden';
        this.$el.querySelector("#img-preview").src = "";
        super.hide();
        
        // 处理下一个文件
        setTimeout(() => {
            this._processNextFile();
        }, 0);
    }

    _autoDownload() {
        return !this.$el.querySelector('#autoDownload').checked;
    }
}


class SendTextDialog extends Dialog {
    constructor() {
        super('sendTextDialog');
        const textInput = $('textInput');
        const sendButton = this.$el.querySelector('button[type="submit"]');
        this._targetPeerId = null;

        Events.on('text-recipient', e => this._onRecipient(e.detail));
        
        textInput.addEventListener('paste', e => this._onPaste(e));
        
        textInput.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendButton.click();
            }
        });

        this.$el.querySelector('form').addEventListener('submit', e => {
            e.preventDefault();
            if (!this._targetPeerId) {
                console.error('没有指定接收方');
                Events.fire('notify-user', {
                    message: '发送失败：未指定接收方',
                    timeout: 3000
                });
                return;
            }
            this._send();
        });
    }

    _onRecipient(peerId) {
        this._targetPeerId = peerId;
        this.show();
        const textInput = $('textInput');
        textInput.focus();
    }

    _send() {
        const textInput = $('textInput');
        if (textInput.textContent.length === 0) return;
        Events.fire('send-text', {
            to: this._targetPeerId,
            text: textInput.textContent
        });
        textInput.textContent = '';
        this.hide();
    }

    _onPaste(e) {
        if (!e.clipboardData.items) return;
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') === -1) continue;
            const file = items[i].getAsFile();
            Events.fire('files-selected', {
                files: [file],
                to: this._targetPeerId
            });
        }
    }
}

class ReceiveTextDialog extends Dialog {
    constructor() {
        super('receiveTextDialog');
        Events.on('text-received', e => this._onText(e.detail))
        this.$text = this.$el.querySelector('#text');
        const $copy = this.$el.querySelector('#copy');
        copy.addEventListener('click', _ => this._onCopy());
    }

    _onText(e) {
        this.$text.innerHTML = '';
        const text = e.text;
        if (isURL(text)) {
            const $a = document.createElement('a');
            $a.href = text;
            $a.target = '_blank';
            $a.textContent = text;
            this.$text.appendChild($a);
        } else {
            this.$text.textContent = text;
        }
        this.show();
        
        // 尝试播放音频，但捕获可能的错误
        try {
            window.blop.play().catch(err => {
                console.log('无法播放通知音: ' + err.message);
            });
        } catch (error) {
            console.log('播放音频错误');
        }
    }

    async _onCopy() {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(this.$text.textContent);
                Events.fire('notify-user', '已复制到剪贴板');
            } else {
                // 使用备用复制方法
                const textToCopy = this.$text.textContent;
                const span = document.createElement('span');
                span.textContent = textToCopy;
                span.style.whiteSpace = 'pre'; // 保留连续空格和换行符
                span.style.position = 'absolute';
                span.style.left = '-9999px';
                span.style.top = '-9999px';

                document.body.appendChild(span);
                const selection = window.getSelection();
                const range = document.createRange();
                selection.removeAllRanges();
                range.selectNode(span);
                selection.addRange(range);

                const success = document.execCommand('copy');
                selection.removeAllRanges();
                span.remove();

                if (success) {
                    Events.fire('notify-user', '已复制到剪贴板');
                } else {
                    Events.fire('notify-user', '复制失败，请手动复制');
                }
            }
        } catch (error) {
            console.error('复制文本时出错:', error);
            Events.fire('notify-user', '复制失败，请手动复制');
        }
    }
}

class Toast extends Dialog {
    constructor() {
        super('toast');
        Events.on('notify-user', (e) => this._onNotify(e.detail));
        this.$toast = $('toast');
        this._timeout = null;
        this._toastQueue = []; // 通知队列
        this._isShowingToast = false; // 当前是否正在显示通知
        this._activeNotifications = {}; // 跟踪活跃通知，按ID索引
    }

    _onNotify(detail) {
        // 如果传入的是字符串，则转换为对象格式
        const message = typeof detail === 'string' ? { message: detail, timeout: 3000 } : detail;
        
        // 处理清除所有通知的情况
        if (message.type === 'clearAll') {
            this._toastQueue = [];
            this._isShowingToast = false;
            if (this._timeout) {
                clearTimeout(this._timeout);
                this._timeout = null;
            }
            this.hide();
            
            // 如果有新消息，则显示
            if (message.message) {
                setTimeout(() => {
                    this._toastQueue.push(message);
                    this._showNextToast();
                }, 300);
            }
            return;
        }
        
        // 如果有ID，且是替换已有通知
        if (message.id && this._activeNotifications[message.id]) {
            // 如果当前正在显示的是这个ID的通知，直接替换内容
            if (this._currentToastId === message.id) {
                this.$toast.textContent = message.message;
                
                // 如果设置了超时，更新超时
                if (message.timeout && !message.persistent) {
                    if (this._timeout) {
                        clearTimeout(this._timeout);
                    }
                    this._timeout = setTimeout(() => {
                        this.hide();
                        delete this._activeNotifications[message.id];
                        this._currentToastId = null;
                        setTimeout(() => this._showNextToast(), 300);
                    }, message.timeout);
                }
                return;
            }
            
            // 如果在队列中，则替换队列中的消息
            const index = this._toastQueue.findIndex(toast => toast.id === message.id);
            if (index !== -1) {
                this._toastQueue[index] = message;
                return;
            }
        }
        
        // 记录活跃通知
        if (message.id) {
            this._activeNotifications[message.id] = true;
        }
        
        // 将消息添加到队列
        this._toastQueue.push(message);
        
        // 如果当前没有显示通知，则显示队列中的第一条
        if (!this._isShowingToast) {
            this._showNextToast();
        }
    }
    
    _showNextToast() {
        if (this._toastQueue.length === 0) {
            this._isShowingToast = false;
            this._currentToastId = null;
            return;
        }
        
        this._isShowingToast = true;
        const message = this._toastQueue.shift();
        
        // 保存当前显示的通知ID
        this._currentToastId = message.id || null;
        
        // 清除之前的超时
        if (this._timeout) {
            clearTimeout(this._timeout);
            this._timeout = null;
        }
        
        // 更新消息内容
        this.$toast.textContent = message.message;
        
        // 显示消息
        this.show();
        
        // 设置消息的超时时间
        const timeout = message.timeout || 3000;
        
        // 如果不是常驻消息，则设置超时隐藏
        if (!message.persistent) {
            this._timeout = setTimeout(() => {
                this.hide();
                if (message.id) {
                    delete this._activeNotifications[message.id];
                }
                this._currentToastId = null;
                // 等待动画结束后显示下一条消息
                setTimeout(() => this._showNextToast(), 300);
            }, timeout);
        }
    }
    
    hide() {
        super.hide();
        
        // 如果还有队列中的消息，则在隐藏动画完成后显示下一条
        if (this._toastQueue.length > 0 && !this._timeout) {
            setTimeout(() => this._showNextToast(), 300);
        } else if (this._toastQueue.length === 0) {
            this._isShowingToast = false;
            this._currentToastId = null;
        }
    }
}


class Notifications {

    constructor() {
        // Check if the browser supports notifications
        if (!('Notification' in window)) return;

        // Check whether notification permissions have already been granted
        if (Notification.permission !== 'granted') {
            this.$button = $('notification');
            if (this.$button) {
                this.$button.removeAttribute('hidden');
                this.$button.addEventListener('click', e => this._requestPermission());
            }
        }
        Events.on('text-received', e => this._messageNotification(e.detail.text));
        Events.on('file-received', e => this._downloadNotification(e.detail.name));
    }

    _requestPermission() {
        Notification.requestPermission(permission => {
            if (permission !== 'granted') {
                Events.fire('notify-user', Notifications.PERMISSION_ERROR || '错误');
                return;
            }
            this._notify('更便捷的分享体验!');
            if (this.$button) {
                this.$button.setAttribute('hidden', 1);
            }
        });
    }

    _notify(message, body) {
        const config = {
            body: body,
            icon: '/images/favicon-96x96.png',
        }
        let notification;
        try {
            notification = new Notification(message, config);
        } catch (e) {
            // Android doesn't support "new Notification" if service worker is installed
            if (!serviceWorker || !serviceWorker.showNotification) return;
            notification = serviceWorker.showNotification(message, config);
        }

        // Notification is persistent on Android. We have to close it manually
        const visibilitychangeHandler = () => {                             
            if (document.visibilityState === 'visible') {    
                notification.close();
                Events.off('visibilitychange', visibilitychangeHandler);
            }                                                       
        };                                                                                
        Events.on('visibilitychange', visibilitychangeHandler);

        return notification;
    }

    _messageNotification(message) {
        if (document.visibilityState !== 'visible') {
            if (isURL(message)) {
                const notification = this._notify(message, '点击打开链接');
                this._bind(notification, e => window.open(message, '_blank', null, true));
            } else {
                const notification = this._notify(message, '点击复制文本');
                this._bind(notification, e => this._copyText(message, notification));
            }
        }
    }

    _downloadNotification(message) {
        if (document.visibilityState !== 'visible') {
            const notification = this._notify(message, '点击下载');
            if (!window.isDownloadSupported) return;
            this._bind(notification, e => this._download(notification));
        }
    }

    _download(notification) {
        document.querySelector('x-dialog [download]').click();
        notification.close();
    }

    _copyText(message, notification) {
        notification.close();
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(message)
                    .then(() => this._notify('已复制文本到剪贴板'))
                    .catch(err => console.error('复制失败:', err));
            } else {
                // 使用备用复制方法
                const span = document.createElement('span');
                span.textContent = message;
                span.style.whiteSpace = 'pre';
                span.style.position = 'absolute';
                span.style.left = '-9999px';
                span.style.top = '-9999px';

                document.body.appendChild(span);
                const selection = window.getSelection();
                const range = document.createRange();
                selection.removeAllRanges();
                range.selectNode(span);
                selection.addRange(range);

                const success = document.execCommand('copy');
                selection.removeAllRanges();
                span.remove();

                if (success) {
                    this._notify('已复制文本到剪贴板');
                }
            }
        } catch (error) {
            console.error('复制文本时出错:', error);
        }
    }

    _bind(notification, handler) {
        if (notification.then) {
            notification.then(e => serviceWorker.getNotifications().then(notifications => {
                serviceWorker.addEventListener('notificationclick', handler);
            }));
        } else {
            notification.onclick = handler;
        }
    }
}


class NetworkStatusUI {

    constructor() {
        window.addEventListener('offline', e => this._showOfflineMessage(), false);
        window.addEventListener('online', e => this._showOnlineMessage(), false);
        if (!navigator.onLine) this._showOfflineMessage();
    }

    _showOfflineMessage() {
        Events.fire('notify-user', '您已离线');
    }

    _showOnlineMessage() {
        Events.fire('notify-user', '您已重新连接');
    }
}

class WebShareTargetUI {
    constructor() {
        const parsedUrl = new URL(window.location);
        const title = parsedUrl.searchParams.get('title');
        const text = parsedUrl.searchParams.get('text');
        const url = parsedUrl.searchParams.get('url');

        let shareTargetText = title ? title : '';
        shareTargetText += text ? shareTargetText ? ' ' + text : text : '';

        if(url) shareTargetText = url; // We share only the Link - no text. Because link-only text becomes clickable.

        if (!shareTargetText) return;
        window.shareTargetText = shareTargetText;
        history.pushState({}, 'URL Rewrite', '/');
        console.log('Shared Target Text:', '"' + shareTargetText + '"');
    }
}


class Snapdrop {
    constructor() {
        const server = new ServerConnection();
        const peers = new PeersManager(server);
        const peersUI = new PeersUI();
        Events.on('load', e => {
            const receiveDialog = new ReceiveDialog();
            const sendTextDialog = new SendTextDialog();
            const receiveTextDialog = new ReceiveTextDialog();
            const toast = new Toast();
            const notifications = new Notifications();
            const networkStatusUI = new NetworkStatusUI();
            const webShareTargetUI = new WebShareTargetUI();
        });
    }
}

const snapdrop = new Snapdrop();



if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js')
        .then(serviceWorker => {
            console.log('Service Worker registered');
            window.serviceWorker = serviceWorker
        });
}

window.addEventListener('beforeinstallprompt', e => {
    if (window.matchMedia('(display-mode: standalone)').matches) {
        // don't display install banner when installed
        return e.preventDefault();
    } else {
        const btn = document.querySelector('#install')
        btn.hidden = false;
        btn.onclick = _ => e.prompt();
        return e.preventDefault();
    }
});

// Background Animation
Events.on('load', () => {
    let c = document.createElement('canvas');
    document.body.appendChild(c);
    let style = c.style;
    style.width = '100%';
    style.position = 'absolute';
    style.zIndex = -1;
    style.top = 0;
    style.left = 0;
    let ctx = c.getContext('2d');
    let x0, y0, w, h, dw;

    function init() {
        w = window.innerWidth;
        h = window.innerHeight;
        c.width = w;
        c.height = h;
        let offset = h > 380 ? 100 : 65;
        offset = h > 800 ? 116 : offset;
        x0 = w / 2;
        y0 = h - offset;
        dw = Math.max(w, h, 1000) / 13;
        drawCircles();
    }
    window.onresize = init;

    function drawCircle(radius) {
        ctx.beginPath();
        let color = Math.round(197 * (1 - radius / Math.max(w, h)));
        ctx.strokeStyle = 'rgba(' + color + ',' + color + ',' + color + ',0.1)';
        ctx.arc(x0, y0, radius, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.lineWidth = 2;
    }

    let step = 0;

    function drawCircles() {
        ctx.clearRect(0, 0, w, h);
        for (let i = 0; i < 8; i++) {
            drawCircle(dw * i + step % dw);
        }
        step += 1;
    }

    let loading = true;

    function animate() {
        if (loading || step % dw < dw - 5) {
            requestAnimationFrame(function() {
                drawCircles();
                animate();
            });
        }
    }
    window.animateBackground = function(l) {
        loading = l;
        animate();
    };
    init();
    animate();
});

Notifications.PERMISSION_ERROR = `
通知权限已被阻止，因为您多次忽略权限提示。
您可以通过点击URL旁边的锁定图标，在页面信息中重置此设置。
`;

document.body.onclick = e => { // safari hack to fix audio
    document.body.onclick = null;
    if (!(/.*Version.*Safari.*/.test(navigator.userAgent))) return;
    blop.play();
}
