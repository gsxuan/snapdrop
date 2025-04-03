class TransferHistory {
    constructor() {
        this.maxHistoryItems = 50;
        this.history = this.loadHistory();
        
        // 添加历史记录按钮
        this.addHistoryButton();
        
        // 监听文件传输事件
        this.setupEventListeners();
    }
    
    loadHistory() {
        try {
            const storedHistory = localStorage.getItem('transferHistory');
            return storedHistory ? JSON.parse(storedHistory) : [];
        } catch (e) {
            console.error('Error loading history', e);
            return [];
        }
    }
    
    saveHistory() {
        try {
            localStorage.setItem('transferHistory', JSON.stringify(this.history));
        } catch (e) {
            console.error('Error saving history', e);
        }
    }
    
    addHistoryButton() {
        const header = document.querySelector('header');
        if (!header) return;
        
        const historyButton = document.createElement('a');
        historyButton.href = '#';
        historyButton.id = 'history-button';
        historyButton.className = 'icon-button';
        historyButton.title = '传输历史';
        historyButton.innerHTML = `
            <svg class="icon">
                <use xlink:href="#history" />
            </svg>
        `;
        
        header.insertBefore(historyButton, header.firstChild);
        
        historyButton.addEventListener('click', e => {
            e.preventDefault();
            this.showHistoryDialog();
        });
    }
    
    showHistoryDialog() {
        const dialog = document.createElement('x-dialog');
        dialog.id = 'history-dialog';
        
        const content = document.createElement('div');
        content.innerHTML = `
            <x-background class="full center">
                <x-paper shadow="2">
                    <h3>传输历史</h3>
                    <div class="history-list">
                        ${this.history.length ? this.renderHistoryItems() : '<div class="empty-history">无传输历史记录</div>'}
                    </div>
                    <div class="row-reverse">
                        <button class="button" close>关闭</button>
                        ${this.history.length ? '<button id="clear-history" class="button">清除历史</button>' : ''}
                    </div>
                </x-paper>
            </x-background>
        `;
        
        dialog.appendChild(content);
        document.body.appendChild(dialog);
        
        // 添加事件监听器
        if (this.history.length) {
            const clearButton = dialog.querySelector('#clear-history');
            clearButton.addEventListener('click', () => {
                this.clearHistory();
                dialog.remove();
            });
        }
        
        dialog.querySelector('button[close]').addEventListener('click', () => {
            dialog.remove();
        });
    }
    
    renderHistoryItems() {
        return this.history.map(item => {
            const date = new Date(item.timestamp);
            const formattedDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
            
            let icon, typeLabel;
            if (item.type === 'file') {
                icon = this.getFileIcon(item.meta.mime);
                typeLabel = '文件';
            } else {
                icon = '<svg class="icon"><use xlink:href="#message" /></svg>';
                typeLabel = '消息';
            }
            
            const direction = item.direction === 'in' ? '接收' : '发送';
            const peerName = item.peerName || '未知设备';
            
            return `
                <div class="history-item ${item.direction}">
                    <div class="history-icon">${icon}</div>
                    <div class="history-content">
                        <div class="history-title">
                            ${item.type === 'file' ? this.escapeHtml(item.meta.name) : this.escapeHtml(item.meta.text.substring(0, 30)) + (item.meta.text.length > 30 ? '...' : '')}
                        </div>
                        <div class="history-info">
                            ${direction} ${typeLabel} · ${peerName} · ${formattedDate}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    getFileIcon(mime) {
        if (mime.startsWith('image/')) {
            return '<svg class="icon"><use xlink:href="#image" /></svg>';
        } else if (mime.startsWith('video/')) {
            return '<svg class="icon"><use xlink:href="#movie" /></svg>';
        } else if (mime.startsWith('audio/')) {
            return '<svg class="icon"><use xlink:href="#music" /></svg>';
        } else if (mime === 'application/pdf') {
            return '<svg class="icon"><use xlink:href="#description" /></svg>';
        } else {
            return '<svg class="icon"><use xlink:href="#insert-drive-file" /></svg>';
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    addHistoryItem(item) {
        this.history.unshift(item);
        
        // 限制历史记录数量
        if (this.history.length > this.maxHistoryItems) {
            this.history = this.history.slice(0, this.maxHistoryItems);
        }
        
        this.saveHistory();
    }
    
    clearHistory() {
        this.history = [];
        this.saveHistory();
    }
    
    setupEventListeners() {
        // 监听文件发送事件
        document.addEventListener('file-sent', e => {
            this.addHistoryItem({
                type: 'file',
                direction: 'out',
                timestamp: Date.now(),
                peerName: e.detail.peerName,
                meta: {
                    name: e.detail.name,
                    mime: e.detail.mime,
                    size: e.detail.size
                }
            });
        });
        
        // 监听文件接收事件
        document.addEventListener('file-received', e => {
            this.addHistoryItem({
                type: 'file',
                direction: 'in',
                timestamp: Date.now(),
                peerName: e.detail.peerName,
                meta: {
                    name: e.detail.name,
                    mime: e.detail.mime,
                    size: e.detail.size
                }
            });
        });
        
        // 监听消息发送事件
        document.addEventListener('text-sent', e => {
            this.addHistoryItem({
                type: 'text',
                direction: 'out',
                timestamp: Date.now(),
                peerName: e.detail.peerName,
                meta: {
                    text: e.detail.text
                }
            });
        });
        
        // 监听消息接收事件
        document.addEventListener('text-received', e => {
            this.addHistoryItem({
                type: 'text',
                direction: 'in',
                timestamp: Date.now(),
                peerName: e.detail.peerName,
                meta: {
                    text: e.detail.text
                }
            });
        });
    }
}

// 添加历史图标到 SVG 图标库
document.addEventListener('DOMContentLoaded', () => {
    // 添加历史图标
    const iconsSvg = document.querySelector('svg[style="display: none;"]');
    if (iconsSvg) {
        const icons = {
            'history': 'M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
            'message': 'M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z',
            'image': 'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z',
            'movie': 'M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z',
            'music': 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
            'description': 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
            'insert-drive-file': 'M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z'
        };
        
        for (const [id, path] of Object.entries(icons)) {
            const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
            symbol.setAttribute('id', id);
            symbol.setAttribute('viewBox', '0 0 24 24');
            
            const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            pathElement.setAttribute('d', path);
            
            symbol.appendChild(pathElement);
            iconsSvg.appendChild(symbol);
        }
    }
    
    // 初始化传输历史
    window.transferHistory = new TransferHistory();
});

// 添加历史样式
const historyStyle = document.createElement('style');
historyStyle.textContent = `
.history-list {
    max-height: 60vh;
    overflow-y: auto;
    margin: 16px 0;
}

.empty-history {
    text-align: center;
    padding: 20px;
    color: var(--text-color-secondary);
}

.history-item {
    display: flex;
    padding: 12px;
    border-bottom: 1px solid var(--border-color);
    align-items: center;
}

.history-item:last-child {
    border-bottom: none;
}

.history-icon {
    margin-right: 16px;
}

.history-content {
    flex: 1;
}

.history-title {
    font-size: 16px;
    margin-bottom: 4px;
}

.history-info {
    font-size: 13px;
    color: var(--text-color-secondary);
}

.history-item.in .history-icon {
    color: var(--primary-color);
}

.history-item.out .history-icon {
    color: var(--secondary-color);
}
`;
document.head.appendChild(historyStyle); 