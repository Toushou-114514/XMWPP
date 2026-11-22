// ==UserScript==
// @name         XMW++（优化版）
// @namespace    https://github.com/Toushou-114514/XMWPP
// @version      2.6
// @description  小码王社区 · 多功能工具箱（性能优化版，功能与原版一一对应）
// @author       Toushou+星落鲤跃
// @match        https://world.xiaomawang.com/*
// @icon         https://world.xiaomawang.com/favicon.ico
// @license      MIT
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://raw.githubusercontent.com/Toushou-114514/XMWPP/toushou/XMW++.user.js
// @downloadURL  https://raw.githubusercontent.com/Toushou-114514/XMWPP/toushou/XMW++.user.js
// ==/UserScript==

/* ==================================================================
 * 优化说明（v2.6，功能未删减）
 * ------------------------------------------------------------------
 * 1. 全局字体：原版每秒对全站每个元素写一次 inline font-family
 *    （querySelectorAll('*') + setProperty + 1000ms 定时器），是切页/切标签
 *    的主要卡顿源。现在只保留一条 `*{font-family:...!important}` 样式规则，
 *    新增元素自动生效，定时器和逐元素写样式全部移除。
 * 2. RGB 模式：原版 30ms 重写一次 <style> 文本（等于每 33ms 让浏览器重解析
 *    样式表），并且对所有元素挂了 transition: color，每秒产生上万条过渡动画。
 *    现在改为：一条规则 + CSS 变量，requestAnimationFrame 驱动（约 30fps），
 *    去掉全局 transition，色相速度仍是 50°/s，视觉基本一致。
 * 3. MutationObserver：原来 5 个观察器各自盯 documentElement/body 的整个子树，
 *    每次 DOM 变动跑 5 份回调。现在合并为「1 个共享观察器 + 订阅表」，
 *    站点元素清理 / SPA 路由检测共用一次回调。
 * 4. 路由切换：劫持 history + URL 比对 + 250ms 去抖，切页后按需
 *    「补应用」各功能（都做了幂等短路），不再无脑重跑整页扫描。
 * 5. 用户ID / 签到 / 领取奖励：不再 `querySelectorAll('div,span,...')` 全页
 *    读 textContent，改用文本节点 TreeWalker 精确命中，开销从 O(n) 降到
 *    只与命中数量有关；已插入的 ID 卡片直接短路返回。
 * 6. 壁纸 / 链接识别：扫描放 requestIdleCallback（空闲帧）里执行，页面隐藏
 *    时暂停，恢复可见后再补一次。
 * 7. 缩放：值未变化时不再重复写 body.style.zoom，避免无谓整页重排。
 * 8. 「移除站点背景/页脚」改成 CSS 隐藏（v2.6 重点，也是 404 的真正根因）：
 *    原版（以及早期优化版）用 el.remove() 把 .footer-container / .homeBGImage
 *    从 DOM 里摘掉，但这些节点是 React 在管的。下一次 SPA 路由重渲染时，
 *    React 会 insertBefore(新节点, 已不存在的兄弟节点)，抛
 *      NotFoundError: insertBefore ... is not a child of this node
 *    整页渲染失败，站点直接退回自己的 404 页，而且不会自愈，只能整页刷新。
 *    现在只加一条 display:none 样式：视觉结果完全一样，DOM 不被破坏。
 * 9. 404 兜底（不再无限刷新）：导航一开始就把 404 整块藏起来，404 出现后
 *    观察 700ms，仍在才刷新；同一地址最多自动刷 2 次，之后给一个「重新加载」
 *    小按钮，绝不无限刷、也不会刷完就永远卡在 404。
 * 10. 修掉原版一个小 bug：弹窗开启时再点悬浮球，只删了 popup 没删遮罩，
 *     遮罩会残留挡住页面。
 * ================================================================== */

(function () {
    'use strict';

    // ============================================================
    // 0. 性能基础设施
    // ============================================================

    // 空闲调度：把重扫描挪到浏览器空闲帧，不抢首屏 / 路由渲染
    function idle(fn, timeout) {
        timeout = timeout || 500;
        if (typeof window.requestIdleCallback === 'function') {
            return window.requestIdleCallback(fn, { timeout: timeout });
        }
        return setTimeout(fn, Math.min(timeout, 300));
    }

    // 共享 DOM 观察器 + 订阅表（替代原来的 5 个独立 MutationObserver）
    const domHooks = new Set();
    let sharedObserver = null;

    function onDomChange(fn) {
        domHooks.add(fn);
    }
    function offDomChange(fn) {
        domHooks.delete(fn);
    }
    function startDomObserver() {
        if (sharedObserver || !document.documentElement) return;
        sharedObserver = new MutationObserver(function (mutations) {
            for (const fn of domHooks) {
                try { fn(mutations); } catch (e) {}
            }
        });
        sharedObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

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

    // 文本节点 TreeWalker：找「内容正好等于某个字符串」的最内层元素
    // 比 querySelectorAll('div, span, ...') 再逐个读 textContent 便宜得多
    function findElementByExactText(text, root) {
        const target = root || document.body;
        if (!target) return null;
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const v = node.nodeValue;
                if (!v) return NodeFilter.FILTER_REJECT;
                return v.trim() === text ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
        });
        const node = walker.nextNode();
        return node ? node.parentElement : null;
    }

    // 找「文本等于列表里任意一项」的可点击元素（跳过脚本自身弹窗）
    function findClickableByTexts(texts) {
        const target = document.body;
        if (!target) return null;
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const v = node.nodeValue;
                if (!v) return NodeFilter.FILTER_REJECT;
                if (!v.trim()) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let n;
        while ((n = walker.nextNode())) {
            const t = n.nodeValue.trim();
            for (let i = 0; i < texts.length; i++) {
                const want = texts[i];
                if (t === want || (want.length > 2 && t.includes(want))) {
                    const el = n.parentElement;
                    if (!el) continue;
                    if (el.closest('.xmwpp-toolkit-popup, .xmwpp-toolkit-popup-overlay, .xmwpp-float-ball')) continue;
                    return el;
                }
            }
        }
        return null;
    }

    // 同上，但返回所有命中元素（用于「领取奖励」这种一次可能有多处的场景）
    function findAllClickableByTexts(texts) {
        const out = [];
        const target = document.body;
        if (!target) return out;
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const v = node.nodeValue;
                if (!v || !v.trim()) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let n;
        while ((n = walker.nextNode())) {
            const t = n.nodeValue.trim();
            let hit = false;
            for (let i = 0; i < texts.length; i++) {
                const want = texts[i];
                if (t === want || (want.length > 2 && t.includes(want))) { hit = true; break; }
            }
            if (!hit) continue;
            const el = n.parentElement;
            if (!el) continue;
            if (el.closest('.xmwpp-toolkit-popup, .xmwpp-toolkit-popup-overlay, .xmwpp-float-ball')) continue;
            if (out.indexOf(el) < 0) out.push(el);
            if (out.length >= 20) break;   // 上限保护
        }
        return out;
    }

    // ============================================================
    // 3. 功能实现
    // ============================================================

    // ---------- 3.0 站点元素清理 / 404 / SPA 路由（共用同一个观察器） ----------

    // ---------- 站点背景 / 页脚：改成「CSS 隐藏」，绝不从 DOM 里删 ----------
    //
    // 这是「切页闪 404」的真正根因（原版也有）：
    // 原版用 el.remove() 把站点的 .footer-container / .homeBGImage 从 DOM 摘掉，
    // 而这些节点是 React 在管的。下一次 SPA 路由切换重渲染 Layout 时，
    // React 会 insertBefore(新节点, 这个已不存在的兄弟节点)，
    // 抛出 NotFoundError: insertBefore ... is not a child of this node，
    // 页面渲染直接失败，站点就退回自己的 404 页（而且不会自愈，只能整页刷新）。
    // 现在只加一条 display:none 的样式规则：视觉结果一样，DOM 不被破坏。
    const XMWPP_HIDE_SELECTOR = [
        '.homeBGImage__2Jspw', '[class*="homeBGImage__"]',   // 主页自带背景
        '.footer-container__3UMss', '[class*="footer-container__"]'  // 页脚
    ].join(',');
    const XMWPP_HIDE_STYLE_ID = 'xmwpp-site-hide-style';

    // ---------- 404 兜底：只在「确实 404」时刷新，且最多 2 次 ----------
    //
    // 根因修好后正常切页不会再 404；这里只是兜底：
    //   1) 导航一开始就把 404 容器藏掉，任何时候都不会闪 404；
    //   2) 404 出现后观察 700ms：消失了 → 什么都不做；
    //   3) 仍在 → 刷新一次；同一地址最多自动刷 2 次，之后显示重试按钮，绝不无限刷。
    const XMWPP_404_SELECTOR = '[class*="page404__"], [class*="page-bg404__"]';
    const XMWPP_404_STATE_KEY = 'xmwpp_404_state';
    const XMWPP_404_HOLD_MS = 700;        // 404 持续这么久才判定为卡住
    const XMWPP_404_GUARD_MS = 6000;      // 导航后最多守卫这么久
    const XMWPP_404_RELOAD_GAP = 4000;    // 两次自动刷新的最小间隔
    const XMWPP_404_MAX_RELOADS = 2;      // 同一地址最多自动刷新次数
    const XMWPP_404_GIVEUP_MS = 60000;    // 超过这个时间才重置计数

    const XMWPP_404_GUARD_STYLE_ID = 'xmwpp-404-guard-style';
    const XMWPP_404_GUARD_CLASS = 'xmwpp-404-guard';
    const XMWPP_404_LOADING_CLASS = 'xmwpp-404-loading';

    let lastUrl = location.href;
    let routeSyncTimer = null;
    let guard404Timer = null;
    let poll404Timer = null;
    let seen404At = 0;

    function read404State() {
        try {
            const raw = sessionStorage.getItem(XMWPP_404_STATE_KEY);
            const st = raw ? JSON.parse(raw) : null;
            if (st && typeof st.count === 'number' && Date.now() - (st.ts || 0) < XMWPP_404_GIVEUP_MS) {
                return st;
            }
        } catch (e) {}
        return { url: location.href, count: 0, ts: 0 };
    }

    function write404State(st) {
        try { sessionStorage.setItem(XMWPP_404_STATE_KEY, JSON.stringify(st)); } catch (e) {}
    }

    function ensureSiteHideStyle() {
        if (document.getElementById(XMWPP_HIDE_STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = XMWPP_HIDE_STYLE_ID;
        style.textContent = XMWPP_HIDE_SELECTOR
            .split(',')
            .map(s => s.trim() + ' { display: none !important; }')
            .join('\n');
        (document.head || document.documentElement).appendChild(style);
        console.log('[XMW++] 站点背景/页脚已隐藏（CSS，不改动 DOM）');
    }

    function startRemovingSiteElements() {
        ensureSiteHideStyle();
    }

    function is404Page() {
        try {
            return !!document.querySelector(XMWPP_404_SELECTOR);
        } catch (e) {
            return false;
        }
    }

    function ensure404GuardStyle() {
        if (document.getElementById(XMWPP_404_GUARD_STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = XMWPP_404_GUARD_STYLE_ID;
        style.textContent = `
            /* 导航过程中把站点的 404 内容整块藏起来 */
            html.${XMWPP_404_GUARD_CLASS} [class*="page404__"],
            html.${XMWPP_404_GUARD_CLASS} [class*="page-bg404__"] {
                display: none !important;
            }
            /* 只在真检测到 404 时才显示的小转圈 */
            html.${XMWPP_404_LOADING_CLASS}::after {
                content: '';
                position: fixed;
                left: 50%;
                top: 50%;
                width: 28px;
                height: 28px;
                margin: -14px 0 0 -14px;
                border: 3px solid rgba(124, 92, 255, 0.22);
                border-top-color: #7c5cff;
                border-radius: 50%;
                animation: xmwpp-404-spin 0.8s linear infinite;
                pointer-events: none;
                z-index: 999990;
            }
            @keyframes xmwpp-404-spin {
                to { transform: rotate(360deg); }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function set404Loading(on) {
        try { document.documentElement.classList.toggle(XMWPP_404_LOADING_CLASS, !!on); } catch (e) {}
    }

    // 结束守卫：撤掉遮挡 + 转圈 + 轮询
    function end404Guard() {
        if (poll404Timer) { clearInterval(poll404Timer); poll404Timer = null; }
        if (guard404Timer) { clearTimeout(guard404Timer); guard404Timer = null; }
        seen404At = 0;
        set404Loading(false);
        try { document.documentElement.classList.remove(XMWPP_404_GUARD_CLASS); } catch (e) {}
    }

    // 放弃自动刷新后给用户一个小按钮，别让人干看着 404
    const XMWPP_RETRY_TIP_ID = 'xmwpp-404-retry-tip';
    function show404RetryTip() {
        if (document.getElementById(XMWPP_RETRY_TIP_ID)) return;
        const tip = document.createElement('div');
        tip.id = XMWPP_RETRY_TIP_ID;
        tip.textContent = '页面路由异常 · 点这里重新加载';
        tip.style.cssText = [
            'position:fixed', 'left:50%', 'bottom:26px', 'transform:translateX(-50%)',
            'z-index:999999', 'padding:10px 18px', 'border-radius:999px',
            'background:rgba(24,26,32,.92)', 'color:#fff', 'font-size:14px',
            'font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif',
            'box-shadow:0 6px 20px rgba(0,0,0,.22)', 'cursor:pointer', 'user-select:none'
        ].join(';');
        tip.addEventListener('click', function () {
            try { sessionStorage.removeItem(XMWPP_404_STATE_KEY); } catch (e) {}
            location.reload();
        });
        document.body.appendChild(tip);
    }

    function maybeReload404() {
        const st = read404State();
        const now = Date.now();
        if (st.url !== location.href) { st.url = location.href; st.count = 0; }
        if (st.count >= XMWPP_404_MAX_RELOADS) {
            console.log('[XMW++] 同一地址已自动刷新 ' + st.count + ' 次仍是 404，改为展示重试按钮');
            show404RetryTip();
            return false;
        }
        if (now - (st.ts || 0) < XMWPP_404_RELOAD_GAP) return false;

        st.count += 1;
        st.ts = now;
        write404State(st);

        console.log('[XMW++] 🔄 路由停留在 404 页面，自动刷新（第 ' + st.count + ' 次）');
        location.reload();
        return true;
    }

    // 导航后启动：先遮挡，再每 200ms 看一眼 404 还在不在
    function start404Watch() {
        ensure404GuardStyle();
        if (poll404Timer) clearInterval(poll404Timer);
        seen404At = 0;
        set404Loading(false);
        try { document.documentElement.classList.add(XMWPP_404_GUARD_CLASS); } catch (e) {}
        if (guard404Timer) clearTimeout(guard404Timer);
        guard404Timer = setTimeout(end404Guard, XMWPP_404_GUARD_MS);

        poll404Timer = setInterval(() => {
            if (document.hidden) return;
            if (!document.documentElement.classList.contains(XMWPP_404_GUARD_CLASS)) {
                clearInterval(poll404Timer);
                poll404Timer = null;
                return;
            }
            if (is404Page()) {
                set404Loading(true);
                if (!seen404At) seen404At = Date.now();
                if (Date.now() - seen404At >= XMWPP_404_HOLD_MS) {
                    if (maybeReload404()) {
                        // 保持遮挡，直接等页面刷新，用户看不到 404
                        clearInterval(poll404Timer);
                        poll404Timer = null;
                        return;
                    }
                    // 不该再刷（同地址已刷过）→ 放开遮挡，显示站点自己的 404
                    end404Guard();
                }
            } else {
                if (seen404At) {
                    // 404 出现过又消失 → 目标路由已经渲染出来了，收工
                    seen404At = 0;
                    end404Guard();
                } else {
                    set404Loading(false);
                }
            }
        }, 200);
    }

    function watch404Page() {
        ensure404GuardStyle();
        console.log('[XMW++] 404 过渡态保护已启用');
    }

    // SPA 路由：URL 变化就遮挡 + 去抖同步一次
    function handleUrlChange() {
        lastUrl = location.href;
        const tip = document.getElementById(XMWPP_RETRY_TIP_ID);
        if (tip) tip.remove();          // 新路由能走了，收起重试提示
        start404Watch();
        scheduleRouteSync();
    }

    function routeHook() {
        if (location.href === lastUrl) return;
        handleUrlChange();
    }

    function scheduleRouteSync() {
        if (routeSyncTimer) return;
        routeSyncTimer = setTimeout(() => {
            routeSyncTimer = null;
            syncAfterRoute();
        }, 250);
    }

    // 劫持 history：点击标签页的瞬间就知道「开始导航了」，
    // 比等 DOM 变动再比对 URL 快一步，404 还没插进来遮挡就已经就位
    function installHistoryHooks() {
        try {
            ['pushState', 'replaceState'].forEach(function (name) {
                const orig = history[name];
                if (typeof orig !== 'function') return;
                history[name] = function () {
                    const before = location.href;
                    const ret = orig.apply(this, arguments);
                    if (location.href !== before) handleUrlChange();
                    return ret;
                };
            });
        } catch (e) {}
        window.addEventListener('popstate', function () {
            if (location.href !== lastUrl) handleUrlChange();
        });
        window.addEventListener('hashchange', function () {
            if (location.href !== lastUrl) handleUrlChange();
        });
    }

    // ---------- 3.1 用户ID ----------

    function displayUserId() {
        if (!settings.showUserId) return;

        const match = window.location.href.match(/\/person\/project\/all\/(\d+)/);
        if (!match) return;
        const userId = match[1];

        // 快速短路：两块内容都已插好、还在 DOM 里、且内容就是当前用户
        const existingId = document.querySelector('.xmwpp-user-id');
        const existingCard = document.querySelector('.xmwpp-card-info');
        const idFresh = !!(existingId && existingId.isConnected && existingId.textContent.trim() === '#' + userId);
        const cardFresh = !!(existingCard && existingCard.isConnected && existingCard.textContent.includes(userId));
        if (idFresh && cardFresh) return;

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

        if (existingId && existingId.isConnected) {
            // 同页切换到别的用户时，直接改文本，不做重建
            if (!idFresh) existingId.textContent = ' #' + userId;
        } else {
            if (existingId) existingId.remove();
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

        if (cardFresh) return;
        if (existingCard) existingCard.remove();

        // 找「个人名片」卡片：用文本节点定位，避免遍历全站 div
        let card = null;
        const header = findElementByExactText('个人名片');
        if (header) {
            let parent = header.parentElement;
            while (parent) {
                if (parent.getBoundingClientRect().height > 100) {
                    card = parent;
                    break;
                }
                parent = parent.parentElement;
            }
            if (!card) card = header.closest('div, section');
        }

        if (!card) {
            // 兜底：找同时含「性别」「年龄」的卡片（只看含「性别」的少量文本节点）
            const target = document.body;
            if (target) {
                const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
                    acceptNode(node) {
                        const v = node.nodeValue;
                        if (!v || !v.includes('性别')) return NodeFilter.FILTER_REJECT;
                        return NodeFilter.FILTER_ACCEPT;
                    }
                });
                let node;
                while ((node = walker.nextNode())) {
                    let p = node.parentElement;
                    for (let i = 0; i < 4 && p; i++) {
                        if (p.textContent.includes('年龄')) {
                            card = p.closest('div, section');
                            break;
                        }
                        p = p.parentElement;
                    }
                    if (card) break;
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

    // ---------- 3.2 深色模式 ----------

    const XMWPP_DARK_STYLE_ID = 'xmwpp-dark-mode';

    // 幂等：已生效就不重建样式表（原来每次路由都 remove + append，白白触发重算）
    function toggleDarkMode(enable) {
        const oldStyle = document.getElementById(XMWPP_DARK_STYLE_ID);
        if (!enable) {
            if (oldStyle) oldStyle.remove();
            return;
        }
        if (oldStyle) return;

        const style = document.createElement('style');
        style.id = XMWPP_DARK_STYLE_ID;
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

        // 深色模式里的 p/span/div 规则和 RGB 是同一权重，顺序决定谁生效；
        // 把 RGB 样式挪回队尾，避免「先开 RGB 再开深色」时颜色被压回去
        const rgbStyleNow = document.getElementById(XMWPP_RGB_STYLE_ID);
        if (rgbStyleNow && rgbStyleNow.nextElementSibling) {
            document.head.appendChild(rgbStyleNow);
        }

        console.log('[XMW++] 深色模式已启用');
    }

    // ---------- 3.3 签到（检测到就点击，无每日限制） ----------

    function doSign() {
        console.log('[XMW++] 尝试签到...');

        let signBtn = null;

        // 1) 站点自己的签到容器
        const selectors = ['[class*="sign"]', '[class*="checkin"]', '[class*="签到"]', '[class*="daily"]'];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && (el.textContent.includes('签到') || el.textContent.includes('打卡') || el.textContent.includes('每日'))) {
                signBtn = el;
                break;
            }
        }

        // 2) 文本定位（不再全页 querySelectorAll('button, a, span, div')）
        if (!signBtn) {
            signBtn = findClickableByTexts(['签到', '打卡', '每日签到']);
        }

        if (signBtn) {
            signBtn.click();
            console.log('[XMW++] ✅ 签到成功！');
            return true;
        }
        console.log('[XMW++] ⚠️ 未找到签到按钮');
        return false;
    }

    function autoSign() {
        if (!settings.autoSign) return;
        doSign();
    }

    // ---------- 3.4 RGB模式 ----------
    //
    // 原版：setInterval 30ms 改写 <style> 的 textContent，等于每帧重解析整张表，
    // 再叠加 body * 的 transition: color，开销爆炸。
    // 现在：一条用 CSS 变量的规则，rAF 驱动（约 30fps，50°/s 与原版一致），
    //      页面隐藏时 rAF 自动暂停，回到前台再续上，切标签不再积压任务。

    const XMWPP_RGB_STYLE_ID = 'xmwpp-rgb-mode';
    let rgbEnabled = false;
    let rgbFrame = null;
    let rgbHue = 0;
    let rgbLastTs = 0;
    let rgbLastPaint = 0;

    function rgbTick(ts) {
        rgbFrame = null;
        if (!rgbEnabled) return;

        if (!rgbLastTs) {
            rgbLastTs = ts;
            rgbLastPaint = ts;
        }
        // 从后台切回来时 ts 会跳很远，钳制一下避免颜色突跳
        const dt = Math.min(ts - rgbLastTs, 200);
        rgbLastTs = ts;
        rgbHue = (rgbHue + dt * 0.05) % 360;   // 50°/s

        if (ts - rgbLastPaint >= 33 && !document.hidden) {
            rgbLastPaint = ts;
            document.documentElement.style.setProperty('--xmwpp-rgb-hue', rgbHue.toFixed(1));
        }
        rgbFrame = requestAnimationFrame(rgbTick);
    }

    function toggleRgbMode(enable) {
        enable = !!enable;
        let oldStyle = document.getElementById(XMWPP_RGB_STYLE_ID);

        // 先停掉旧循环，避免叠加多个 rAF
        if (rgbFrame) {
            cancelAnimationFrame(rgbFrame);
            rgbFrame = null;
        }
        rgbEnabled = false;

        if (!enable) {
            if (oldStyle) oldStyle.remove();
            try { document.documentElement.style.removeProperty('--xmwpp-rgb-hue'); } catch (e) {}
            rgbLastTs = 0;
            console.log('[XMW++] RGB模式已关闭');
            return;
        }

        // 重新启用时清掉可能残留的旧样式表，保证只有一份规则
        if (oldStyle) {
            oldStyle.remove();
            oldStyle = null;
        }

        const style = document.createElement('style');
        style.id = XMWPP_RGB_STYLE_ID;
        style.textContent = `
            body * {
                color: hsl(var(--xmwpp-rgb-hue, 0), 80%, 55%) !important;
            }
            .xmwpp-toolkit-popup-overlay, .xmwpp-toolkit-popup-overlay * { color: inherit !important; }
            .xmwpp-toolkit-popup button, .xmwpp-toolkit-popup button * { color: #fff !important; }
            .xmwpp-toolkit-popup [style*="background:"] { color: #fff !important; }
            .xmwpp-toolkit-popup [id*="toggle-"] { color: #fff !important; }
            .xmwpp-toolkit-popup #xmwpp-manual-sign { color: #fff !important; }
            .xmwpp-toolkit-popup #xmwpp-close-popup { color: #999 !important; }
        `;
        document.head.appendChild(style);

        rgbEnabled = true;
        rgbHue = 0;
        rgbLastTs = 0;
        rgbLastPaint = 0;
        document.documentElement.style.setProperty('--xmwpp-rgb-hue', '0');
        rgbFrame = requestAnimationFrame(rgbTick);
        console.log('[XMW++] RGB模式已启用');
    }

    function ensureRgbMode() {
        if (!settings.rgbMode) return;
        if (document.getElementById(XMWPP_RGB_STYLE_ID) && rgbEnabled) {
            // 循环意外中断（例如长时间后台）时补一次 rAF
            if (!rgbFrame) {
                rgbLastTs = 0;
                rgbFrame = requestAnimationFrame(rgbTick);
            }
            return;
        }
        toggleRgbMode(true);
    }

    // ---------- 3.5 自定义网页壁纸（作用于本站所有页面） ----------
    //
    // 站点只在个人主页有背景容器（div.bgImg__1veTq），其它页面根本没有带 bgImg 类的元素；
    // 而单纯铺在最底层的图层，会被站点某个全屏不透明元素挡在后面。
    // 所以这里走「兜底层 + 就地接管」两条路：
    //   1. 兜底层：body 第一个子节点，position:fixed + z-index:-1，
    //      永远在页面所有卡片、文字下面，管不到的地方由它兜底；
    //   2. 就地接管：把站点那个全屏背景元素找出来，直接把我们的壁纸涂在它身上。
    //      它本来就夹在卡片下面，所以最终效果 = 壁纸在所有卡片下面，同时压住站点原背景。
    const XMWPP_WALLPAPER_STYLE_ID = 'xmwpp-wallpaper-style';
    const XMWPP_WALLPAPER_LAYER_ID = 'xmwpp-wallpaper-layer';
    const XMWPP_WALLPAPER_SCOPE_CLASS = 'xmwpp-wallpaper-on';
    const XMWPP_WALLPAPER_PROPS = [
        'background-image', 'background-color', 'background-size',
        'background-position', 'background-repeat', 'background-attachment'
    ];
    // 站点背景元素的原始内联样式，用于「恢复默认」时还原
    const wallpaperOriginals = new WeakMap();
    let wallpaperBackdrops = [];
    let lastBackdropScan = 0;
    let wallpaperHookOn = false;
    let wallpaperQueued = false;
    let currentWallpaper = '';
    let currentWallpaperIsColor = false;

    function isColorValue(v) {
        return typeof v === 'string' && /^#([0-9a-f]{3,8})$/i.test(v.trim());
    }

    function xmwppWallpaperLayersCss() {
        const isColor = currentWallpaperIsColor;
        const image = isColor ? 'none' : 'url("' + currentWallpaper + '")';
        const placement = isColor ? '' : `
                background-size: cover !important;
                background-position: center center !important;
                background-repeat: no-repeat !important;`;
        return `
            /* 兜底壁纸层：负 z-index，永远在页面所有卡片/文字下面 */
            #${XMWPP_WALLPAPER_LAYER_ID} {
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                right: 0 !important;
                bottom: 0 !important;
                width: 100% !important;
                height: 100% !important;
                margin: 0 !important;
                padding: 0 !important;
                border: 0 !important;
                display: block !important;
                pointer-events: none !important;
                z-index: -1 !important;
                background-image: ${image} !important;
                background-color: ${isColor ? currentWallpaper : 'transparent'} !important;${placement}
            }
            /* html / body 保持透明，壁纸才能从页面内容背后透出来 */
            html.${XMWPP_WALLPAPER_SCOPE_CLASS},
            html.${XMWPP_WALLPAPER_SCOPE_CLASS} body {
                background-color: transparent !important;
                background-image: none !important;
            }
        `;
    }

    function ensureWallpaperLayer() {
        let layer = document.getElementById(XMWPP_WALLPAPER_LAYER_ID);
        if (!layer) {
            layer = document.createElement('div');
            layer.id = XMWPP_WALLPAPER_LAYER_ID;
            layer.setAttribute('aria-hidden', 'true');
        }
        try { document.documentElement.classList.add(XMWPP_WALLPAPER_SCOPE_CLASS); } catch (e) {}
        // 挂在 body 第一个子节点：z-index:-1 的图层若父级建立了层叠上下文会失效
        if (layer.parentNode !== document.body || document.body.firstChild !== layer) {
            try { document.body.insertBefore(layer, document.body.firstChild); } catch (e) { return null; }
        }
        return layer;
    }

    // 样式表始终放到 head 末尾，保证优先级最高（不会被深色模式等后插入的样式盖掉）
    function setWallpaperStyle(css) {
        const old = document.getElementById(XMWPP_WALLPAPER_STYLE_ID);
        if (old) old.remove();
        if (!css) return;
        const style = document.createElement('style');
        style.id = XMWPP_WALLPAPER_STYLE_ID;
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }

    // 给兜底图层打内联样式，作为样式表被清掉时的兜底
    function paintWallpaperLayer() {
        const layer = ensureWallpaperLayer();
        if (!layer) return 0;
        try {
            layer.style.setProperty('position', 'fixed', 'important');
            layer.style.setProperty('top', '0', 'important');
            layer.style.setProperty('left', '0', 'important');
            layer.style.setProperty('width', '100vw', 'important');
            layer.style.setProperty('height', '100vh', 'important');
            layer.style.setProperty('pointer-events', 'none', 'important');
            layer.style.setProperty('z-index', '-1', 'important');
            if (currentWallpaperIsColor) {
                layer.style.setProperty('background-image', 'none', 'important');
                layer.style.setProperty('background-color', currentWallpaper, 'important');
            } else {
                layer.style.setProperty('background-image', 'url("' + currentWallpaper + '")', 'important');
                layer.style.setProperty('background-color', 'transparent', 'important');
                layer.style.setProperty('background-size', 'cover', 'important');
                layer.style.setProperty('background-position', 'center center', 'important');
                layer.style.setProperty('background-repeat', 'no-repeat', 'important');
            }
        } catch (e) {}
        return 1;
    }

    // ---------- 找出站点自己的全屏背景元素（就是挡住壁纸的那个） ----------

    // 背景是否「不透明」：带 alpha 的底色或任意背景图都算
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

    // 判定标准：铺满视口 + 底色不透明（或带背景图）+ 不是弹窗遮罩
    function isFullScreenBackdrop(el) {
        if (!el || el.nodeType !== 1) return false;
        if (el.id === XMWPP_WALLPAPER_LAYER_ID) return false;
        if (el === document.body || el === document.documentElement) return false;
        if (!el.classList) return false;
        if (el.classList.contains('xmwpp-toolkit-popup') ||
            el.classList.contains('xmwpp-toolkit-popup-overlay') ||
            el.classList.contains('xmwpp-float-ball')) return false;
        let cs;
        try { cs = window.getComputedStyle(el); } catch (e) { return false; }
        if (!cs) return false;
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (parseFloat(cs.opacity || '1') === 0) return false;
        if (!hasOpaquePaint(cs)) return false;
        const r = el.getBoundingClientRect();
        if (r.width < window.innerWidth * 0.9 || r.height < window.innerHeight * 0.9) return false;
        if (r.top > 8 || r.left > 8) return false;
        const z = parseInt(cs.zIndex, 10);
        if (!isNaN(z) && z > 900) return false;   // 疑似弹窗/浮层遮罩，不碰
        return true;
    }

    function collectBackdropCandidates() {
        const out = [];
        const push = el => { if (el && out.indexOf(el) < 0) out.push(el); };
        if (!document.body) return out;

        // 1) 命中测试：视口中心这一列上的所有元素（从最上层到最下层）
        try {
            const stack = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2) || [];
            for (let i = stack.length - 1; i >= 0; i--) push(stack[i]);
        } catch (e) {}

        // 2) body 前两层的子元素
        try {
            let inspected = 0;
            const scan = (parent, depth) => {
                if (!parent || depth > 2 || inspected > 200) return;
                for (const el of parent.children) {
                    if (inspected++ > 200) return;
                    push(el);
                    if (depth < 2) scan(el, depth + 1);
                }
            };
            scan(document.body, 0);
        } catch (e) {}

        // 3) 名字里带 bg / background / backdrop 的元素（pointer-events:none 也能捞到）
        try {
            const named = document.querySelectorAll(
                '[class*="bg" i], [id*="bg" i], [class*="background" i], [id*="background" i],' +
                '[class*="backdrop" i], [id*="backdrop" i]'
            );
            for (let i = 0; i < named.length && i < 400; i++) push(named[i]);
        } catch (e) {}

        return out;
    }

    function readBackdropStyle(el) {
        const saved = {};
        for (const prop of XMWPP_WALLPAPER_PROPS) {
            saved[prop] = el.style.getPropertyValue(prop);
            saved[prop + '!'] = el.style.getPropertyPriority(prop);
        }
        return saved;
    }

    function resetBackdrop(el) {
        const saved = wallpaperOriginals.get(el);
        if (!saved) return;
        for (const prop of XMWPP_WALLPAPER_PROPS) {
            try {
                if (saved[prop]) el.style.setProperty(prop, saved[prop], saved[prop + '!'] || '');
                else el.style.removeProperty(prop);
            } catch (e) {}
        }
        wallpaperOriginals.delete(el);
    }

    function paintBackdrop(el) {
        if (!wallpaperOriginals.has(el)) wallpaperOriginals.set(el, readBackdropStyle(el));
        try {
            if (currentWallpaperIsColor) {
                el.style.setProperty('background-image', 'none', 'important');
                el.style.setProperty('background-color', currentWallpaper, 'important');
            } else {
                el.style.setProperty('background-image', 'url("' + currentWallpaper + '")', 'important');
                el.style.setProperty('background-size', 'cover', 'important');
                el.style.setProperty('background-position', 'center center', 'important');
                el.style.setProperty('background-repeat', 'no-repeat', 'important');
                el.style.setProperty('background-attachment', 'fixed', 'important');
            }
        } catch (e) {}
    }

    // 把壁纸涂到站点自己的全屏背景元素上（它本来就在卡片下面）
    function paintSiteBackdrops() {
        const next = collectBackdropCandidates().filter(isFullScreenBackdrop);
        wallpaperBackdrops.forEach(el => { if (next.indexOf(el) < 0) resetBackdrop(el); });
        wallpaperBackdrops = next;
        next.forEach(paintBackdrop);
        return next.length;
    }

    // 高频调用时的省流路径：背景元素还在就只重涂，最多 1.5s 做一次完整重扫
    function refreshSiteBackdrops() {
        const now = Date.now();
        const alive = wallpaperBackdrops.length > 0 && wallpaperBackdrops.every(el => el.isConnected);
        if (alive && now - lastBackdropScan < 1500) {
            wallpaperBackdrops.forEach(paintBackdrop);
            return wallpaperBackdrops.length;
        }
        lastBackdropScan = now;
        return paintSiteBackdrops();
    }

    // 保证壁纸整体状态（样式表在末尾、图层在、站点背景已接管）
    function ensureWallpaperApplied() {
        if (!currentWallpaper) return;
        const style = document.getElementById(XMWPP_WALLPAPER_STYLE_ID);
        if (!style || style !== document.head.lastElementChild) {
            setWallpaperStyle(xmwppWallpaperLayersCss());
        }
        try { document.documentElement.classList.add(XMWPP_WALLPAPER_SCOPE_CLASS); } catch (e) {}
        paintWallpaperLayer();
        refreshSiteBackdrops();
    }

    // DOM 变动钩子（替代原版单独的 MutationObserver）
    function wallpaperHook() {
        if (!currentWallpaper || wallpaperQueued || document.hidden) return;
        wallpaperQueued = true;
        setTimeout(() => {
            wallpaperQueued = false;
            if (!currentWallpaper) return;
            ensureWallpaperApplied();
        }, 300);
    }

    function startWallpaperObserver() {
        if (wallpaperHookOn) return;
        wallpaperHookOn = true;
        onDomChange(wallpaperHook);
    }

    function stopWallpaperObserver() {
        if (!wallpaperHookOn) return;
        wallpaperHookOn = false;
        wallpaperQueued = false;
        offDomChange(wallpaperHook);
    }

    function clearWallpaper() {
        stopWallpaperObserver();
        wallpaperBackdrops.forEach(resetBackdrop);
        wallpaperBackdrops = [];
        const layer = document.getElementById(XMWPP_WALLPAPER_LAYER_ID);
        if (layer) layer.remove();
        setWallpaperStyle('');
        try { document.documentElement.classList.remove(XMWPP_WALLPAPER_SCOPE_CLASS); } catch (e) {}
        currentWallpaper = '';
        currentWallpaperIsColor = false;
    }

    function applyWallpaper(url) {
        const value = (url || '').trim();
        if (!value) {
            restoreDefaultWallpaper();
            return;
        }
        currentWallpaper = value;
        currentWallpaperIsColor = isColorValue(value);
        setWallpaperStyle(xmwppWallpaperLayersCss());
        paintWallpaperLayer();
        lastBackdropScan = Date.now();
        // 重扫放空闲帧，不阻塞当前这一帧（尤其是路由刚渲染完的时候）
        idle(() => {
            if (!currentWallpaper) return;
            const n = paintSiteBackdrops();
            console.log('[XMW++] 全站壁纸已应用:', currentWallpaperIsColor ? currentWallpaper : '(图片) ' + currentWallpaper,
                        '| 已接管站点背景元素 ' + n + ' 个');
        }, 800);
        startWallpaperObserver();
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
        } else {
            restoreDefaultWallpaper();
        }
    }

    // 路由 / 回到前台时补一次壁纸（去抖，避免连续重扫）
    function scheduleWallpaperRefresh() {
        if (!currentWallpaper || wallpaperQueued) return;
        wallpaperQueued = true;
        setTimeout(() => {
            wallpaperQueued = false;
            if (!currentWallpaper) return;
            ensureWallpaperApplied();
        }, 300);
    }

    // ---------- 3.6 全局字体 ----------
    //
    // 原版：setInterval 1000ms 对全站所有元素 setProperty('font-family')，
    //       即每秒 N 次写内联样式 + N 次样式失效，切页时最卡的就是它。
    // 现在：一条 `*{font-family: ... !important}` 规则即可覆盖所有元素（含后加的），
    //       内联样式同样被 !important 规则压住，不需要逐元素写、不需要定时器。

    let currentFontName = '';

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
        if (!fontName || !fontName.trim()) return;

        const fontFamily = `"${fontName.trim()}", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif`;

        let style = document.getElementById('xmwpp-font-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'xmwpp-font-style';
            document.head.appendChild(style);
        }
        const css = `
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
        if (style.textContent !== css) style.textContent = css;
    }

    function startFontPersistence(fontName) {
        if (!fontName || !fontName.trim()) return;
        loadGoogleFontLink(fontName);
        setTimeout(() => forceApplyFontToAllElements(fontName), 100);
        currentFontName = fontName.trim();
        console.log('[XMW++] 字体已强制应用到所有元素:', fontName);
    }

    function stopFontPersistence() {
        currentFontName = '';
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

    // 路由后补应用（幂等短路，不再重跑整套逻辑）
    function ensureFont() {
        if (!settings.customFont) return;
        if (currentFontName === settings.customFont && document.getElementById('xmwpp-font-style')) return;
        startFontPersistence(settings.customFont);
    }

    // ---------- 3.7 网页缩放控制 ----------

    let appliedZoom = null;

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

    function applyZoomToPage(val) {
        if (!document.body) return;
        // 100% 直接清掉内联 zoom，少一层整页缩放上下文
        document.body.style.zoom = val === 100 ? '' : String(val / 100);
    }

    function initZoom() {
        const zoom = getSavedZoom();
        if (zoom === appliedZoom) return;   // 值没变就不碰布局
        appliedZoom = zoom;
        applyZoomToPage(zoom);
        console.log('[XMW++] 缩放已应用:', zoom + '%');
    }

    // ---------- 3.8 自动领取奖励 ----------

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
            // 兜底：用文本定位，避免遍历全站 button/a/span/div 读 textContent
            const targets = findAllClickableByTexts(['领取', '立即领取', '点击领取']);
            for (const el of targets) {
                if (el.offsetParent === null) continue;
                try {
                    el.click();
                    claimed++;
                    console.log('[XMW++] 领取了一个奖励');
                } catch(e) {}
            }
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
        if (document.hidden) return 0;   // 后台标签不做全页扫描
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
        if (!settings.autoLinkify || linkifyQueued || document.hidden) return;
        linkifyQueued = true;
        setTimeout(() => {
            linkifyQueued = false;
            if (!settings.autoLinkify) return;
            idle(() => runLinkifyNow(), 800);
        }, 400);
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
            // 只有这个功能确实需要 characterData（文本变化），所以保留独立观察器，
            // 且仅在功能开启时存在
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
        ball.innerHTML = `<img src="https://world.xiaomawang.com/favicon.ico" alt="XMW++" style="width:100%;height:100%;object-fit:contain;pointer-events:none;">`;

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
        if (existing) {
            // 修 bug：原版只删 popup，遮罩会残留挡住页面
            const overlayEl = existing.closest('.xmwpp-toolkit-popup-overlay');
            (overlayEl || existing).remove();
            return;
        }

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
                </div>

                <!-- ===== 关于 标签页 ===== -->
                <div class="xmwpp-tab-content" data-content="about" style="display:${currentTab === 'about' ? 'block' : 'none'};">
                    <div style="text-align:center;padding:22px 0;">
                        <img src="https://world.xiaomawang.com/favicon.ico" style="width:64px;height:64px;border-radius:18px;margin-bottom:14px;">
                        <div style="font-size:19px;font-weight:700;color:#0f172a;margin-bottom:5px;">XMW++</div>
                        <div style="font-size:13px;color:#888;margin-bottom:24px;">小码王社区 · 多功能工具箱（优化版）</div>
                        <div style="font-size:13px;color:#555;line-height:2;text-align:left;max-width:320px;margin:0 auto;">
                            <div style="display:flex;justify-content:space-between;"><span style="color:#999;">版本</span><span style="font-weight:500;">v2.6</span></div>
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
            appliedZoom = val;
            applyZoomToPage(val);
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
    // 6. 初始化 / 路由同步
    // ============================================================

    function syncAfterRoute() {
        initZoom();
        addFloatingBall();
        displayUserId();
        // 站点内容异步渲染，补两次；displayUserId 已做了幂等短路，成本很低
        setTimeout(displayUserId, 800);
        setTimeout(displayUserId, 2000);

        toggleDarkMode(settings.darkMode);
        ensureRgbMode();
        ensureFont();

        if (settings.customWallpaper && settings.wallpaperUrl) scheduleWallpaperRefresh();

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
                scheduleLinkify();
            }, 900);
        }
    }

    function init() {
        if (!document.body) {
            setTimeout(init, 400);
            return;
        }

        initZoom();
        startRemovingSiteElements();
        installHistoryHooks();       // 先装路由钩子，导航一开始就能遮挡 404
        onDomChange(routeHook);      // 兜底：URL 变化检测
        watch404Page();
        startDomObserver();          // 所有钩子注册完再开始监听

        // 悬浮球：立即上，再补一次（站点可能把 body 内容重建）
        addFloatingBall();
        setTimeout(addFloatingBall, 1500);

        displayUserId();
        toggleDarkMode(settings.darkMode);
        ensureRgbMode();

        if (settings.customFont) ensureFont();

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

        // 切回前台：rAF 已自动恢复；再补一次壁纸 / 链接识别
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) return;
            ensureRgbMode();
            if (settings.customWallpaper && settings.wallpaperUrl) scheduleWallpaperRefresh();
            if (settings.autoLinkify) scheduleLinkify();
        });

        console.log('[XMW++] 已加载 v2.6（优化版）');
        console.log('[XMW++] 仓库: https://github.com/Toushou-114514/XMWPP');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
//（注：内容由AI生成）
