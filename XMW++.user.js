// ==UserScript==
// @name         XMW++
// @namespace    https://github.com/Toushou-114514/XMWPP
// @version      2.3.2
// @description  小码王社区 · 多功能工具箱
// @author       Toushou
// @match        https://world.xiaomawang.com/*
// @icon         https://world.xiaomawang.com/favicon.ico
// @license      MIT
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://raw.githubusercontent.com/Toushou-114514/XMWPP/toushou/XMW++.user.js
// @downloadURL  https://raw.githubusercontent.com/Toushou-114514/XMWPP/toushou/XMW++.user.js
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
        autoReload404: false,
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

    // 3.0 隐藏站点元素（主页自带背景 / 页脚）
    //
    // ⚠️ 关键：本站是 React/Next。用 el.remove() 删掉它管理的节点，会让 React 在
    // 下一次路由切换做协调时报 removeChild / Failed to execute 之类的错，Next 就会
    // 渲染出错误页 —— 而本站的错误页正是那个「去火星」的 404 页（_error 内部就是
    // pageBg404），表现为「每次跳转都 404 一次，刷新才正常」。
    // 所以这里改成注入 CSS 隐藏：视觉完全一致，但不碰 DOM，SPA 重渲染自动生效，
    // 也不会破坏 React。
    const XMWPP_REMOVE_SELECTOR = [
        '.homeBGImage__2Jspw', '[class*="homeBGImage__"]',           // 主页自带背景
        '.footer-container__3UMss', '[class*="footer-container__"]'  // 页脚
    ].join(',');
    const XMWPP_REMOVE_STYLE_ID = 'xmwpp-hide-site-elements';

    function startRemovingSiteElements() {
        if (document.getElementById(XMWPP_REMOVE_STYLE_ID)) return;
        const css = XMWPP_REMOVE_SELECTOR.split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .map(s => s + '{display:none !important;}')
            .join('\n');
        const style = document.createElement('style');
        style.id = XMWPP_REMOVE_STYLE_ID;
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
        console.log('[XMW++] 站点元素隐藏已启用');
    }

    // 3.0b 检测到 404 页面就自动刷新（默认关闭，可在「功能设置」里手动开启）
    //
    // ⚠️ 本站在站内跳转时会顺带渲染出 404 装饰块，且站点对很多路由的「整页 GET」会返回 404 页，
    // 因此这个功能很容易误判 / 误刷新，默认保持关闭（settings.autoReload404 = false）。
    //
    // 注意：不能在「任意页面「顺带」渲染出这个 404 装饰块」时就刷新 ——
    // SPA 每次切换路由都会短暂渲染上一条路由残留的组件，若此时命中 404 元素就 reload，
    // 表现就是「每打开一个新链接都 404 一次，手动刷新才正常」。
    // 所以只有同时满足下面条件才算真的 404 页面：
    //   1. 存在 404 元素；
    //   2. 当前路由对应的主内容区里**没有真正的内容**（卡片/列表等），
    //      只认主内容区，不认页头页脚，避免被残留的 404 块误导；
    //   3. 该页面的 404 状态连续多次检测都成立（稳住 ~1.2s 以上），排除路由切换过程中的瞬时态。
    // 另外同一 URL 只自动刷新一次（sessionStorage 记录），避免刷新后仍是 404 造成死循环。
    const XMWPP_404_SELECTOR = '.page-bg404__3PIbq, [class*="page-bg404__"]';
    const XMWPP_404_KEY_PREFIX = 'xmwpp_404_reloaded:';
    const XMWPP_404_HITS_NEEDED = 3;      // 连续命中次数
    const XMWPP_404_HIT_INTERVAL = 400;   // 每次检测间隔(ms)
    const XMWPP_404_SETTLE_MS = 800;      // 判定前要求页面「安静」的时长(ms)
    let refresh404Observer = null;
    let reload404Timer = null;
    let hits404 = 0;
    let last404MutationAt = 0;

    // 主内容区里算作「真实内容」的元素
    const XMWPP_404_CONTENT_SELECTOR =
        'a[href], img, video, canvas, button, input, textarea, select, p, li, h1, h2, h3, h4, h5, h6';

    // 元素当前是否真的可见（排除 display:none / visibility:hidden / 透明 / 零尺寸；
    // 兼容 position:fixed 这类 offsetParent 为 null 的元素，所以用 rect 判断尺寸）
    function isVisibleFor404(el) {
        if (!el || el.nodeType !== 1) return false;
        let cs;
        try { cs = window.getComputedStyle(el); } catch (e) { return false; }
        if (!cs || cs.display === 'none' || cs.visibility === 'hidden' ||
            parseFloat(cs.opacity || '1') === 0) return false;
        let r;
        try { r = el.getBoundingClientRect(); } catch (e) { return false; }
        return r.width > 1 && r.height > 1;
    }

    // 该层范围内（排除 404 块自身、页头页脚）是否存在真实内容
    function has404ScopeContent(scope, node) {
        let els;
        try { els = scope.querySelectorAll(XMWPP_404_CONTENT_SELECTOR); } catch (e) { return false; }
        for (const el of els) {
            if (node.contains(el) || el.contains(node)) continue;  // 404 装饰块自身 / 包住它的外层
            if (el.closest('header, nav, footer')) continue;       // 页头页脚不算正文
            if (!isVisibleFor404(el)) continue;
            const tag = el.tagName;
            if (tag === 'IMG' || tag === 'VIDEO' || tag === 'CANVAS' || tag === 'BUTTON' ||
                tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
            if ((el.textContent || '').trim().length >= 2) return true;
        }
        return false;
    }

    // 真的 404 页面：可见的 404 元素 + 它所在的「主内容区」里没有真实内容
    function is404Page() {
        let node;
        try { node = document.querySelector(XMWPP_404_SELECTOR); } catch (e) { return false; }
        if (!node) return false;
        // 站点常在 DOM 里保留一份隐藏的 404 模板/残留块，先排除不可见的
        if (!isVisibleFor404(node)) return false;

        // 从 404 元素往上找「主内容区」：只要哪一层范围里出现了真实内容，
        // 就说明只是正常页面里的顺带渲染，不是 404 页
        let scope = node.parentElement;
        for (let depth = 0; scope && depth < 6; scope = scope.parentElement, depth++) {
            if (has404ScopeContent(scope, node)) return false;
        }
        return true;   // 主内容区确实空 → 是真的 404
    }

    function watch404Page() {
        schedule404Reload();
        if (refresh404Observer) return;
        refresh404Observer = new MutationObserver(() => {
            last404MutationAt = Date.now();
            schedule404Reload();
        });
        try {
            refresh404Observer.observe(document.documentElement, { childList: true, subtree: true });
        } catch (e) {
            refresh404Observer = null;
        }
    }

    // 统一的启停入口（供设置项调用）
    function set404Watcher(enable) {
        if (enable) {
            watch404Page();
        } else {
            if (refresh404Observer) { refresh404Observer.disconnect(); refresh404Observer = null; }
            if (reload404Timer) { clearTimeout(reload404Timer); reload404Timer = null; }
            hits404 = 0;
        }
    }

    function schedule404Reload() {
        if (reload404Timer) return;
        reload404Timer = setTimeout(() => {
            reload404Timer = null;
            try { check404(); } catch (e) {}
        }, XMWPP_404_HIT_INTERVAL);
    }

    // 连续命中若干次才刷新，且要求页面已经「安静」下来，避免路由切换/加载过程中的误判
    function check404() {
        if (!is404Page()) {
            hits404 = 0;
            return false;
        }
        // 有 404 元素，但页面还在频繁变化（路由切换、数据加载中）→ 先不计入，稍后再看
        if (Date.now() - last404MutationAt < XMWPP_404_SETTLE_MS) {
            hits404 = 0;
            schedule404Reload();
            return false;
        }
        hits404++;
        if (hits404 < XMWPP_404_HITS_NEEDED) {
            schedule404Reload();
            return false;
        }
        return trigger404Reload();
    }

    function trigger404Reload() {
        const url = location.href;
        let already = null;
        try { already = sessionStorage.getItem(XMWPP_404_KEY_PREFIX + url); } catch (e) {}
        if (already) {
            console.log('[XMW++] 检测到 404 页面，但该地址已经自动刷新过一次，不再刷新');
            return false;
        }
        try { sessionStorage.setItem(XMWPP_404_KEY_PREFIX + url, String(Date.now())); } catch (e) {}

        console.log('[XMW++] 🔄 检测到 404 页面，正在自动刷新:', url);
        location.reload();
        return true;
    }

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

    // 3.2 深色模式（重写版）
    //
    // 与旧版的区别：
    //   - 配色集中为 CSS 变量，开/关只在 <html> 上加删一个 scope class，无残留；
    //   - 不再「猜」站点哈希类名，而是运行时读 computedStyle，
    //     把「浅色底 / 深色字 / 浅色描边 / 纯文字链接」分别打标记类，由固定样式表统一映射；
    //   - 只在首次全量 + 后续新增节点增量扫描，带节流，避免整页反复重扫；
    //   - color-scheme: dark 让原生控件 / 滚动条自动跟随，减少硬覆盖。
    const XMWPP_DARK_STYLE_ID = 'xmwpp-dark-mode';
    const XMWPP_DARK_SCOPE_CLASS = 'xmwpp-dark-mode';
    const XMWPP_DARK_SURFACE_CLASS = 'xmwpp-dm-surface';
    const XMWPP_DARK_INK_CLASS = 'xmwpp-dm-ink';
    const XMWPP_DARK_BORDER_CLASS = 'xmwpp-dm-border';
    const XMWPP_DARK_LINK_CLASS = 'xmwpp-dm-link';
    const XMWPP_DARK_SKIP_SELECTOR = '.xmwpp-float-ball';

    // 不参与扫描的元素（脚本自身不在此列，弹窗需要跟随主题）
    const XMWPP_DARK_SKIP_TAGS = {
        SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, LINK: 1, META: 1, HEAD: 1, TITLE: 1,
        IMG: 1, VIDEO: 1, AUDIO: 1, CANVAS: 1, SVG: 1, IFRAME: 1, OBJECT: 1, EMBED: 1
    };

    const XMWPP_DARK_LIGHT_THRESHOLD = 0.5;      // 背景亮度高于此值 → 视为浅底
    const XMWPP_DARK_DARK_TEXT_THRESHOLD = 0.45; // 文字亮度低于此值 → 视为深字
    const XMWPP_DARK_MIN_RESCAN_INTERVAL = 500;  // 两次增量扫描最小间隔(ms)

    let darkObserver = null;
    let darkScanTimer = null;
    let darkScanQueued = false;
    let darkPendingRoots = null;
    let darkLastScan = 0;
    // 记录被我们改过色的元素：站点是 React，重渲染可能覆盖 className，
    // 用这个集合精确判断“某个改过的元素又变回浅色了”，只补一次，不做轮询。
    let darkMarkedEls = typeof WeakSet !== 'undefined' ? new WeakSet() : null;

    // 解析 computedStyle 颜色字符串（rgba()+hex 兜底）
    function parseCssColor(str) {
        if (!str) return null;
        str = String(str).trim();
        if (str === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
        let m = str.match(/^rgba?\(([^)]+)\)$/i);
        if (m) {
            const p = m[1].split(/[,\s/]+/).filter(Boolean);
            if (p.length < 3) return null;
            const n = p.map(parseFloat);
            return { r: n[0], g: n[1], b: n[2], a: p.length >= 4 ? n[3] : 1 };
        }
        m = str.match(/^#([0-9a-f]{3,8})$/i);
        if (m) {
            let h = m[1];
            if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
            const num = parseInt(h.slice(0, 6), 16);
            const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
            return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255, a };
        }
        return null;
    }

    // 感知亮度 0~1
    function colorLuminance(c) {
        return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
    }

    // 只加标记、不撤标记的辅助函数。
    // 关键点：加了暗色面之后，元素的 computedStyle 会被我们自己的样式改暗，
    // 如果扫描时再按“当前样式”去判断就会把标记撤掉，导致反复闪烁。
    // 所以这里一旦判定为浅色就只补一次，之后保持不变。
    function addDarkMark(el, cls) {
        try {
            if (!el.classList.contains(cls)) el.classList.add(cls);
            if (darkMarkedEls) darkMarkedEls.add(el);
        } catch (e) {}
    }

    function hasAnyDarkMark(el) {
        try {
            return el.classList.contains(XMWPP_DARK_SURFACE_CLASS) ||
                   el.classList.contains(XMWPP_DARK_INK_CLASS) ||
                   el.classList.contains(XMWPP_DARK_BORDER_CLASS) ||
                   el.classList.contains(XMWPP_DARK_LINK_CLASS);
        } catch (e) { return false; }
    }

    // 依据当前计算样式给单个元素打标记（只加不撤，可反复调用且稳定）
    function classifyDarkElement(el) {
        if (!el || el.nodeType !== 1 || !el.classList) return;
        if (XMWPP_DARK_SKIP_TAGS[el.tagName]) return;
        if (el === document.documentElement || el === document.body) return;
        try {
            if (el.ownerSVGElement) return;
            if (XMWPP_DARK_SKIP_SELECTOR && el.closest(XMWPP_DARK_SKIP_SELECTOR)) return;
        } catch (e) {}

        let cs;
        try { cs = window.getComputedStyle(el); } catch (e) { return; }
        if (!cs) return;

        // 隐藏元素不处理（注意：不能在这里撤销已有的标记）
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') === 0) {
            return;
        }

        const bg = parseCssColor(cs.backgroundColor);
        const transparentBg = !bg || bg.a <= 0.5;

        // 1) 浅色底 → 换成暗色面（保留背景图，避免破坏 Banner 等）
        if (!transparentBg && colorLuminance(bg) > XMWPP_DARK_LIGHT_THRESHOLD) {
            addDarkMark(el, XMWPP_DARK_SURFACE_CLASS);
        }

        // 2) 纯文字链接（锚点且自身无实底）→ 主题链接色
        const isPlainLink = el.tagName === 'A' && transparentBg;
        if (isPlainLink) addDarkMark(el, XMWPP_DARK_LINK_CLASS);

        // 3) 深色字 → 提亮（纯文字链接除外，交由链接规则）
        const fg = parseCssColor(cs.color);
        if (!isPlainLink && fg && fg.a > 0.1 && colorLuminance(fg) < XMWPP_DARK_DARK_TEXT_THRESHOLD) {
            addDarkMark(el, XMWPP_DARK_INK_CLASS);
        }

        // 4) 浅色描边 → 压暗
        if (cs.borderTopStyle !== 'none' || cs.borderRightStyle !== 'none' ||
            cs.borderBottomStyle !== 'none' || cs.borderLeftStyle !== 'none') {
            const sides = ['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor'];
            for (const side of sides) {
                const bc = parseCssColor(cs[side]);
                if (bc && bc.a > 0.5 && colorLuminance(bc) > 0.7) {
                    addDarkMark(el, XMWPP_DARK_BORDER_CLASS);
                    break;
                }
            }
        }
    }

    // 扫描一棵子树（含根自身）
    function classifyDarkTree(root) {
        if (!root) return;
        if (root.nodeType === 1) classifyDarkElement(root);
        let nodes;
        try { nodes = root.querySelectorAll ? root.querySelectorAll('*') : null; } catch (e) { return; }
        if (!nodes) return;
        for (const el of nodes) classifyDarkElement(el);
    }

    function darkStyleText() {
        const scope = 'html.' + XMWPP_DARK_SCOPE_CLASS;
        return `
            /* 配色变量：想换主题只改这里 */
            ${scope} {
                color-scheme: dark;
                --xmwpp-dm-bg: #0f1115;
                --xmwpp-dm-surface: #1a1e26;
                --xmwpp-dm-control: #232833;
                --xmwpp-dm-border: #2c313c;
                --xmwpp-dm-text: #e6e8ec;
                --xmwpp-dm-text-dim: #9aa3b2;
                --xmwpp-dm-link: #6ea8fe;
                --xmwpp-dm-link-hover: #90caf9;
            }
            /* 页面底色（壁纸接管背景时让出，避免两者互相覆盖） */
            ${scope}:not(.xmwpp-wallpaper-on),
            ${scope}:not(.xmwpp-wallpaper-on) body {
                background-color: var(--xmwpp-dm-bg) !important;
                background-image: none !important;
            }
            ${scope} body {
                color: var(--xmwpp-dm-text);
            }
            /* 浅底元素 → 暗色面（只换底色，不动背景图） */
            ${scope} .${XMWPP_DARK_SURFACE_CLASS} {
                background-color: var(--xmwpp-dm-surface) !important;
            }
            /* 深色文字 → 提亮 */
            ${scope} .${XMWPP_DARK_INK_CLASS} {
                color: var(--xmwpp-dm-text) !important;
            }
            /* 纯文字链接 → 主题链接色（优先级高于提亮） */
            ${scope} .${XMWPP_DARK_LINK_CLASS},
            ${scope} .${XMWPP_DARK_LINK_CLASS}:visited {
                color: var(--xmwpp-dm-link) !important;
            }
            ${scope} .${XMWPP_DARK_LINK_CLASS}:hover,
            ${scope} .${XMWPP_DARK_LINK_CLASS}:active {
                color: var(--xmwpp-dm-link-hover) !important;
            }
            /* 浅色描边 → 压暗 */
            ${scope} .${XMWPP_DARK_BORDER_CLASS} {
                border-color: var(--xmwpp-dm-border) !important;
            }
            /* 站点页头（类名带哈希后缀，用包含匹配；#header 是 header-inner 的 id） */
            ${scope} [class*="header-inner__"],
            ${scope} #header,
            ${scope} [class*="common-header__"],
            ${scope} [class*="fake-header__"],
            ${scope} [class*="sticky-inner-wrapper"] {
                background-color: var(--xmwpp-dm-surface) !important;
                color: var(--xmwpp-dm-text) !important;
            }
            ${scope} [class*="header-inner__"] a,
            ${scope} #header a,
            ${scope} [class*="common-header__"] a,
            ${scope} [class*="fake-header__"] a {
                color: var(--xmwpp-dm-text) !important;
            }
            /* 表单控件 */
            ${scope} input, ${scope} textarea, ${scope} select {
                background-color: var(--xmwpp-dm-control) !important;
                color: var(--xmwpp-dm-text) !important;
                border-color: var(--xmwpp-dm-border) !important;
            }
            ${scope} input::placeholder, ${scope} textarea::placeholder {
                color: var(--xmwpp-dm-text-dim) !important;
            }
            /* 滚动条 / 选区 */
            ${scope} * { scrollbar-color: #3a3f4b var(--xmwpp-dm-bg); }
            ${scope} ::-webkit-scrollbar { width: 8px; height: 8px; background: var(--xmwpp-dm-bg); }
            ${scope} ::-webkit-scrollbar-thumb { background: #3a3f4b; border-radius: 4px; }
            ${scope} ::selection { background: rgba(124,92,255,0.35); }
            /* 本脚本工具弹窗跟随主题 */
            ${scope} .xmwpp-toolkit-popup {
                background-color: var(--xmwpp-dm-surface) !important;
                color: var(--xmwpp-dm-text) !important;
            }
            ${scope} .xmwpp-toolkit-popup-overlay {
                background: rgba(0,0,0,0.65) !important;
            }
        `;
    }

    function ensureDarkStyle() {
        let style = document.getElementById(XMWPP_DARK_STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = XMWPP_DARK_STYLE_ID;
            (document.head || document.documentElement).appendChild(style);
        }
        style.textContent = darkStyleText();
        return style;
    }

    function removeDarkMarks() {
        try {
            const sel = '.' + XMWPP_DARK_SURFACE_CLASS + ',.' + XMWPP_DARK_INK_CLASS +
                        ',.' + XMWPP_DARK_BORDER_CLASS + ',.' + XMWPP_DARK_LINK_CLASS;
            document.querySelectorAll(sel).forEach(el => {
                el.classList.remove(XMWPP_DARK_SURFACE_CLASS);
                el.classList.remove(XMWPP_DARK_INK_CLASS);
                el.classList.remove(XMWPP_DARK_BORDER_CLASS);
                el.classList.remove(XMWPP_DARK_LINK_CLASS);
            });
        } catch (e) {}
    }

    // 增量扫描：合并一段时间内的 DOM 变动，带最小间隔
    function scheduleDarkScan(roots) {
        if (!settings.darkMode) return;
        if (roots) {
            if (!darkPendingRoots) darkPendingRoots = [];
            for (const r of roots) darkPendingRoots.push(r);
        }
        if (darkScanQueued) return;
        darkScanQueued = true;

        const wait = Math.max(0, XMWPP_DARK_MIN_RESCAN_INTERVAL - (Date.now() - darkLastScan));
        if (darkScanTimer) clearTimeout(darkScanTimer);
        darkScanTimer = setTimeout(() => {
            darkScanTimer = null;
            darkScanQueued = false;
            darkLastScan = Date.now();
            const pending = darkPendingRoots;
            darkPendingRoots = null;
            if (!settings.darkMode) return;
            try {
                if (pending && pending.length) {
                    for (const r of pending) {
                        if (r && r.isConnected) classifyDarkTree(r);
                    }
                } else {
                    classifyDarkTree(document.body);
                }
            } catch (e) {}
        }, wait);
    }

    function startDarkObserver() {
        if (darkObserver) return;
        darkObserver = new MutationObserver(mutations => {
            const roots = [];
            for (const m of mutations) {
                if (m.type === 'childList') {
                    // 新增节点：新页面 / 新卡片 → 扫一次
                    for (const node of m.addedNodes) {
                        if (node.nodeType === 1) roots.push(node);
                    }
                } else if (m.type === 'attributes') {
                    // 站点是 React，重渲染可能覆盖 className 把标记冲掉。
                    // 只处理“我们改过、现在又没标记”的元素，发现变回浅色就补一次。
                    const t = m.target;
                    if (t && t.nodeType === 1 && darkMarkedEls &&
                        darkMarkedEls.has(t) && !hasAnyDarkMark(t)) {
                        roots.push(t);
                    }
                }
            }
            if (roots.length) scheduleDarkScan(roots);
        });
        try {
            darkObserver.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'style']
            });
        } catch (e) {
            darkObserver = null;
        }
    }

    function stopDarkObserver() {
        if (darkObserver) {
            darkObserver.disconnect();
            darkObserver = null;
        }
        if (darkScanTimer) {
            clearTimeout(darkScanTimer);
            darkScanTimer = null;
        }
        darkScanQueued = false;
        darkPendingRoots = null;
    }

    function toggleDarkMode(enable) {
        if (!enable) {
            const wasOn = !!document.getElementById(XMWPP_DARK_STYLE_ID) ||
                          document.documentElement.classList.contains(XMWPP_DARK_SCOPE_CLASS);
            stopDarkObserver();
            removeDarkMarks();
            if (typeof WeakSet !== 'undefined') darkMarkedEls = new WeakSet();
            const style = document.getElementById(XMWPP_DARK_STYLE_ID);
            if (style) style.remove();
            try { document.documentElement.classList.remove(XMWPP_DARK_SCOPE_CLASS); } catch (e) {}
            if (wasOn) console.log('[XMW++] 深色模式已关闭');
            return;
        }

        ensureDarkStyle();
        try { document.documentElement.classList.add(XMWPP_DARK_SCOPE_CLASS); } catch (e) {}

        if (!document.body) return;
        // 先全量扫描一次，再挂观察器做增量（新增节点 / 标记被覆盖时补色）
        classifyDarkTree(document.body);
        darkLastScan = Date.now();
        startDarkObserver();

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

    // 3.5 自定义网页壁纸（作用于本站所有页面）
    //
    // 站点自己有一层铺满视口的背景（例如 div.bgImg__1veTq），它会挡住我们贴在页面最底层的图层，
    // 所以这里走「兜底层 + 就地接管」两条路：
    //   1. 兜底层：#xmwpp-wallpaper-layer 挂在 body 第一个子节点，position:fixed + z-index:-1，
    //      同时把 html / body 背景置透明，保证壁纸能从所有卡片、文字背后透出来；
    //   2. 就地接管：找出站点自己的「铺满视口 + 不透明」背景元素，给它打上标记类，
    //      再由样式表把壁纸画在它身上（它本来就夹在卡片下面），顺带压住站点原背景。
    //
    // 对外行为不变，内部机制换掉了：
    //   - 接管只加/删一个标记类，不写内联样式、也不记录元素原值 →「恢复默认」时站点样式天然完好，
    //     没有残留，也就不需要 WeakMap 回滚；
    //   - 样式表内容固定，图片地址 / 纯色通过 CSS 变量下发 → 不需要反复重写样式表，
    //     也不会把用户输入拼进 CSS 文本；
    //   - 接管规则全部写在 html.<scope> 之下 → 摘掉这个 class 就等于完全退出接管；
    //   - 候选收集收敛（视口中心命中栈 + body 顶层两层 + 名字带 bg/backdrop 的元素）且设上限，
    //     完整重扫有最小间隔，DOM 变动只做一次防抖同步。
    const XMWPP_WALLPAPER_STYLE_ID = 'xmwpp-wallpaper-style';
    const XMWPP_WALLPAPER_LAYER_ID = 'xmwpp-wallpaper-layer';
    const XMWPP_WALLPAPER_SCOPE_CLASS = 'xmwpp-wallpaper-on';
    const XMWPP_WALLPAPER_BACKDROP_CLASS = 'xmwpp-wallpaper-backdrop';
    const XMWPP_WALLPAPER_IMAGE_VAR = '--xmwpp-wallpaper-image';
    const XMWPP_WALLPAPER_COLOR_VAR = '--xmwpp-wallpaper-color';

    // 站点自带的背景容器（class 名带 hash 后缀，用包含匹配）
    const XMWPP_BGIMG_SELECTORS = ['div[class*="bgImg__"]', 'div[class*="BgImg__"]'];
    // 名字里带 bg / background / backdrop 的元素，作为全屏背景候选
    const XMWPP_BACKDROP_QUERY = [
        '[class*="bg" i]', '[id*="bg" i]',
        '[class*="background" i]', '[id*="background" i]',
        '[class*="backdrop" i]', '[id*="backdrop" i]'
    ].join(',');
    // 脚本自己的 UI，绝不当成站点背景
    const XMWPP_BACKDROP_SKIP = [
        '.xmwpp-toolkit-popup', '.xmwpp-toolkit-popup-overlay', '.xmwpp-float-ball'
    ].join(',');

    const XMWPP_BACKDROP_MAX_SCAN = 400;      // 候选上限
    const XMWPP_BACKDROP_MAX_TAKEOVER = 6;    // 同时接管的元素上限（正常页面不会有这么多全屏背景）
    const XMWPP_BACKDROP_MIN_INTERVAL = 600;  // 两次完整重扫的最小间隔(ms)

    let wallpaperObserver = null;
    let wallpaperSyncTimer = null;
    let wallpaperResizeBound = false;
    let wallpaperForceScan = false;
    let backdropRetryTimer = null;
    let lastBackdropScan = 0;
    let currentWallpaper = '';
    let currentWallpaperIsColor = false;

    function isColorValue(v) {
        return typeof v === 'string' && /^#([0-9a-f]{3,8})$/i.test(v.trim());
    }

    // url(...) 里的引号 / 反斜杠转义，避免地址破坏 CSS 变量值
    function escapeCssUrl(url) {
        return String(url || '').replace(/[\\"]/g, '\\$&').replace(/[\r\n\f]/g, '');
    }

    // ---------- 样式表：固定内容，颜色/图片走 CSS 变量 ----------

    function wallpaperStyleCss() {
        const scope = 'html.' + XMWPP_WALLPAPER_SCOPE_CLASS;
        const bgImgRules = XMWPP_BGIMG_SELECTORS.map(sel => scope + ' ' + sel).join(',\n            ');
        return `
            /* 兜底壁纸层：负 z-index，永远在页面所有卡片/文字下面 */
            ${scope} #${XMWPP_WALLPAPER_LAYER_ID} {
                position: fixed !important;
                top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
                width: 100% !important; height: 100% !important;
                margin: 0 !important; padding: 0 !important; border: 0 !important;
                display: block !important; pointer-events: none !important;
                z-index: -1 !important;
                background-color: var(${XMWPP_WALLPAPER_COLOR_VAR}, transparent) !important;
                background-image: var(${XMWPP_WALLPAPER_IMAGE_VAR}, none) !important;
                background-size: cover !important;
                background-position: center center !important;
                background-repeat: no-repeat !important;
            }
            /* html / body 保持透明，壁纸才能从页面内容背后透出来 */
            ${scope},
            ${scope} body {
                background-color: transparent !important;
                background-image: none !important;
            }
            /* 就地接管：站点背景容器 + 扫描命中的全屏背景元素，直接画上壁纸 */
            ${bgImgRules},
            ${scope} .${XMWPP_WALLPAPER_BACKDROP_CLASS} {
                background-color: var(${XMWPP_WALLPAPER_COLOR_VAR}, transparent) !important;
                background-image: var(${XMWPP_WALLPAPER_IMAGE_VAR}, none) !important;
                background-size: cover !important;
                background-position: center center !important;
                background-repeat: no-repeat !important;
            }
            /* 接管的全屏元素跟视口一起固定，滚动时壁纸不跟着跑 */
            ${scope} .${XMWPP_WALLPAPER_BACKDROP_CLASS} {
                background-attachment: fixed !important;
            }
        `;
    }

    function ensureWallpaperStyle() {
        let style = document.getElementById(XMWPP_WALLPAPER_STYLE_ID);
        if (style) return style;
        style = document.createElement('style');
        style.id = XMWPP_WALLPAPER_STYLE_ID;
        style.textContent = wallpaperStyleCss();
        (document.head || document.documentElement).appendChild(style);
        return style;
    }

    function removeWallpaperStyle() {
        const style = document.getElementById(XMWPP_WALLPAPER_STYLE_ID);
        if (style) style.remove();
    }

    // 壁纸地址只下发给 CSS 变量（setProperty 会做合法性校验，坏了也只是这一条失效）
    function setWallpaperVars() {
        try {
            const root = document.documentElement;
            root.style.setProperty(XMWPP_WALLPAPER_IMAGE_VAR,
                currentWallpaperIsColor ? 'none' : 'url("' + escapeCssUrl(currentWallpaper) + '")');
            root.style.setProperty(XMWPP_WALLPAPER_COLOR_VAR,
                currentWallpaperIsColor ? currentWallpaper : 'transparent');
        } catch (e) {}
    }

    function clearWallpaperVars() {
        try {
            const root = document.documentElement;
            root.style.removeProperty(XMWPP_WALLPAPER_IMAGE_VAR);
            root.style.removeProperty(XMWPP_WALLPAPER_COLOR_VAR);
        } catch (e) {}
    }

    // ---------- 兜底层 ----------

    function ensureWallpaperLayer() {
        let layer = document.getElementById(XMWPP_WALLPAPER_LAYER_ID);
        if (!layer) {
            layer = document.createElement('div');
            layer.id = XMWPP_WALLPAPER_LAYER_ID;
            layer.setAttribute('aria-hidden', 'true');
        }
        if (!document.body) return null;
        // 挂在 body 第一个子节点：z-index:-1 的图层若父级建立了层叠上下文会失效
        if (layer.parentNode !== document.body || document.body.firstChild !== layer) {
            try { document.body.insertBefore(layer, document.body.firstChild); } catch (e) { return null; }
        }
        try { document.documentElement.classList.add(XMWPP_WALLPAPER_SCOPE_CLASS); } catch (e) {}
        return layer;
    }

    // ---------- 找出站点自己的全屏背景元素（就是挡住壁纸的那个） ----------

    // 背景是否「不透明」：不透明底色或任意背景图都算
    function hasOpaquePaint(cs) {
        const bg = (cs.backgroundColor || '').replace(/\s/g, '');
        let alpha = 0;
        if (bg.indexOf('rgb(') === 0) {
            alpha = 1;
        } else if (bg.indexOf('rgba(') === 0) {
            const v = bg.slice(5, -1).split(',');
            alpha = v.length === 4 ? parseFloat(v[3]) : 1;
        }
        if (alpha > 0.5) return true;
        return !!cs.backgroundImage && cs.backgroundImage !== 'none';
    }

    function viewportSize() {
        const de = document.documentElement;
        return {
            w: (de && de.clientWidth) || window.innerWidth || 0,
            h: (de && de.clientHeight) || window.innerHeight || 0
        };
    }

    // 判定标准：铺满视口 + 底色不透明（或带背景图）+ 不是弹窗遮罩 / 多媒体元素
    function isBackdropElement(el, vp) {
        if (!el || el.nodeType !== 1 || !el.classList) return false;
        if (el === document.body || el === document.documentElement) return false;
        if (el.id === XMWPP_WALLPAPER_LAYER_ID) return false;
        try { if (el.closest(XMWPP_BACKDROP_SKIP)) return false; } catch (e) {}
        const tag = el.tagName;
        if (tag === 'IMG' || tag === 'VIDEO' || tag === 'CANVAS' ||
            tag === 'IFRAME' || tag === 'SVG' || tag === 'OBJECT') return false;

        let cs;
        try { cs = window.getComputedStyle(el); } catch (e) { return false; }
        if (!cs) return false;
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (parseFloat(cs.opacity || '1') === 0) return false;
        if (!hasOpaquePaint(cs)) return false;

        const z = parseInt(cs.zIndex, 10);
        if (!isNaN(z) && z > 900) return false;   // 疑似弹窗/浮层遮罩，不碰

        let r;
        try { r = el.getBoundingClientRect(); } catch (e) { return false; }
        if (r.width < vp.w * 0.9 || r.height < vp.h * 0.9) return false;
        // 允许一点偏移：首个子元素的 margin 折叠会把包裹层整体往下推几个像素
        if (r.top > vp.h * 0.05 || r.left > vp.w * 0.05) return false;
        return true;
    }

    function collectBackdropCandidates() {
        const out = [];
        const seen = new Set();
        const push = el => {
            if (!el || el.nodeType !== 1 || seen.has(el)) return;
            seen.add(el);
            out.push(el);
        };

        // 1) 视口中心这一列的命中栈：从最底层往上，真正的全屏背景一定在这里
        try {
            const stack = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2) || [];
            for (let i = stack.length - 1; i >= 0; i--) push(stack[i]);
        } catch (e) {}

        // 2) body 顶层两层（全屏背景基本都是页面顶层的包裹层）
        try {
            let n = 0;
            const scan = (parent, depth) => {
                if (!parent || depth > 2 || n > 200) return;
                for (const el of parent.children) {
                    if (++n > 200) return;
                    push(el);
                    if (depth < 2) scan(el, depth + 1);
                }
            };
            scan(document.body, 0);
        } catch (e) {}

        // 3) 名字里带 bg / background / backdrop 的元素（pointer-events:none 也能捞到）
        try {
            const named = document.querySelectorAll(XMWPP_BACKDROP_QUERY);
            for (let i = 0; i < named.length && out.length < XMWPP_BACKDROP_MAX_SCAN; i++) push(named[i]);
        } catch (e) {}

        return out;
    }

    // 重算「全屏不透明的站点背景元素」集合并打/撤标记类，返回当前接管数量
    function refreshBackdrops(force) {
        const now = Date.now();
        if (!force && now - lastBackdropScan < XMWPP_BACKDROP_MIN_INTERVAL) {
            // 被节流挡下：补扫一次，别把这次同步丢掉
            if (!backdropRetryTimer) {
                backdropRetryTimer = setTimeout(() => {
                    backdropRetryTimer = null;
                    if (currentWallpaper) refreshBackdrops(true);
                }, XMWPP_BACKDROP_MIN_INTERVAL);
            }
            return -1;
        }
        lastBackdropScan = now;

        const vp = viewportSize();
        let taken = 0;

        // 先撤掉不再合格的标记（元素被复用、改了尺寸、被弹窗盖住等）
        try {
            document.querySelectorAll('.' + XMWPP_WALLPAPER_BACKDROP_CLASS).forEach(el => {
                if (isBackdropElement(el, vp)) taken++;
                else el.classList.remove(XMWPP_WALLPAPER_BACKDROP_CLASS);
            });
        } catch (e) {}

        // 再补上新出现的
        try {
            for (const el of collectBackdropCandidates()) {
                if (taken >= XMWPP_BACKDROP_MAX_TAKEOVER) break;
                if (el.classList.contains(XMWPP_WALLPAPER_BACKDROP_CLASS)) continue;
                if (!isBackdropElement(el, vp)) continue;
                el.classList.add(XMWPP_WALLPAPER_BACKDROP_CLASS);
                taken++;
            }
        } catch (e) {}

        return taken;
    }

    // ---------- 观察器：SPA 重渲染 / 窗口尺寸变化后补一次同步 ----------

    function scheduleWallpaperSync(force) {
        if (!currentWallpaper) return;
        if (force) wallpaperForceScan = true;
        if (wallpaperSyncTimer) return;
        wallpaperSyncTimer = setTimeout(() => {
            wallpaperSyncTimer = null;
            if (!currentWallpaper) return;
            const needForce = wallpaperForceScan;
            wallpaperForceScan = false;
            if (!document.getElementById(XMWPP_WALLPAPER_STYLE_ID)) ensureWallpaperStyle();
            ensureWallpaperLayer();
            refreshBackdrops(needForce);
        }, 300);
    }

    function startWallpaperObserver() {
        if (!wallpaperObserver) {
            wallpaperObserver = new MutationObserver(() => scheduleWallpaperSync(false));
            try {
                wallpaperObserver.observe(document.documentElement, { childList: true, subtree: true });
            } catch (e) {
                wallpaperObserver = null;
            }
        }
        if (!wallpaperResizeBound) {
            wallpaperResizeBound = true;
            let resizeTimer = null;
            window.addEventListener('resize', () => {
                if (resizeTimer) clearTimeout(resizeTimer);
                resizeTimer = setTimeout(() => scheduleWallpaperSync(true), 300);
            });
        }
    }

    // ---------- 对外接口 ----------

    function clearWallpaper() {
        if (wallpaperObserver) {
            wallpaperObserver.disconnect();
            wallpaperObserver = null;
        }
        if (wallpaperSyncTimer) {
            clearTimeout(wallpaperSyncTimer);
            wallpaperSyncTimer = null;
        }
        if (backdropRetryTimer) {
            clearTimeout(backdropRetryTimer);
            backdropRetryTimer = null;
        }
        wallpaperForceScan = false;

        // 标记类和样式表一撤，站点元素立刻回到自己的原始样式
        try {
            document.querySelectorAll('.' + XMWPP_WALLPAPER_BACKDROP_CLASS).forEach(el => {
                el.classList.remove(XMWPP_WALLPAPER_BACKDROP_CLASS);
            });
        } catch (e) {}
        const layer = document.getElementById(XMWPP_WALLPAPER_LAYER_ID);
        if (layer) layer.remove();
        removeWallpaperStyle();
        clearWallpaperVars();
        try { document.documentElement.classList.remove(XMWPP_WALLPAPER_SCOPE_CLASS); } catch (e) {}

        currentWallpaper = '';
        currentWallpaperIsColor = false;
        lastBackdropScan = 0;
    }

    function applyWallpaper(url) {
        const value = (url || '').trim();
        if (!value) {
            clearWallpaper();
            return;
        }
        currentWallpaper = value;
        currentWallpaperIsColor = isColorValue(value);

        ensureWallpaperStyle();
        setWallpaperVars();
        ensureWallpaperLayer();
        const n = refreshBackdrops(true);
        startWallpaperObserver();

        console.log('[XMW++] 全站壁纸已应用:', currentWallpaperIsColor ? currentWallpaper : '(图片) ' + currentWallpaper,
                    '| 已接管站点背景元素 ' + (n < 0 ? 0 : n) + ' 个');
    }

    function restoreDefaultWallpaper() {
        clearWallpaper();
        settings.wallpaperUrl = '';
        saveSettings();
        console.log('[XMW++] 已恢复默认背景');
    }

    function toggleCustomWallpaper(enable) {
        if (enable) {
            if (settings.wallpaperUrl) applyWallpaper(settings.wallpaperUrl);
            else console.log('[XMW++] 壁纸已开启，但还没设置地址');
        } else {
            // 只停止渲染，保留已保存的地址，下次开启能直接恢复
            clearWallpaper();
            console.log('[XMW++] 壁纸已关闭');
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
            linkify: settings.autoLinkify,
            reload404: settings.autoReload404
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
                                <span style="font-weight:500;color:#333;font-size:13.5px;">自定义网页壁纸</span>
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

                    <hr style="border:none;border-top:1px solid #f0f0f0;margin:11px 0;">

                    <!-- 404 自动刷新 -->
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;">
                        <div style="display:flex;align-items:center;gap:12px;">
                            <span style="font-weight:500;color:#333;font-size:13.5px;">404 自动刷新</span>
                            <span style="font-size:11.5px;color:${state.reload404 ? '#22c55e' : '#999'};">状态: ${state.reload404 ? '已启用' : '已关闭'}</span>
                        </div>
                        <button id="xmwpp-toggle-reload404" style="background:${state.reload404 ? '#ccc' : '#7c5cff'};color:#fff;border:none;padding:5px 18px;border-radius:22px;font-size:12.5px;cursor:pointer;font-weight:500;">${state.reload404 ? '关闭' : '启用'}</button>
                    </div>
                    <div style="font-size:11.5px;color:#999;padding-bottom:9px;">检测到真的 404 页面时自动刷新一次。本站跳转时可能瞬时出现 404 块，开启后存在误刷新风险，故默认关闭</div>
                </div>

                <!-- ===== 关于 标签页 ===== -->
                <div class="xmwpp-tab-content" data-content="about" style="display:${currentTab === 'about' ? 'block' : 'none'};">
                    <div style="text-align:center;padding:22px 0;">
                        <img src="https://world.xiaomawang.com/favicon.ico" style="width:64px;height:64px;border-radius:18px;margin-bottom:14px;">
                        <div style="font-size:19px;font-weight:700;color:#0f172a;margin-bottom:5px;">XMW++</div>
                        <div style="font-size:13px;color:#888;margin-bottom:24px;">小码王社区 · 多功能工具箱</div>
                        <div style="font-size:13px;color:#555;line-height:2;text-align:left;max-width:320px;margin:0 auto;">
                            <div style="display:flex;justify-content:space-between;"><span style="color:#999;">版本</span><span style="font-weight:500;">v2.3.2</span></div>
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

        // 404 自动刷新
        popup.querySelector('#xmwpp-toggle-reload404').addEventListener('click', function() {
            settings.autoReload404 = !settings.autoReload404;
            saveSettings();
            set404Watcher(settings.autoReload404);
            overlay.remove();
            showToolkitPopup();
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
        startRemovingSiteElements();
        if (settings.autoReload404) set404Watcher(true);

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

        console.log('[XMW++] 已加载 v2.3.2');
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
