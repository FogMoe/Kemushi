// i18n国际化模块
class I18n {
    constructor() {
        this.currentLang = 'zh-CN'; // 默认语言
        this.translations = {};
        this.loadedLanguages = new Set();
        this.loadSavedLanguage(); // 从文件加载保存的语言设置
    }

    // 从文件加载保存的语言设置
    async loadSavedLanguage() {
        try {
            if (window.electronAPI && window.electronAPI.getAppSettings) {
                const settings = await window.electronAPI.getAppSettings();
                if (settings && settings.language) {
                    this.currentLang = settings.language;
                    await this.loadLanguage(this.currentLang);
                    this.updatePageTexts();
                }
            }
        } catch (error) {
            console.error('加载语言设置失败:', error);
            // 如果加载失败，使用默认语言
            await this.loadLanguage(this.currentLang);
            this.updatePageTexts();
        }
    }

    // 加载语言文件
    async loadLanguage(lang) {
        if (this.loadedLanguages.has(lang)) {
            return;
        }

        try {
            // 通过Electron API加载语言文件
            if (window.electronAPI && window.electronAPI.loadLanguageFile) {
                const translations = await window.electronAPI.loadLanguageFile(lang);
                this.translations[lang] = translations;
                this.loadedLanguages.add(lang);
            } else {
                // 备用方案：直接加载JSON文件
                const response = await fetch(`../src/i18n/${lang}.json`);
                if (response.ok) {
                    this.translations[lang] = await response.json();
                    this.loadedLanguages.add(lang);
                }
            }
        } catch (error) {
            console.error(`加载语言文件失败: ${lang}`, error);
        }
    }

    // 设置当前语言
    async setLanguage(lang) {
        await this.loadLanguage(lang);
        this.currentLang = lang;
        
        // 保存语言设置到文件
        if (window.electronAPI && window.electronAPI.saveAppSettings) {
            try {
                await window.electronAPI.saveAppSettings({ language: lang });
            } catch (error) {
                console.error('保存语言设置失败:', error);
            }
        }
        
        this.updatePageTexts();
    }

    // 获取翻译文本
    t(key, params = {}) {
        const keys = key.split('.');
        let value = this.translations[this.currentLang];
        
        for (const k of keys) {
            if (value && typeof value === 'object') {
                value = value[k];
            } else {
                return key; // 如果找不到翻译，返回key
            }
        }

        // 替换参数
        if (typeof value === 'string') {
            Object.keys(params).forEach(param => {
                value = value.replace(`{${param}}`, params[param]);
            });
        }

        return value || key;
    }

    // 更新页面上的所有文本
    updatePageTexts() {
        // 更新所有带有data-i18n属性的元素
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            const text = this.t(key);
            
            if (element.tagName === 'INPUT' && element.hasAttribute('placeholder')) {
                element.placeholder = text;
            } else {
                element.textContent = text;
            }
        });

        // 更新所有带有data-i18n-title属性的元素
        document.querySelectorAll('[data-i18n-title]').forEach(element => {
            const key = element.getAttribute('data-i18n-title');
            element.title = this.t(key);
        });

        // 更新页面标题
        document.title = `${this.t('app.name')} - ${this.t('app.title')}`;

        // 触发自定义事件，通知语言已更改
        window.dispatchEvent(new CustomEvent('languageChanged', { 
            detail: { language: this.currentLang } 
        }));
    }

    // 获取当前语言
    getCurrentLanguage() {
        return this.currentLang;
    }

    // 获取支持的语言列表
    getSupportedLanguages() {
        return [
            { code: 'zh-CN', name: '简体中文' },
            { code: 'zh-TW', name: '繁體中文' }
        ];
    }
}

// 创建全局i18n实例
window.i18n = new I18n();

// 初始化i18n
async function initI18n() {
    // 等待语言设置加载完成
    // loadSavedLanguage已经在构造函数中调用了
    // 这里只需要确保默认语言已加载
    if (!window.i18n.loadedLanguages.has(window.i18n.currentLang)) {
        await window.i18n.loadLanguage(window.i18n.currentLang);
        window.i18n.updatePageTexts();
    }
}

// DOM加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initI18n);
} else {
    initI18n();
} 