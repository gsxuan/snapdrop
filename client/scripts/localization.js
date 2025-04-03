class Localization {
    constructor() {
        this.defaultLang = 'en';
        this.supportedLangs = ['en', 'zh-CN'];
        this.translations = {
            'en': {
                'title': 'Snapdrop',
                'header': {
                    'about': 'About Snapdrop',
                    'toggle_theme': 'Toggle Theme',
                    'enable_notifications': 'Enable Notifications',
                    'install': 'Install Snapdrop'
                },
                'main': {
                    'no_peers': 'Open Snapdrop on other devices to send files',
                    'instructions_desktop': 'Click to send files or right click to send a message',
                    'instructions_mobile': 'Tap to send files or long tap to send a message',
                    'display_name_placeholder': 'The easiest way to transfer data across devices',
                    'network_info': 'You can be discovered by everyone on this network'
                },
                'dialogs': {
                    'file_received': 'File Received',
                    'file_name': 'Filename',
                    'file_size': 'File size',
                    'save': 'Save',
                    'ignore': 'Ignore',
                    'ask_save': 'Ask to save each file before downloading',
                    'send_message': 'Send a Message',
                    'send': 'Send',
                    'cancel': 'Cancel',
                    'message_received': 'Message Received',
                    'copy': 'Copy',
                    'close': 'Close',
                    'file_transfer': 'File Transfer Completed'
                },
                'about': {
                    'tagline': 'The easiest way to transfer files across devices',
                    'github': 'Snapdrop on Github',
                    'donate': 'Help cover the server costs!',
                    'tweet': 'Tweet about Snapdrop',
                    'faq': 'Frequently asked questions'
                }
            },
            'zh-CN': {
                'title': 'Snapdrop',
                'header': {
                    'about': '关于 Snapdrop',
                    'toggle_theme': '切换主题',
                    'enable_notifications': '启用通知',
                    'install': '安装 Snapdrop'
                },
                'main': {
                    'no_peers': '在其他设备上打开 Snapdrop 以发送文件',
                    'instructions_desktop': '点击发送文件或右键点击发送消息',
                    'instructions_mobile': '点击发送文件或长按发送消息',
                    'display_name_placeholder': '跨设备传输数据的最简单方式',
                    'network_info': '此网络中的所有人都能发现您'
                },
                'dialogs': {
                    'file_received': '收到文件',
                    'file_name': '文件名',
                    'file_size': '文件大小',
                    'save': '保存',
                    'ignore': '忽略',
                    'ask_save': '下载前询问是否保存每个文件',
                    'send_message': '发送消息',
                    'send': '发送',
                    'cancel': '取消',
                    'message_received': '收到消息',
                    'copy': '复制',
                    'close': '关闭',
                    'file_transfer': '文件传输完成'
                },
                'about': {
                    'tagline': '跨设备传输文件的最简单方式',
                    'github': '访问 Github 上的 Snapdrop',
                    'donate': '帮助支付服务器费用！',
                    'tweet': '在推特上分享 Snapdrop',
                    'faq': '常见问题解答'
                }
            }
        };

        this.initLanguageSelector();
        this.applyTranslations();
    }

    initLanguageSelector() {
        // 添加语言选择器到页面
        const header = document.querySelector('header');
        if (!header) return;
        
        const langButton = document.createElement('a');
        langButton.href = '#';
        langButton.id = 'lang-selector';
        langButton.className = 'icon-button';
        langButton.title = 'Change Language';
        langButton.innerHTML = `
            <svg class="icon">
                <use xlink:href="#language" />
            </svg>
        `;
        
        header.insertBefore(langButton, header.firstChild);
        
        langButton.addEventListener('click', (e) => {
            e.preventDefault();
            this.showLanguageDialog();
        });
    }

    showLanguageDialog() {
        // 创建语言选择对话框
        const dialog = document.createElement('x-dialog');
        dialog.id = 'language-dialog';
        
        const content = document.createElement('div');
        content.innerHTML = `
            <x-background class="full center">
                <x-paper shadow="2">
                    <h3>选择语言 / Select Language</h3>
                    <div class="language-list">
                        <button data-lang="en">English</button>
                        <button data-lang="zh-CN">中文 (简体)</button>
                    </div>
                    <div class="row-reverse">
                        <button class="button" close>关闭 / Close</button>
                    </div>
                </x-paper>
            </x-background>
        `;
        
        dialog.appendChild(content);
        document.body.appendChild(dialog);
        
        dialog.querySelectorAll('button[data-lang]').forEach(button => {
            button.addEventListener('click', () => {
                this.setLanguage(button.getAttribute('data-lang'));
                dialog.remove();
            });
        });
        
        dialog.querySelector('button[close]').addEventListener('click', () => {
            dialog.remove();
        });
    }

    getCurrentLang() {
        return localStorage.getItem('language') || this.getBrowserLanguage();
    }

    getBrowserLanguage() {
        const browserLang = navigator.language || navigator.userLanguage;
        
        if (this.supportedLangs.includes(browserLang)) {
            return browserLang;
        }
        
        // 检查是否有匹配的语言前缀
        for (const lang of this.supportedLangs) {
            if (browserLang.startsWith(lang.split('-')[0])) {
                return lang;
            }
        }
        
        return this.defaultLang;
    }

    setLanguage(lang) {
        if (!this.supportedLangs.includes(lang)) {
            lang = this.defaultLang;
        }
        
        localStorage.setItem('language', lang);
        this.applyTranslations();
    }

    applyTranslations() {
        const lang = this.getCurrentLang();
        const translations = this.translations[lang] || this.translations[this.defaultLang];
        
        // 使用数据属性标记需要翻译的元素
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const keys = element.getAttribute('data-i18n').split('.');
            let value = translations;
            
            for (const key of keys) {
                if (value && value[key]) {
                    value = value[key];
                } else {
                    value = null;
                    break;
                }
            }
            
            if (value) {
                if (element.tagName === 'INPUT' && element.type === 'placeholder') {
                    element.placeholder = value;
                } else {
                    element.textContent = value;
                }
            }
        });
        
        // 更新属性翻译
        document.querySelectorAll('[data-i18n-attr]').forEach(element => {
            const attrData = element.getAttribute('data-i18n-attr').split(':');
            if (attrData.length !== 2) return;
            
            const attr = attrData[0];
            const keys = attrData[1].split('.');
            
            let value = translations;
            for (const key of keys) {
                if (value && value[key]) {
                    value = value[key];
                } else {
                    value = null;
                    break;
                }
            }
            
            if (value) {
                element.setAttribute(attr, value);
            }
        });
    }
}

// 添加语言图标到 SVG 图标库
document.addEventListener('DOMContentLoaded', () => {
    // 添加语言图标
    const iconsSvg = document.querySelector('svg[style="display: none;"]');
    if (iconsSvg) {
        const languageSymbol = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
        languageSymbol.setAttribute('id', 'language');
        languageSymbol.setAttribute('viewBox', '0 0 24 24');
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z');
        
        languageSymbol.appendChild(path);
        iconsSvg.appendChild(languageSymbol);
    }
    
    // 初始化本地化
    window.localization = new Localization();
});

// 添加语言选择器样式
const style = document.createElement('style');
style.textContent = `
.language-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 16px 0;
}

.language-list button {
    padding: 12px;
    border: none;
    background: var(--bg-color-secondary);
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    font-size: 16px;
}

.language-list button:hover {
    background: var(--primary-color);
    color: white;
}
`;
document.head.appendChild(style); 