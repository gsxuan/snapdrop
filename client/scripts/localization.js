class Localization {
    constructor() {
        this.defaultLang = 'zh-CN';
        this.supportedLangs = ['zh-CN'];
        this.translations = {
            'zh-CN': {
                'title': '讯传',
                'header': {
                    'enable_notifications': '启用通知'
                },
                'main': {
                    'no_peers': '在其他设备上打开讯传以发送文件',
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
                }
            }
        };

        this.applyTranslations();
    }

    getCurrentLang() {
        return 'zh-CN';
    }

    applyTranslations() {
        const lang = this.getCurrentLang();
        const translations = this.translations[lang];
        
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

document.addEventListener('DOMContentLoaded', () => {
    // 初始化本地化
    window.localization = new Localization();
}); 