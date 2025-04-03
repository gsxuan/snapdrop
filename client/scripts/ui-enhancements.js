class UIEnhancements {
    constructor() {
        this.initThemeToggle();
        this.applyTheme();
    }

    initThemeToggle() {
        const themeToggle = document.getElementById('theme-toggle');
        const themeIcon = document.getElementById('theme-icon');
        
        if (!themeToggle) return;
        
        themeToggle.addEventListener('click', (e) => {
            e.preventDefault();
            
            const currentTheme = this.getTheme();
            const newTheme = currentTheme === 'light' ? 'dark' : 'light';
            
            this.setTheme(newTheme);
            this.updateThemeIcon(newTheme);
        });
    }

    getTheme() {
        return localStorage.getItem('theme') || this.getPreferredTheme();
    }

    getPreferredTheme() {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches 
            ? 'dark' 
            : 'light';
    }

    setTheme(theme) {
        localStorage.setItem('theme', theme);
        document.documentElement.setAttribute('data-theme', theme);
    }

    updateThemeIcon(theme) {
        const themeIcon = document.getElementById('theme-icon');
        if (!themeIcon) return;

        const iconUse = themeIcon.querySelector('use');
        if (!iconUse) return;

        iconUse.setAttribute('xlink:href', theme === 'dark' ? '#light-mode' : '#dark-mode');
    }

    applyTheme() {
        const theme = this.getTheme();
        this.setTheme(theme);
        this.updateThemeIcon(theme);
    }
}

// Initialize UI enhancements when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.uiEnhancements = new UIEnhancements();
}); 