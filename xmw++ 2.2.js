// ==UserScript==
// @name         XMW++
// @namespace    https://github.com/Toushou-114514/XMWPP
// @version      2.2.0
// @description  小码王社区 · 多功能工具箱
// @author       Toushou
// @match        https://world.xiaomawang.com/*
// @icon         https://world.xiaomawang.com/favicon.ico
// @license      MIT
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
    'use strict';

    // ============================================================
    // 1. 配置存储
    // ============================================================

    const STORAGE_KEY = 'xmwpp_v2_settings';

    const defaultSettings = {
        showUserId: true,
        darkMode: false,
        autoSign: false,
        autoClaimRewards: false,
        rgbMode: false,
        customWallpaper: false,
        customFont: '',
        wallpaperUrl: '',
        autoLinkify: false,
        floatPos: { x: null, y: null },
    };

    let settings = { ...defaultSettings };
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            settings = { ...settings, ...parsed };
        }
    } catch (e) {}

    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch (e) {}
    }

    // ============================================================
    // 2. 工具函数
    // ============================================================

    function estimateRegisterTime(userId) {
        if (!userId) return '未知';
        const idNum = parseInt(userId);
        if (isNaN(idNum)) return '未知';

        const refPoints = [
            { id: 100000, date: new Date(2020, 0, 1) },
            { id: 500000, date: new Date(2021, 0, 1) },
            { id: 1000000, date: new Date(2022, 0, 1) },
            { id: 2000000, date: new Date(2023, 0, 1) },
            { id: 3500000, date: new Date(2024, 0, 1) },
            { id: 5000000, date: new Date(2025, 0, 1) },
            { id: 7000000, date: new Date(2026, 0, 1) }
        ];

        if (idNum <= refPoints[0].id) return formatDate(refPoints[0].date);
        if (idNum >= refPoints[refPoints.length - 1].id) return formatDate(refPoints[refPoints.length - 1].date);

        for (let i = 0; i < refPoints.length - 1; i++) {
            const p1 = refPoints[i];
            const p2 = refPoints[i + 1];
            if (idNum >= p1.id && idNum < p2.id) {
                const ratio = (idNum - p1.id) / (p2.id - p1.id);
                const estTime = new Date(p1.date.getTime() + (p2.date.getTime() - p1.date.getTime()) * ratio);
                return formatDate(estTime);
            }
        }
        return formatDate(refPoints[refPoints.length - 1].date);
    }

    function formatDate(date) {
        return date.getFullYear() + '年' + String(date.getMonth() + 1).padStart(2, '0') + '月';
    }

    // ============================================================
    // 3. 功能实现
    // ============================================================

    // 3.1 用户ID
    function displayUserId() {
        if (!settings.showUserId) return;

        const match = window.location.href.match(/\/person\/project\/all\/(\d+)/);
        if (!match) return;
        const userId = match[1];

        let username = null;
        const selectors = [
            '[class*="user-info-card__NickName-sc-"]',
            '[class*="NickName-sc-"]',
            '.nickname',
            '[class*="nickname__"]'
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.textContent.trim()) {
                username = el;
                break;
            }
        }
        if (!username) return;

        if (!document.querySelector('.xmwpp-user-id')) {
            const span = document.createElement('span');
            span.className = 'xmwpp-user-id';
            span.textContent = ' #' + userId;
            Object.assign(span.style, {
                fontSize: 'inherit !important',
                fontWeight: 'normal !important',
                color: '#000000 !important',
                opacity: '0.7 !important',
                marginLeft: '6px !important',
                display: 'inline !important'
            });
            username.parentNode.insertBefore(span, username.nextSibling);
        }

        let card = null;
        const headers = document.querySelectorAll('div, span, h1, h2, h3, h4, h5');
        for (const el of headers) {
            if (el.textContent.trim() === '个人名片') {
                let parent = el.parentElement;
                while (parent) {
                    if (parent.getBoundingClientRect().height > 100) {
                        card = parent;
                        break;
                    }
                    parent = parent.parentElement;
                }
                if (!card) card = el.closest('div, section');
                break;
            }
        }

        if (!card) {
            const textNodes = document.querySelectorAll('div, span, p');
            for (const el of textNodes) {
                if (el.textContent.includes('性别') && el.textContent.includes('年龄')) {
                    card = el.closest('div, section');
                    break;
                }
            }
        }

        if (card && !document.querySelector('.xmwpp-card-info')) {
            const regTime = estimateRegisterTime(userId);
            const infoBlock = document.createElement('div');
            infoBlock.className = 'xmwpp-card-info';
            Object.assign(infoBlock.style, {
                marginTop: '12px',
                padding: '8px 12px',
                background: 'rgba(124,92,255,0.06)',
                borderRadius: '8px',
                border: '1px solid rgba(124,92,255,0.10)',
                fontSize: '13px',
                lineHeight: '1.6'
            });
            infoBlock.innerHTML = `
                <div style="display:flex;gap:8px;color:#444;">
                    <span style="opacity:0.5;">ID</span>
                    <span style="font-weight:500;">用户ID</span>
                    <span style="color:#000;font-weight:600;font-family:monospace;">${userId}</span>
                </div>
                <div style="display:flex;gap:8px;color:#444;margin-top:4px;font-size:12px;opacity:0.8;">
                    <span style="opacity:0.5;">📅</span>
                    <span style="font-weight:500;">注册时间</span>
                    <span style="color:#000;font-weight:500;">${regTime}（估算）</span>
                </div>
            `;
            card.appendChild(infoBlock);
        }
    }

    function removeUserId() {
        document.querySelectorAll('.xmwpp-user-id, .xmwpp-card-info').forEach(el => el.remove());
    }

    // 3.2 深色模式
    function toggleDarkMode(enable) {
        const styleId = 'xmwpp-dark-mode';
        const oldStyle = document.getElementById(styleId);
        if (oldStyle) oldStyle.remove();
        if (!enable) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            html, body {
                background: #0d0d0d !important;
                color: #e0e0e0 !important;
            }
            div, section, article, header, footer, nav, aside, main,
            .container, .wrapper, .content, .box, .card, .panel {
                background-color: transparent !important;
            }
            [class*="work"], [class*="project"], [class*="card"],
            [class*="item"], .comment, .comments {
                background-color: #1a1a1a !important;
                color: #e0e0e0 !important;
            }
            .xmwpp-toolkit-popup {
                background-color: #1a1a1a !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
                color: #e0e0e0 !important;
                transition: all 0.3s ease !important;
            }
            .xmwpp-toolkit-popup div,
            .xmwpp-toolkit-popup span,
            .xmwpp-toolkit-popup p {
                background-color: transparent !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
                color: #e0e0e0 !important;
            }
            .xmwpp-toolkit-popup div[style*="background:"] {
                background: transparent !important;
            }
            .xmwpp-toolkit-popup [style*="color:#333"] {
                color: #e0e0e0 !important;
            }
            .xmwpp-toolkit-popup hr {
                border-color: #333 !important;
            }
            .xmwpp-toolkit-popup span[style*="color:#333"] {
                color: #e0e0e0 !important;
            }
            .xmwpp-toolkit-popup-overlay {
                background: rgba(0,0,0,0.5) !important;
                backdrop-filter: blur(4px) !important;
                -webkit-backdrop-filter: blur(4px) !important;
            }
            input, textarea, select {
                background-color: #2a2a2a !important;
                color: #e0e0e0 !important;
                border-color: #444 !important;
            }
            button, .btn {
                background-color: #2a2a2a !important;
                color: #e0e0e0 !important;
                border-color: #444 !important;
            }
            .header, .nav, .topbar, [class*="header"], [class*="nav"] {
                background-color: #141414 !important;
                color: #e0e0e0 !important;
            }
            .footer, [class*="footer"] {
                background-color: #141414 !important;
                color: #888 !important;
            }
            p, span, div, li, a, .text, .desc, .name, .content {
                color: #e0e0e0 !important;
            }
            a, .link { color: #6ea8fe !important; }
            a:hover, .link:hover { color: #90caf9 !important; }
            hr, .divider { border-color: #333 !important; }
            ::-webkit-scrollbar { width: 8px !important; background: #1a1a1a !important; }
            ::-webkit-scrollbar-thumb { background: #3a3a3a !important; border-radius: 4px !important; }
            * { scrollbar-color: #3a3a3a #1a1a1a !important; }
        `;
        document.head.appendChild(style);
        console.log('[XMW++] 深色模式已启用');
    }

    // 3.3 签到（检测到就点击，无每日限制）
    function doSign() {
        console.log('[XMW++] 尝试签到...');

        const selectors = ['[class*="sign"]', '[class*="checkin"]', '[class*="签到"]', '[class*="daily"]'];
        let signBtn = null;
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && (el.textContent.includes('签到') || el.textContent.includes('打卡') || el.textContent.includes('每日'))) {
                signBtn = el;
                break;
            }
        }

        if (!signBtn) {
            const allBtns = document.querySelectorAll('button, a, span, div');
            for (const el of allBtns) {
                const text = el.textContent.trim();
                if (text === '签到' || text === '打卡' || text.includes('每日签到')) {
                    signBtn = el;
                    break;
                }
            }
        }

        if (signBtn) {
            signBtn.click();
            console.log('[XMW++] ✅ 签到成功！');
            return true;
        } else {
            console.log('[XMW++] ⚠️ 未找到签到按钮');
            return false;
        }
    }

    function autoSign() {
        if (!settings.autoSign) return;
        doSign();
    }

    // 3.4 RGB模式
    let rgbInterval = null;

    function toggleRgbMode(enable) {
        const styleId = 'xmwpp-rgb-mode';
        const oldStyle = document.getElementById(styleId);
        if (oldStyle) oldStyle.remove();
        if (rgbInterval) { clearInterval(rgbInterval); rgbInterval = null; }
        if (!enable) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            body * {
                color: hsl(0, 80%, 55%) !important;
                transition: color 0.05s ease !important;
            }
            .xmwpp-toolkit-popup-overlay, .xmwpp-toolkit-popup-overlay * { color: inherit !important; }
            .xmwpp-toolkit-popup button, .xmwpp-toolkit-popup button * { color: #fff !important; }
            .xmwpp-toolkit-popup [style*="background:"] { color: #fff !important; }
            .xmwpp-toolkit-popup [id*="toggle-"] { color: #fff !important; }
            .xmwpp-toolkit-popup #xmwpp-manual-sign { color: #fff !important; }
            .xmwpp-toolkit-popup #xmwpp-close-popup { color: #999 !important; }
        `;
        document.head.appendChild(style);

        let hue = 0;
        rgbInterval = setInterval(() => {
            const color = `hsl(${hue}, 80%, 55%)`;
            const el = document.getElementById(styleId);
            if (el) {
                el.textContent = `
                    body * { color: ${color} !important; transition: color 0.05s ease !important; }
                    .xmwpp-toolkit-popup-overlay, .xmwpp-toolkit-popup-overlay * { color: inherit !important; }
                    .xmwpp-toolkit-popup button, .xmwpp-toolkit-popup button * { color: #fff !important; }
                    .xmwpp-toolkit-popup [style*="background:"] { color: #fff !important; }
                    .xmwpp-toolkit-popup [id*="toggle-"] { color: #fff !important; }
                    .xmwpp-toolkit-popup #xmwpp-manual-sign { color: #fff !important; }
                    .xmwpp-toolkit-popup #xmwpp-close-popup { color: #999 !important; }
                `;
            }
            hue = (hue + 1.5) % 360;
        }, 30);
        console.log('[XMW++] RGB模式已启用');
    }

    // 3.5 自定义壁纸
    function applyWallpaper(url) {
        if (!url || !url.trim()) {
            restoreDefaultWallpaper();
            return;
        }

        const bg = document.querySelector('div.bgImg__1veTq');
        if (bg) {
            const trimmed = url.trim();
            if (trimmed.startsWith('#')) {
                bg.style.setProperty('background-image', 'none', 'important');
                bg.style.setProperty('background-color', trimmed, 'important');
                console.log('[XMW++] 纯色背景已应用:', trimmed);
            } else {
                bg.style.setProperty('background-image', `url(${trimmed})`, 'important');
                bg.style.setProperty('background-size', 'cover', 'important');
                bg.style.setProperty('background-position', 'center center', 'important');
                bg.style.setProperty('background-repeat', 'no-repeat', 'important');
                bg.style.setProperty('background-attachment', 'fixed', 'important');
                console.log('[XMW++] 壁纸已应用 (cover模式)');
            }
        }
    }

    function restoreDefaultWallpaper() {
        const bg = document.querySelector('div.bgImg__1veTq');
        if (bg) {
            bg.style.setProperty('background-image', '', 'important');
            bg.style.setProperty('background-color', '', 'important');
        }
        settings.wallpaperUrl = '';
        saveSettings();
        console.log('[XMW++] 已恢复默认背景');
    }

    function toggleCustomWallpaper(enable) {
        if (enable) {
            if (settings.wallpaperUrl) applyWallpaper(settings.wallpaperUrl);
        } else {
            restoreDefaultWallpaper();
        }
    }

    // 3.6 全局字体
    let fontApplyTimer = null;

    function loadGoogleFontLink(fontName) {
        const oldLink = document.getElementById('xmwpp-google-font-link');
        if (oldLink) oldLink.remove();

        if (!fontName || !fontName.trim()) return;

        const formatted = fontName.trim().replace(/ /g, '+');
        const link = document.createElement('link');
        link.id = 'xmwpp-google-font-link';
        link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${formatted}:wght@400;500;600;700&display=swap`;
        document.head.appendChild(link);
        console.log('[XMW++] Google Font 链接已添加:', fontName);
    }

    function forceApplyFontToAllElements(fontName) {
        if (!fontName || !fontName.trim()) {
            return;
        }

        const fontFamily = `"${fontName.trim()}", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif`;

        let style = document.getElementById('xmwpp-font-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'xmwpp-font-style';
            document.head.appendChild(style);
        }
        style.textContent = `
            * {
                font-family: ${fontFamily} !important;
            }
            html, body {
                font-family: ${fontFamily} !important;
            }
            [style*="font-family"] {
                font-family: ${fontFamily} !important;
            }
        `;

        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
            try {
                el.style.setProperty('font-family', fontFamily, 'important');
            } catch(e) {}
        }

        try {
            document.body.style.setProperty('font-family', fontFamily, 'important');
            document.documentElement.style.setProperty('font-family', fontFamily, 'important');
        } catch(e) {}

        console.log('[XMW++] 字体已强制应用到所有元素:', fontName);
    }

    function startFontPersistence(fontName) {
        if (fontApplyTimer) {
            clearInterval(fontApplyTimer);
            fontApplyTimer = null;
        }

        if (!fontName || !fontName.trim()) {
            return;
        }

        loadGoogleFontLink(fontName);

        setTimeout(() => {
            forceApplyFontToAllElements(fontName);
        }, 100);

        fontApplyTimer = setInterval(() => {
            if (settings.customFont && settings.customFont.trim()) {
                forceApplyFontToAllElements(settings.customFont);
            }
        }, 1000);
    }

    function stopFontPersistence() {
        if (fontApplyTimer) {
            clearInterval(fontApplyTimer);
            fontApplyTimer = null;
        }
        const style = document.getElementById('xmwpp-font-style');
        if (style) style.remove();
        const link = document.getElementById('xmwpp-google-font-link');
        if (link) link.remove();
        console.log('[XMW++] 已停止字体强制应用');
    }

    function toggleCustomFont(fontName) {
        if (fontName && fontName.trim()) {
            stopFontPersistence();
            settings.customFont = fontName.trim();
            saveSettings();
            startFontPersistence(fontName.trim());
        } else {
            stopFontPersistence();
            settings.customFont = '';
            saveSettings();
            console.log('[XMW++] 已恢复默认字体');
        }
    }

    // 3.7 网页缩放控制
    function getSavedZoom() {
        try {
            const saved = localStorage.getItem('xmwpp_zoom_level');
            if (saved) {
                const val = parseInt(saved);
                if (!isNaN(val) && val >= 30 && val <= 200) return val;
            }
        } catch(e) {}
        return 100;
    }

    function initZoom() {
        const zoom = getSavedZoom();
        document.body.style.zoom = zoom / 100;
        console.log('[XMW++] 缩放已应用:', zoom + '%');
    }

    // 3.8 自动领取奖励
    function autoClaimRewards() {
        if (!settings.autoClaimRewards) return false;
        console.log('[XMW++] 尝试领取奖励...');

        let claimed = 0;

        const claimSelectors = [
            '[class*="claim"]',
            '[class*="receive"]',
            '[class*="领取"]',
            '[class*="reward"]'
        ];

        for (const sel of claimSelectors) {
            document.querySelectorAll(sel).forEach(el => {
                const text = el.textContent.trim();
                if (text.includes('领取') && !text.includes('已领取') && !text.includes('已领完')) {
                    try {
                        el.click();
                        claimed++;
                        console.log('[XMW++] 领取了一个奖励');
                    } catch(e) {}
                }
            });
        }

        if (claimed === 0) {
            document.querySelectorAll('button, a, span, div').forEach(el => {
                const text = el.textContent.trim();
                if ((text === '领取' || text === '立即领取' || text === '点击领取') && el.offsetParent !== null) {
                    try {
                        el.click();
                        claimed++;
                        console.log('[XMW++] 领取了一个奖励');
                    } catch(e) {}
                }
            });
        }

        if (claimed > 0) {
            console.log('[XMW++] ✅ 共领取了 ' + claimed + ' 个奖励');
        } else {
            console.log('[XMW++] 没有可领取的奖励');
        }
        return claimed > 0;
    }

    // ============================================================
    // 3.9 自动识别文本链接（识别后变蓝，点击跳转）
    // ============================================================

    const XMWPP_LINK_COLOR = '#1677ff';

    // 需要跳过的容器：脚本自身 UI、可编辑区、已有 <a>、代码/多媒体元素等
    const XMWPP_LINK_SKIP_SELECTOR = [
        '.xmwpp-toolkit-popup',
        '.xmwpp-toolkit-popup-overlay',
        '.xmwpp-float-ball',
        '.xmwpp-user-id',
        '.xmwpp-card-info',
        'a', 'button', 'textarea', 'script', 'style', 'noscript',
        'code', 'pre', 'kbd', 'samp',
        '[contenteditable="true"]', '[contenteditable=""]',
        'input', 'select', 'option', 'video', 'audio', 'canvas', 'svg', 'iframe'
    ].join(',');

    // 链接匹配：http(s)://… 、www.… 、裸域名(含常见 TLD) 、裸 IP
    const XMWPP_URL_SOURCE = [
        '\\bhttps?:\\/\\/[^\\s<>"\'`\\u3000-\\u303f\\uff00-\\uffef]+',
        '\\bwww\\.[^\\s<>"\'`\\u3000-\\u303f\\uff00-\\uffef]+',
        '\\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\.)+(?:com|cn|net|org|edu|gov|io|me|tv|cc|xyz|top|vip|club|site|online|shop|store|app|dev|info|biz|pro|fun|icu|ren|wang|xin|live|link|work|space|tech|art|design|studio|group|team|news|blog|wiki|zone|mobi|asia|co|la|so|gs|li|gd|im|us|uk|jp|kr|de|fr|ru|au|ca|br|in|it|es|nl|ch|se|no|fi|dk|pl|tw|hk|sg|my|th|vn|ph|id|cx|ly|to|am|fm|gg|gl|is|lt|lv|ee|pt|gr|cz|sk|hu|ro|bg|hr|si|rs|ua|by|kz|md|ge|ir|iq|sa|ae|il|tr|za|ng|ke|eg|ma|mx|ar|cl|pe|ve|ec|uy|py|bo|cr|pa|do|gt|sv|hn|ni|cu|pr)',
        '\\b(?:\\d{1,3}\\.){3}\\d{1,3}(?::\\d{2,5})?'
    ].join('|');

    const XMWPP_URL_RE = new RegExp('(?:' + XMWPP_URL_SOURCE + ')(?::\\d{2,5})?(?:\\/[^\\s<>"\'`\\u3000-\\u303f\\uff00-\\uffef]*)?', 'gi');

    // 句末标点 / 括号不算链接的一部分
    const XMWPP_TRAILING_RE = /[.,;:!?，。；：！？、）)】」》"'”’\]]+$/;

    function normalizeUrl(raw, base) {
        const s = (raw || '').trim();
        if (!s) return '';
        if (/^https?:\/\//i.test(s)) return s;
        if (/^\/\//.test(s)) return 'https:' + s;
        if (/^www\./i.test(s)) return 'http://' + s;
        if (/^(?:\d{1,3}\.){3}\d{1,3}/.test(s)) return 'http://' + s;
        try {
            return new URL(s, base || location.href).href;
        } catch (e) {
            return 'https://' + s;
        }
    }

    // 判断父节点是否为纯文本容器（只含行内子元素才算）
    function isTextContainer(el) {
        if (!el || el.nodeType !== 1) return false;
        if (el.classList && el.classList.contains('xmwpp-link')) return false;
        for (const child of el.children) {
            const tag = child.tagName;
            if (tag === 'BR' || tag === 'SPAN' || tag === 'B' || tag === 'I' || tag === 'EM' ||
                tag === 'STRONG' || tag === 'U' || tag === 'S' || tag === 'SMALL' ||
                tag === 'SUB' || tag === 'SUP' || tag === 'FONT' || tag === 'MARK') {
                continue;
            }
            return false;
        }
        return true;
    }

    // 收集页面中的纯文本节点，跳过脚本 UI 与已处理区域
    function xmwppCollectTextNodes(root) {
        const result = [];
        const target = root || document.body;
        if (!target) return result;
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const text = node.nodeValue;
                if (!text || text.length < 4) return NodeFilter.FILTER_REJECT;
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                if (parent.closest(XMWPP_LINK_SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
                if (!isTextContainer(parent)) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let n;
        while ((n = walker.nextNode())) result.push(n);
        return result;
    }

    // 把一段文本里的链接替换成蓝色可点击的 <a>
    function xmwppLinkifyTextNode(textNode) {
        const text = textNode.nodeValue;
        XMWPP_URL_RE.lastIndex = 0;
        if (!XMWPP_URL_RE.test(text)) return false;
        XMWPP_URL_RE.lastIndex = 0;

        const frag = document.createDocumentFragment();
        let lastIndex = 0;
        let matched = false;
        let m;

        while ((m = XMWPP_URL_RE.exec(text)) !== null) {
            const raw = m[0];
            let href = raw;

            // 去掉结尾的标点 / 括号
            const trailing = href.match(XMWPP_TRAILING_RE);
            if (trailing) {
                href = href.slice(0, href.length - trailing[0].length);
            }
            if (!href) continue;

            // 至少要像个域名或带协议的地址
            if (!/^https?:\/\//i.test(href) && !/^www\./i.test(href) &&
                !/^(?:\d{1,3}\.){3}\d{1,3}/.test(href) && !/\.[a-zA-Z]{2,}/.test(href)) {
                continue;
            }

            matched = true;

            if (m.index > lastIndex) {
                frag.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
            }

            const a = document.createElement('a');
            a.className = 'xmwpp-link';
            a.href = normalizeUrl(href);
            a.textContent = href;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.title = a.href;
            Object.assign(a.style, {
                color: XMWPP_LINK_COLOR + ' !important',
                textDecoration: 'underline !important',
                textUnderlineOffset: '2px',
                cursor: 'pointer !important',
                wordBreak: 'break-all'
            });
            // 点击链接文本 → 跳转（阻止冒泡，避免触发卡片自身的点击逻辑）
            a.addEventListener('click', function(ev) {
                ev.stopPropagation();
                if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) return;
                ev.preventDefault();
                window.open(this.href, '_blank', 'noopener');
            });

            frag.appendChild(a);
            lastIndex = m.index + raw.length;
        }

        if (!matched) return false;
        if (lastIndex < text.length) {
            frag.appendChild(document.createTextNode(text.slice(lastIndex)));
        }
        textNode.parentNode.replaceChild(frag, textNode);
        return true;
    }

    let linkifyObserver = null;
    let linkifyQueued = false;

    function runLinkifyNow() {
        if (!settings.autoLinkify) return 0;
        let count = 0;
        const nodes = xmwppCollectTextNodes(document.body);
        for (const node of nodes) {
            try {
                if (xmwppLinkifyTextNode(node)) count++;
            } catch (e) {}
        }
        if (count > 0) console.log('[XMW++] 🔗 已识别并高亮 ' + count + ' 处链接');
        return count;
    }

    function scheduleLinkify() {
        if (!settings.autoLinkify || linkifyQueued) return;
        linkifyQueued = true;
        setTimeout(() => {
            linkifyQueued = false;
            runLinkifyNow();
        }, 300);
    }

    function linkifyStyle() {
        let style = document.getElementById('xmwpp-link-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'xmwpp-link-style';
            document.head.appendChild(style);
        }
        style.textContent = `
            a.xmwpp-link, a.xmwpp-link:visited {
                color: ${XMWPP_LINK_COLOR} !important;
                text-decoration: underline !important;
                text-underline-offset: 2px !important;
                cursor: pointer !important;
                word-break: break-all !important;
            }
            a.xmwpp-link:hover, a.xmwpp-link:active {
                color: #0958d9 !important;
            }
        `;
    }

    function removeLinkified() {
        document.querySelectorAll('a.xmwpp-link').forEach(a => {
            const parent = a.parentNode;
            if (!parent) return;
            parent.replaceChild(document.createTextNode(a.textContent), a);
            parent.normalize();
        });
    }

    function toggleAutoLinkify(enable) {
        settings.autoLinkify = enable;
        saveSettings();

        if (enable) {
            linkifyStyle();
            const n = runLinkifyNow();
            if (linkifyObserver) linkifyObserver.disconnect();
            linkifyObserver = new MutationObserver(() => scheduleLinkify());
            linkifyObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
            console.log('[XMW++] 🔗 链接识别已启用，当前识别 ' + n + ' 处');
        } else {
            if (linkifyObserver) {
                linkifyObserver.disconnect();
                linkifyObserver = null;
            }
            removeLinkified();
            const style = document.getElementById('xmwpp-link-style');
            if (style) style.remove();
            console.log('[XMW++] 🔗 链接识别已关闭');
        }
    }

    // ============================================================
    // 4. UI - 悬浮球
    // ============================================================

    function addFloatingBall() {
        if (document.querySelector('.xmwpp-float-ball')) return;

        const ball = document.createElement('div');
        ball.className = 'xmwpp-float-ball';
        ball.title = 'XMW++ 工具箱';
        ball.innerHTML = `<img src="https://world.xiaomawang.com/favicon.ico" alt=     "XMW++" style="width:100%;height:100%;object-fit:contain;pointer-events:none;">`;

        const savedX = settings.floatPos?.x;
        const savedY = settings.floatPos?.y;
        const defaultX = window.innerWidth - 70;
        const defaultY = window.innerHeight - 70;

        Object.assign(ball.style, {
            position: 'fixed',
            left: (savedX !== null && savedX !== undefined ? savedX : defaultX) + 'px',
            top: (savedY !== null && savedY !== undefined ? savedY : defaultY) + 'px',
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.95)',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25), 0 0 0 2px rgba(124, 92, 255, 0.4)',
            cursor: 'pointer',
            zIndex: '999998',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            userSelect: 'none',
            padding: '8px',
            boxSizing: 'border-box',
            border: '2px solid #7c5cff',
            overflow: 'hidden',
            touchAction: 'none'
        });

        ball.addEventListener('mouseenter', function() {
            if (isDragging) return;
            this.style.transform = 'scale(1.1)';
            this.style.boxShadow = '0 6px 28px rgba(0, 0, 0, 0.3), 0 0 0 4px rgba(124, 92, 255, 0.5)';
        });
        ball.addEventListener('mouseleave', function() {
            this.style.transform = 'scale(1)';
            this.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.25), 0 0 0 2px rgba(124, 92, 255, 0.4)';
        });

        let isDragging = false;
        let hasMoved = false;
        let startX = 0, startY = 0, startLeft = 0, startTop = 0;
        const DRAG_THRESHOLD = 8;
        const BALL_SIZE = 52; // 48 + 边框/内边距的视觉占用

        function getLeft() {
            const v = parseInt(ball.style.left, 10);
            return isNaN(v) ? defaultX : v;
        }
        function getTop() {
            const v = parseInt(ball.style.top, 10);
            return isNaN(v) ? defaultY : v;
        }
        function clamp(v, max) {
            return Math.max(0, Math.min(max, v));
        }
        function endDrag() {
            isDragging = false;
            ball.style.cursor = 'pointer';
            ball.style.transition = 'transform 0.2s ease, box-shadow 0.2s ease';
            if (hasMoved) {
                settings.floatPos = { x: getLeft(), y: getTop() };
                if (typeof saveSettings === 'function') saveSettings();
            }
        }

    // ------- 鼠标 -------
        ball.addEventListener('mousedown', function(e) {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            isDragging = true;
            hasMoved = false;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = getLeft();
            startTop = getTop();
            this.style.cursor = 'grabbing';
            this.style.transition = 'none';
        });
    
        document.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (!hasMoved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
                hasMoved = true;
            }
            if (!hasMoved) return;
            ball.style.left = clamp(startLeft + dx, window.innerWidth - BALL_SIZE) + 'px';
            ball.style.top = clamp(startTop + dy, window.innerHeight - BALL_SIZE) + 'px';
        });
    
        document.addEventListener('mouseup', function() {
            if (!isDragging) return;
            const moved = hasMoved;
            endDrag();
            if (!moved) {
                try { showToolkitPopup(); } catch (err) { console.error('[XMW++] showToolkitPopup 出错:', err); }
            }
            hasMoved = false;
        });
    
        // ------- 触摸 -------
        ball.addEventListener('touchstart', function(e) {
            const touch = e.touches[0];
            isDragging = true;
            hasMoved = false;
            startX = touch.clientX;
            startY = touch.clientY;
            startLeft = getLeft();
            startTop = getTop();
            this.style.transition = 'none';
            this.style.cursor = 'grabbing';
        }, { passive: true });
    
        document.addEventListener('touchmove', function(e) {
            if (!isDragging) return;
            const touch = e.touches[0];
            const dx = touch.clientX - startX;
            const dy = touch.clientY - startY;
            if (!hasMoved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
                hasMoved = true;
            }
            if (!hasMoved) return;
            if (e.cancelable) e.preventDefault();
            ball.style.left = clamp(startLeft + dx, window.innerWidth - BALL_SIZE) + 'px';
            ball.style.top = clamp(startTop + dy, window.innerHeight - BALL_SIZE) + 'px';
        }, { passive: false });
    
        document.addEventListener('touchend', function() {
            if (!isDragging) return;
            const moved = hasMoved;
            endDrag();
            if (!moved) {
                try { showToolkitPopup(); } catch (err) { console.error('[XMW++] showToolkitPopup 出错:', err); }
            }
            hasMoved = false;
        });
    
        document.addEventListener('touchcancel', function() {
            if (!isDragging) return;
            endDrag();
            hasMoved = false;
        });

        // 阻止 click 冒泡导致的重复触发（popup 已在 mouseup/touchend 打开）
        ball.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
        });

        document.body.appendChild(ball);
        console.log('[XMW++] ✅ 悬浮球已添加');
    }
    // ============================================================
    // 5. UI - Toolkit 弹窗 (三标签页版，800x560，字号已调小)
    // ============================================================

    function showToolkitPopup() {
        // 记住当前标签
        const currentTab = window.__xmwpp_currentTab || 'ui';

        const existing = document.querySelector('.xmwpp-toolkit-popup');
        if (existing) { existing.remove(); return; }

        const overlay = document.createElement('div');
        overlay.className = 'xmwpp-toolkit-popup-overlay';
        Object.assign(overlay.style, {
            position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)', zIndex: '999999',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        const popup = document.createElement('div');
        popup.className = 'xmwpp-toolkit-popup';
        Object.assign(popup.style, {
            background: '#ffffff', borderRadius: '20px',
            width: '800px', height: '560px',
            maxWidth: '90vw', maxHeight: '90vh',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)', position: 'relative',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden'
        });

        const currentZoom = getSavedZoom();
        const state = {
            userId: settings.showUserId,
            dark: settings.darkMode,
            sign: settings.autoSign,
            claimRewards: settings.autoClaimRewards,
            rgb: settings.rgbMode,
            wallpaper: settings.customWallpaper,
            font: settings.customFont || '',
            wallpaperUrl: settings.wallpaperUrl || '',
            linkify: settings.autoLinkify
        };
        const fontExpanded = !!state.font;

        popup.innerHTML = `
            <!-- 顶部标题 -->
            <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 24px 12px;border-bottom:1px solid #f0f0f0;flex-shrink:0;">
                <div style="display:flex;align-items:center;gap:10px;">
                    <img src="https://world.xiaomawang.com/favicon.ico" style="width:26px;height:26px;border-radius:7px;">
                    <span style="font-size:17px;font-weight:700;color:#7c5cff;">XMW++ Toolkit</span>
                </div>
                <button id="xmwpp-close-popup" style="background:none;border:none;font-size:24px;cursor:pointer;color:#999;padding:0 6px;line-height:1;">✕</button>
            </div>

            <!-- 标签栏 -->
            <div style="display:flex;border-bottom:1px solid #f0f0f0;background:#fafafa;flex-shrink:0;">
                <button class="xmwpp-tab" data-tab="ui" style="
                    flex:1;padding:11px 0;background:none;border:none;
                    font-size:14px;font-weight:600;cursor:pointer;
                    color:${currentTab === 'ui' ? '#7c5cff' : '#888'};
                    border-bottom:3px solid ${currentTab === 'ui' ? '#7c5cff' : 'transparent'};
                    transition:all 0.2s;
                ">界面UI</button>
                <button class="xmwpp-tab" data-tab="settings" style="
                    flex:1;padding:11px 0;background:none;border:none;
                    font-size:14px;font-weight:600;cursor:pointer;
                    color:${currentTab === 'settings' ? '#7c5cff' : '#888'};
                    border-bottom:3px solid ${currentTab === 'settings' ? '#7c5cff' : 'transparent'};
                    transition:all 0.2s;
                ">功能设置</button>
                <button class="xmwpp-tab" data-tab="about" style="
                    flex:1;padding:11px 0;background:none;border:none;
                    font-size:14px;font-weight:600;cursor:pointer;
                    color:${currentTab === 'about' ? '#7c5cff' : '#888'};
                    border-bottom:3px solid ${currentTab === 'about' ? '#7c5cff' : 'transparent'};
                    transition:all 0.2s;
                ">关于</button>
            </div>

            <!-- 内容区 -->
            <div style="flex:1;overflow-y:auto;padding:18px 24px;">

                <!-- ===== 界面UI 标签页 ===== -->
                <div class="xmwpp-tab-content" data-content="ui" style="display:${currentTab === 'ui' ? 'block' : 'none'};">
                    <!-- 深色模式 -->
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;">
                        <div style="display:flex;align-items:center;gap:12px;">
                            <span style="font-weight:500;color:#333;font-size:13.5px;">深色模式</span>
                            <span style="font-size:11.5px;color:${state.dark ? '#22c55e' : '#999'};">状态: ${state.dark ? '已启用' : '已关闭'}</span>
                        </div>
                        <button id="xmwpp-toggle-dark" style="background:${state.dark ? '#ccc' : '#7c5cff'};color:#fff;border:none;padding:5px 18px;border-radius:22px;font-size:12.5px;cursor:pointer;font-weight:500;">${state.dark ? '关闭' : '启用'}</button>
                    </div>

                    <hr style="border:none;border-top:1px solid #f0f0f0;margin:11px 0;">

                    <!-- RGB模式 -->
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;">
                        <div style="display:flex;align-items:center;gap:12px;">
                            <span style="font-weight:500;color:#333;font-size:13.5px;">RGB模式</span>
                            <span style="font-size:11.5px;color:${state.rgb ? '#22c55e' : '#999'};">状态: ${state.rgb ? '已启用' : '已关闭'}</span>
                        </div>
                        <button id="xmwpp-toggle-rgb" style="background:${state.rgb ? '#ccc' : '#7c5cff'};color:#fff;border:none;padding:5px 18px;border-radius:22px;font-size:12.5px;cursor:pointer;font-weight:500;">${state.rgb ? '关闭' : '启用'}</button>
                    </div>

                    <hr style="border:none;border-top:1px solid #f0f0f0;margin:11px 0;">

                    <!-- 自定义壁纸 -->
                    <div>
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;">
                            <div style="display:flex;align-items:center;gap:12px;">
                                <span style="font-weight:500;color:#333;font-size:13.5px;">自定义主页壁纸</span>
                                <span style="font-size:11.5px;color:${state.wallpaper ? '#22c55e' : '#999'};">状态: ${state.wallpaper ? '已启用' : '未启用'}</span>
                            </div>
                            <button id="xmwpp-toggle-wallpaper" style="background:${state.wallpaper ? '#ccc' : '#7c5cff'};color:#fff;border:none;padding:5px 18px;border-radius:22px;font-size:12.5px;cursor:pointer;font-weight:500;">${state.wallpaper ? '关闭' : '启用'}</button>
                        </div>
                        <div id="xmwpp-wallpaper-options" style="display:${state.wallpaper ? 'block' : 'none'};margin-top:8px;padding:12px 14px;background:#f5f5f5;border-radius:12px;border:1px solid #eee;">
                            <div style="margin-bottom:10px;">
                                <input type="file" id="xmwpp-wallpaper-file" accept="image/*" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;background:#fff;color:#333;">
                            </div>
                            <div style="margin-bottom:10px;">
                                <input type="text" id="xmwpp-wallpaper-url" value="${state.wallpaperUrl}" placeholder="#1a1a2e 或 图片URL" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;background:#fff;color:#222;box-sizing:border-box;">
                            </div>
                            <div style="display:flex;gap:8px;">
                                <button id="xmwpp-wallpaper-apply" style="background:#7c5cff;color:#fff;border:none;padding:7px 18px;border-radius:8px;font-size:12.5px;cursor:pointer;font-weight:500;">确定</button>
                                <button id="xmwpp-wallpaper-reset" style="background:#ef4444;color:#fff;border:none;padding:7px 18px;border-radius:8px;font-size:12.5px;cursor:pointer;font-weight:500;">恢复默认</button>
                            </div>
                            <div id="xmwpp-wallpaper-status" style="margin-top:8px;font-size:11.5px;color:#888;min-height:18px;"></div>
                        </div>
                    </div>

                    <hr style="border:none;border-top:1px solid #f0f0f0;margin:11px 0;">

                    <!-- 用户ID显示 -->
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;">
                        <div style="display:flex;align-items:center;gap:12px;">
                            <span style="font-weight:500;color:#333;font-size:13.5px;">用户信息显示</span>
                            <span style="font-size:11.5px;color:${state.userId ? '#22c55e' : '#999'};">状态: ${state.userId ? '已启用' : '已关闭'}</span>
                        </div>
                        <button id="xmwpp-toggle-userid" style="background:${state.userId ? '#ccc' : '#7c5cff'};color:#fff;border:none;padding:5px 18px;border-radius:22px;font-size:12.5px;cursor:pointer;font-weight:500;">${state.userId ? '关闭' : '启用'}</button>
                    </div>

                    <hr style="border:none;border-top:1px solid #f0f0f0;margin:11px 0;">

                    <!-- 全局字体 -->
                    <div>
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;">
                            <div style="display:flex;align-items:center;gap:12px;">
                                <span style="font-weight:500;color:#333;font-size:13.5px;">全局字体</span>
                                <span style="font-size:11.5px;color:${state.font ? '#22c55e' : '#999'};">状态: ${state.font ? '已启用' : '未启用'}</span>
                            </div>
                            <button id="xmwpp-toggle-font" style="background:${state.font ? '#ccc' : '#7c5cff'};color:#fff;border:none;padding:5px 18px;border-radius:22px;font-size:12.5px;cursor:pointer;font-weight:500;">${state.font ? '关闭' : '启用'}</button>
                        </div>
                        <div id="xmwpp-font-options" style="display:${fontExpanded ? 'block' : 'none'};margin-top:8px;padding:11px 13px;background:#f5f5f5;border-radius:12px;border:1px solid #eee;">
                            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                                <input type="text" id="xmwpp-font-input" value="${state.font}" placeholder="如 'Inter'" style="flex:1;min-width:140px;padding:7px 10px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;background:#fff;color:#333;">
                                <button id="xmwpp-font-apply" style="background:#7c5cff;color:#fff;border:none;padding:7px 16px;border-radius:8px;font-size:12.5px;cursor:pointer;font-weight:500;">应用</button>
                                <button id="xmwpp-font-reset" style="background:#888;color:#fff;border:none;padding:7px 16px;border-radius:8px;font-size:12.5px;cursor:pointer;font-weight:500;">恢复</button>
                            </div>
                        </div>
                    </div>

                    <hr style="border:none;border-top:1px solid #f0f0f0;margin:11px 0;">

                    <!-- 网页缩放 -->
                    <div>
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;">
                            <div style="display:flex;align-items:center;gap:12px;">
                                <span style="font-weight:500;color:#333;font-size:13.5px;">网页缩放</span>
                                <span style="font-size:11.5px;color:#999;" id="zoomLevelDisplay">${currentZoom}%</span>
                            </div>
                            <div style="display:flex;gap:6px;align-items:center;">
                                <button id="zoomOutBtn" style="background:#f0f0f0;border:1px solid #ddd;border-radius:8px;width:30px;height:30px;font-size:16px;cursor:pointer;font-weight:700;color:#333;display:flex;align-items:center;justify-content:center;">−</button>
                                <span id="zoomValueDisplay" style="font-size:13px;font-weight:600;color:#333;min-width:48px;text-align:center;">${currentZoom}%</span>
                                <button id="zoomInBtn" style="background:#f0f0f0;border:1px solid #ddd;border-radius:8px;width:30px;height:30px;font-size:16px;cursor:pointer;font-weight:700;color:#333;display:flex;align-items:center;justify-content:center;">+</button>
                                <button id="zoomResetBtn" style="background:#7c5cff;color:#fff;border:none;border-radius:8px;padding:5px 14px;font-size:12px;cursor:pointer;font-weight:500;">重置</button>
                            </div>
                        </div>
                        <div style="padding:6px 0;">
                            <input type="range" id="zoomSlider" min="30" max="200" value="${currentZoom}" style="width:100%;accent-color:#7c5cff;cursor:pointer;">
                        </div>
                    </div>
                </div>

                <!-- ===== 功能设置 标签页 ===== -->
                <div class="xmwpp-tab-content" data-content="settings" style="display:${currentTab === 'settings' ? 'block' : 'none'};">
                    <!-- 自动签到 -->
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;">
                        <div style="display:flex;align-items:center;gap:12px;">
                            <span style="font-weight:500;color:#333;font-size:13.5px;">自动签到</span>
                            <span style="font-size:11.5px;color:${state.sign ? '#22c55e' : '#999'};">状态: ${state.sign ? '已启用' : '已关闭'}</span>
                        </div>
                        <div style="display:flex;gap:8px;align-items:center;">
                            <button id="xmwpp-manual-sign" style="background:#7c5cff;color:#fff;border:none;padding:5px 15px;border-radius:22px;font-size:12px;cursor:pointer;font-weight:500;">手动签到</button>
                            <button id="xmwpp-toggle-sign" style="background:${state.sign ? '#ccc' : '#7c5cff'};color:#fff;border:none;padding:5px 18px;border-radius:22px;font-size:12.5px;cursor:pointer;font-weight:500;">${state.sign ? '关闭' : '启用'}</button>
                        </div>
                    </div>
                    <div style="font-size:11.5px;color:#999;padding-bottom:9px;">检测到签到按钮就自动点击</div>

                    <hr style="border:none;border-top:1px solid #f0f0f0;margin:11px 0;">

                    <!-- 自动领取奖励 -->
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;">
                        <div style="display:flex;align-items:center;gap:12px;">
                            <span style="font-weight:500;color:#333;font-size:13.5px;">自动领取奖励</span>
                            <span style="font-size:11.5px;color:${state.claimRewards ? '#22c55e' : '#999'};">状态: ${state.claimRewards ? '已启用' : '已关闭'}</span>
                        </div>
                        <div style="display:flex;gap:8px;align-items:center;">
                            <button id="xmwpp-manual-claim" style="background:#7c5cff;color:#fff;border:none;padding:5px 15px;border-radius:22px;font-size:12px;cursor:pointer;font-weight:500;">手动领取</button>
                            <button id="xmwpp-toggle-claim" style="background:${state.claimRewards ? '#ccc' : '#7c5cff'};color:#fff;border:none;padding:5px 18px;border-radius:22px;font-size:12.5px;cursor:pointer;font-weight:500;">${state.claimRewards ? '关闭' : '启用'}</button>
                        </div>
                    </div>
                    <div style="font-size:11.5px;color:#999;padding-bottom:9px;">自动点击任务中心中可领取的奖励</div>

                    <hr style="border:none;border-top:1px solid #f0f0f0;margin:11px 0;">

                    <!-- 自动识别链接 -->
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;">
                        <div style="display:flex;align-items:center;gap:12px;">
                            <span style="font-weight:500;color:#333;font-size:13.5px;">自动识别链接</span>
                            <span style="font-size:11.5px;color:${state.linkify ? '#22c55e' : '#999'};">状态: ${state.linkify ? '已启用' : '已关闭'}</span>
                        </div>
                        <div style="display:flex;gap:8px;align-items:center;">
                            <button id="xmwpp-manual-linkify" style="background:#7c5cff;color:#fff;border:none;padding:5px 15px;border-radius:22px;font-size:12px;cursor:pointer;font-weight:500;">立即识别</button>
                            <button id="xmwpp-toggle-linkify" style="background:${state.linkify ? '#ccc' : '#7c5cff'};color:#fff;border:none;padding:5px 18px;border-radius:22px;font-size:12.5px;cursor:pointer;font-weight:500;">${state.linkify ? '关闭' : '启用'}</button>
                        </div>
                    </div>
                    <div style="font-size:11.5px;color:#999;padding-bottom:9px;">识别页面文本中的网址并显示为蓝色，点击即可在新标签页打开</div>
                </div>

                <!-- ===== 关于 标签页 ===== -->
                <div class="xmwpp-tab-content" data-content="about" style="display:${currentTab === 'about' ? 'block' : 'none'};">
                    <div style="text-align:center;padding:22px 0;">
                        <img src="https://world.xiaomawang.com/favicon.ico" style="width:64px;height:64px;border-radius:18px;margin-bottom:14px;">
                        <div style="font-size:19px;font-weight:700;color:#0f172a;margin-bottom:5px;">XMW++</div>
                        <div style="font-size:13px;color:#888;margin-bottom:24px;">小码王社区 · 多功能工具箱</div>
                        <div style="font-size:13px;color:#555;line-height:2;text-align:left;max-width:320px;margin:0 auto;">
                            <div style="display:flex;justify-content:space-between;"><span style="color:#999;">版本</span><span style="font-weight:500;">v2.3.0</span></div>
                            <div style="display:flex;justify-content:space-between;"><span style="color:#999;">作者</span><span style="font-weight:500;">Toushou</span></div>
                            <div style="display:flex;justify-content:space-between;"><span style="color:#999;">许可</span><span style="font-weight:500;">MIT</span></div>
                        </div>
                        <div style="margin-top:24px;font-size:12.5px;color:#aaa;">
                            <a href="https://github.com/Toushou-114514/XMWPP" target="_blank" style="color:#7c5cff;text-decoration:none;">GitHub 仓库 →</a>
                        </div>
                    </div>
                </div>

            </div>
        `;

        overlay.appendChild(popup);
        document.body.appendChild(overlay);

        // ============================================================
        // 标签页切换
        // ============================================================

        const tabs = popup.querySelectorAll('.xmwpp-tab');
        const contents = popup.querySelectorAll('.xmwpp-tab-content');

        tabs.forEach(tab => {
            tab.addEventListener('click', function() {
                const target = this.dataset.tab;
                window.__xmwpp_currentTab = target;

                tabs.forEach(t => {
                    if (t.dataset.tab === target) {
                        t.style.color = '#7c5cff';
                        t.style.borderBottomColor = '#7c5cff';
                    } else {
                        t.style.color = '#888';
                        t.style.borderBottomColor = 'transparent';
                    }
                });
                contents.forEach(c => {
                    c.style.display = c.dataset.content === target ? 'block' : 'none';
                });
            });
        });

        // ============================================================
        // 事件绑定
        // ============================================================

        // 关闭
        popup.querySelector('#xmwpp-close-popup').addEventListener('click', () => overlay.remove());

        // 用户ID
        popup.querySelector('#xmwpp-toggle-userid').addEventListener('click', function() {
            settings.showUserId = !settings.showUserId;
            saveSettings();
            if (settings.showUserId) displayUserId();
            else removeUserId();
            overlay.remove();
            showToolkitPopup();
        });

        // 深色模式
        popup.querySelector('#xmwpp-toggle-dark').addEventListener('click', function() {
            settings.darkMode = !settings.darkMode;
            saveSettings();
            toggleDarkMode(settings.darkMode);
            overlay.remove();
            showToolkitPopup();
        });

        // 自动签到
        popup.querySelector('#xmwpp-toggle-sign').addEventListener('click', function() {
            settings.autoSign = !settings.autoSign;
            saveSettings();
            if (settings.autoSign) autoSign();
            overlay.remove();
            showToolkitPopup();
        });

        // 手动签到
        popup.querySelector('#xmwpp-manual-sign').addEventListener('click', function() {
            const result = doSign();
            const original = this.textContent;
            this.textContent = result ? '✅ 已签到' : '❌ 失败';
            this.style.background = result ? '#22c55e' : '#ef4444';
            setTimeout(() => {
                this.textContent = original;
                this.style.background = '#7c5cff';
            }, 2000);
        });

        // 自动领取奖励
        const claimToggle = popup.querySelector('#xmwpp-toggle-claim');
        const manualClaim = popup.querySelector('#xmwpp-manual-claim');

        claimToggle.addEventListener('click', function() {
            settings.autoClaimRewards = !settings.autoClaimRewards;
            saveSettings();
            if (settings.autoClaimRewards) autoClaimRewards();
            overlay.remove();
            showToolkitPopup();
        });

        manualClaim.addEventListener('click', function() {
            const result = autoClaimRewards();
            const original = this.textContent;
            this.textContent = result ? '✅ 已领取' : '无奖励';
            this.style.background = result ? '#22c55e' : '#ef4444';
            setTimeout(() => {
                this.textContent = original;
                this.style.background = '#7c5cff';
            }, 2000);
        });

        // 自动识别链接
        popup.querySelector('#xmwpp-toggle-linkify').addEventListener('click', function() {
            toggleAutoLinkify(!settings.autoLinkify);
            overlay.remove();
            showToolkitPopup();
        });

        popup.querySelector('#xmwpp-manual-linkify').addEventListener('click', function() {
            if (!settings.autoLinkify) toggleAutoLinkify(true);
            const count = runLinkifyNow();
            const original = this.textContent;
            this.textContent = count > 0 ? '✅ ' + count + ' 处' : '未发现';
            this.style.background = count > 0 ? '#22c55e' : '#ef4444';
            setTimeout(() => {
                this.textContent = original;
                this.style.background = '#7c5cff';
            }, 2000);
        });

        // RGB
        popup.querySelector('#xmwpp-toggle-rgb').addEventListener('click', function() {
            settings.rgbMode = !settings.rgbMode;
            saveSettings();
            toggleRgbMode(settings.rgbMode);
            overlay.remove();
            showToolkitPopup();
        });

        // 壁纸
        const wallpaperToggle = popup.querySelector('#xmwpp-toggle-wallpaper');
        const wallpaperUrlInput = popup.querySelector('#xmwpp-wallpaper-url');
        const wallpaperFileInput = popup.querySelector('#xmwpp-wallpaper-file');
        const wallpaperStatus = popup.querySelector('#xmwpp-wallpaper-status');
        const wallpaperApply = popup.querySelector('#xmwpp-wallpaper-apply');
        const wallpaperReset = popup.querySelector('#xmwpp-wallpaper-reset');

        wallpaperToggle.addEventListener('click', function() {
            settings.customWallpaper = !settings.customWallpaper;
            saveSettings();
            toggleCustomWallpaper(settings.customWallpaper);
            overlay.remove();
            showToolkitPopup();
        });

        wallpaperFileInput.addEventListener('change', function() {
            const file = this.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(e) {
                wallpaperUrlInput.value = e.target.result;
                wallpaperStatus.textContent = '✅ 图片已加载';
                wallpaperStatus.style.color = '#22c55e';
            };
            reader.readAsDataURL(file);
        });

        wallpaperApply.addEventListener('click', function() {
            const url = wallpaperUrlInput.value.trim();
            if (!url) {
                wallpaperStatus.textContent = '⚠️ 请输入URL或纯色值';
                wallpaperStatus.style.color = '#ef4444';
                return;
            }
            settings.wallpaperUrl = url;
            saveSettings();
            applyWallpaper(url);
            wallpaperStatus.textContent = '✅ 已应用 (cover)';
            wallpaperStatus.style.color = '#22c55e';
        });

        wallpaperReset.addEventListener('click', function() {
            restoreDefaultWallpaper();
            wallpaperUrlInput.value = '';
            wallpaperFileInput.value = '';
            wallpaperStatus.textContent = '✅ 已恢复默认';
            wallpaperStatus.style.color = '#888';
        });

        // 字体
        const fontToggle = popup.querySelector('#xmwpp-toggle-font');
        const fontOptions = popup.querySelector('#xmwpp-font-options');
        const fontInput = popup.querySelector('#xmwpp-font-input');
        const fontApply = popup.querySelector('#xmwpp-font-apply');
        const fontReset = popup.querySelector('#xmwpp-font-reset');

        if (state.font) fontOptions.style.display = 'block';

        fontToggle.addEventListener('click', function() {
            const now = fontOptions.style.display === 'block';
            if (now) {
                fontOptions.style.display = 'none';
                toggleCustomFont('');
                this.textContent = '启用';
                this.style.background = '#7c5cff';
            } else {
                fontOptions.style.display = 'block';
                this.textContent = '关闭';
                this.style.background = '#ccc';
                if (settings.customFont) {
                    toggleCustomFont(settings.customFont);
                    fontInput.value = settings.customFont;
                }
            }
        });

        fontApply.addEventListener('click', function() {
            const font = fontInput.value.trim();
            if (font) {
                toggleCustomFont(font);
                fontToggle.textContent = '关闭';
                fontToggle.style.background = '#ccc';
                alert('✅ 字体已强制应用: ' + font);
            } else {
                alert('⚠️ 请输入字体名称');
            }
        });

        fontReset.addEventListener('click', function() {
            toggleCustomFont('');
            fontInput.value = '';
            fontOptions.style.display = 'none';
            fontToggle.textContent = '启用';
            fontToggle.style.background = '#7c5cff';
            alert('✅ 已恢复默认字体');
        });

        // 网页缩放
        const zoomSlider = popup.querySelector('#zoomSlider');
        const zoomValueDisplay = popup.querySelector('#zoomValueDisplay');
        const zoomLevelDisplay = popup.querySelector('#zoomLevelDisplay');
        const zoomInBtn = popup.querySelector('#zoomInBtn');
        const zoomOutBtn = popup.querySelector('#zoomOutBtn');
        const zoomResetBtn = popup.querySelector('#zoomResetBtn');

        function setZoom(value) {
            const val = Math.min(200, Math.max(30, value));
            document.body.style.zoom = val / 100;
            zoomValueDisplay.textContent = val + '%';
            zoomLevelDisplay.textContent = val + '%';
            zoomSlider.value = val;
            try {
                localStorage.setItem('xmwpp_zoom_level', val);
            } catch(e) {}
        }

        zoomSlider.addEventListener('input', function() {
            setZoom(parseInt(this.value));
        });

        zoomInBtn.addEventListener('click', function() {
            const current = parseInt(zoomValueDisplay.textContent) || 100;
            setZoom(Math.min(200, current + 10));
        });

        zoomOutBtn.addEventListener('click', function() {
            const current = parseInt(zoomValueDisplay.textContent) || 100;
            setZoom(Math.max(30, current - 10));
        });

        zoomResetBtn.addEventListener('click', function() {
            setZoom(100);
        });
    }

    // ============================================================
    // 6. 初始化
    // ============================================================

    function init() {
        initZoom();

        setTimeout(addFloatingBall, 1000);
        setTimeout(addFloatingBall, 3000);

        displayUserId();
        toggleDarkMode(settings.darkMode);
        toggleRgbMode(settings.rgbMode);
        if (settings.customFont) {
            setTimeout(() => {
                toggleCustomFont(settings.customFont);
            }, 500);
        }
        if (settings.customWallpaper && settings.wallpaperUrl) {
            applyWallpaper(settings.wallpaperUrl);
        }
        if (settings.autoSign) {
            setTimeout(autoSign, 2000);
            setTimeout(autoSign, 5000);
        }
        if (settings.autoClaimRewards) {
            setTimeout(autoClaimRewards, 3000);
            setTimeout(autoClaimRewards, 6000);
        }
        if (settings.autoLinkify) {
            setTimeout(() => toggleAutoLinkify(true), 1200);
        }

        console.log('[XMW++] 已加载 v2.3.0');
        console.log('[XMW++] 仓库: https://github.com/Toushou-114514/XMWPP');
    }

    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            setTimeout(initZoom, 300);
            setTimeout(addFloatingBall, 1000);
            setTimeout(displayUserId, 800);
            setTimeout(displayUserId, 2000);
            setTimeout(() => toggleDarkMode(settings.darkMode), 500);
            if (settings.rgbMode) setTimeout(() => toggleRgbMode(true), 600);
            if (settings.customFont) {
                setTimeout(() => {
                    toggleCustomFont(settings.customFont);
                }, 500);
            }
            if (settings.customWallpaper && settings.wallpaperUrl) {
                setTimeout(() => applyWallpaper(settings.wallpaperUrl), 800);
            }
            if (settings.autoSign) {
                setTimeout(autoSign, 1500);
                setTimeout(autoSign, 4000);
            }
            if (settings.autoClaimRewards) {
                setTimeout(autoClaimRewards, 2000);
                setTimeout(autoClaimRewards, 5000);
            }
            if (settings.autoLinkify) {
                setTimeout(() => {
                    linkifyStyle();
                    runLinkifyNow();
                }, 900);
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
