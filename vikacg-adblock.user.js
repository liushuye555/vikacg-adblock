// ==UserScript==
// @name         VikACG 去广告（维咔V站）
// @namespace    https://www.vikacg.com/
// @version      1.3.1
// @description  移除维咔VikACG 的顶部广告条、轮播广告图、侧栏广告卡、信息流推广卡片与菜单广告链接，使站点的"广告拦截器检测"失效，并拦截投票/收藏/搜索后自动弹出的广告页。所有去广告动作只隐藏广告元素本身，不拦截、不改写任何正常链接的跳转；"外链直达"（跳过 /external 中转页）为可选项，可在油猴菜单中开关。支持主站与全部备用域名。
// @author       liushuye555
// @license      MIT
// @match        *://www.vikacg.com/*
// @match        *://vikacg.com/*
// @match        *://*.vikacg.com/*
// @match        *://www.vikacg.cc/*
// @match        *://vikacg.cc/*
// @match        *://*.vikacg.cc/*
// @match        *://vikacg.moe.mov/*
// @match        *://*.vikacg.moe.mov/*
// @match        *://vikacg.eueu.lol/*
// @match        *://*.vikacg.eueu.lol/*
// @run-at       document-start
// @noframes
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const doc = win.document;

  /* ---------------- 设置 ---------------- */
  const DEFAULTS = {
    adShowOff: true,      // 用站点自带的 adShow 开关从源头关闭广告
    headerAds: true,      // 顶部横向广告条
    carouselAds: true,    // 轮播广告图（只移除包含外链的轮播）
    sidebarAds: true,     // 侧栏广告卡片
    feedAds: true,        // 信息流"XX区-推广"卡片
    pinkLinks: true,      // 菜单中的粉色广告链接（仅站外链接）
    bottomBar: true,      // 底部"下载App"悬浮横幅
    killDetect: true,     // 使广告拦截器检测失效（不弹窗）
    blockAutoAds: true,   // 拦截投票/收藏/搜索后自动弹出的广告页
    externalDirect: true, // 外链直达：跳过 /external 中转页直接打开目标网址
  };
  let cfg;
  try { cfg = Object.assign({}, DEFAULTS, JSON.parse(GM_getValue('vkacg_cfg', '{}'))); }
  catch (e) { cfg = Object.assign({}, DEFAULTS); }
  const saveCfg = () => { try { GM_setValue('vkacg_cfg', JSON.stringify(cfg)); } catch (e) {} };

  const isExternal = (a) => {
    try {
      const href = a.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(href)) return false; // 站内相对链接一律不动
      return new URL(href, location.href).host !== location.host;
    } catch (e) { return false; }
  };

  // 判定是否为正文容器：含正文标记、段落密集、或图文并茂的一律视为内容，禁止隐藏。
  // 注意：纯广告图片堆没有 <p> 段落，不会被误判为正文。
  const looksLikeContent = (el) => {
    try {
      if (el.querySelector('article, .prose')) return true;
      const pCount = el.querySelectorAll('p').length;
      const imgCount = el.querySelectorAll('img').length;
      const textLen = (el.textContent || '').length;
      if (pCount >= 5 && textLen > 400) return true;
      if (imgCount >= 4 && pCount >= 3 && textLen > 200) return true;
      return false;
    } catch (e) { return false; }
  };

  const hide = (el, rule) => {
    if (!el) return;
    // 内容保险丝：任何规则都不得隐藏"看起来是正文"的容器
    // （详情页的推广角标、站外图床等都可能与广告特征相似，这里是最后防线）
    if (looksLikeContent(el)) {
      console.log('[VikACG 去广告] 跳过含正文内容的容器，未隐藏（规则:' + rule + '）');
      return;
    }
    el.dataset.vkAdRule = rule;
    el.style.setProperty('display', 'none', 'important');
  };
  const unhideIf = (rule) => {
    doc.querySelectorAll('[data-vk-ad-rule="' + rule + '"]').forEach((el) => {
      el.style.removeProperty('display');
      delete el.dataset.vkAdRule;
    });
  };

  /* 动态 CSS：随菜单开关实时更新 */
  let styleEl = null;
  const applyCss = () => {
    const css = [
      cfg.headerAds ? 'div.ads-scroll-hide{display:none !important;}' : '',
      'ins.adsbygoogle,iframe[src*="googlesyndication"],iframe[src*="googletagservices"],' +
        'iframe[id^="google_ads"],div[id^="div-gpt-ad"]{display:none !important;}',
    ].filter(Boolean).join('\n');
    if (!styleEl) {
      styleEl = doc.createElement('style');
      styleEl.id = 'vkacg-adblock-style';
      const mount = () => { if (doc.head && styleEl.parentNode !== doc.head) doc.head.appendChild(styleEl); };
      mount();
      doc.addEventListener('DOMContentLoaded', mount);
    }
    styleEl.textContent = css;
  };
  applyCss();

  /* ---------------- 第 1 层：站点自带广告开关（源头关闭） ---------------- */
  // 站点用 useRuntimeConfig().public.adShow === true 决定是否请求/渲染广告。
  // 该配置由页面内联脚本在应用启动前写入 window.__NUXT__，这里用属性陷阱在写入时改掉。
  (function trapNuxtConfig() {
    if (!cfg.adShowOff) return;
    const patch = (o) => {
      try { if (o && o.public && 'adShow' in o.public && o.public.adShow !== false) o.public.adShow = false; } catch (e) {}
    };
    try {
      let store;
      Object.defineProperty(win, '__NUXT__', {
        configurable: true,
        get() { return store; },
        set(v) {
          store = v && typeof v === 'object' && typeof Proxy !== 'undefined'
            ? new Proxy(v, {
                set(t, k, val) { t[k] = val; if (k === 'config') patch(val); return true; },
              })
            : v;
        },
      });
    } catch (e) {}
    // 兜底轮询：若陷阱未生效，在应用启动前仍有机会改到
    let tries = 0;
    const timer = setInterval(() => {
      let done = true;
      try {
        const p = win.__NUXT__ && win.__NUXT__.config && win.__NUXT__.config.public;
        if (p && p.adShow === true) p.adShow = false;
        if (!p || p.adShow !== false) done = false;
      } catch (e) {}
      if (done || ++tries > 50) clearInterval(timer);
    }, 100);
  })();

  /* ---------------- 第 2 层：广告拦截器检测失效 ---------------- */
  let sweepTipsFn = null;
  (function killAdblockDetect() {
    if (!cfg.killDetect) return;
    const BAIT = 'just-detect-adblock/master/baits/';

    // 1) 站点会 XHR 拉取检测诱饵文件，直接返回"未检出"的应答
    try {
      const XHR = win.XMLHttpRequest;
      if (XHR && XHR.prototype) {
        const origOpen = XHR.prototype.open;
        const origSend = XHR.prototype.send;
        XHR.prototype.open = function (method, url) {
          try { this.__vkBait = typeof url === 'string' && url.indexOf(BAIT) !== -1; } catch (e) {}
          return origOpen.apply(this, arguments);
        };
        XHR.prototype.send = function () {
          if (this.__vkBait) {
            const self = this;
            setTimeout(() => {
              try {
                Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
                Object.defineProperty(self, 'status', { value: 200, configurable: true });
                Object.defineProperty(self, 'responseText', { value: 'thistextshouldbethere\n', configurable: true });
                if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
                self.dispatchEvent(new Event('readystatechange'));
                self.dispatchEvent(new Event('load'));
                self.dispatchEvent(new Event('loadend'));
              } catch (e) {}
            }, 0);
            return;
          }
          return origSend.apply(this, arguments);
        };
      }
    } catch (e) {}

    // 2) fetch 同理兜底
    try {
      const origFetch = win.fetch;
      if (origFetch) {
        win.fetch = function (input) {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          if (url.indexOf(BAIT) !== -1) {
            return Promise.resolve(new Response('thistextshouldbethere\n', { status: 200 }));
          }
          return origFetch.apply(this, arguments);
        };
      }
    } catch (e) {}

    // 3) 检测脚本会创建带典型广告类名的 1px 诱饵元素，让诱饵"永远可见"
    const baitStyle = doc.createElement('style');
    baitStyle.textContent =
      '.pub_300x250,.pub_300x250m,.pub_728x90,.text-ad,.textAd,.text_ad,.text_ads,.text-ads,' +
      '.text-ad-links,.ad-text,.adSense,.adBlock,.adContent,.adBanner' +
      '{display:revert !important;visibility:visible !important;opacity:1 !important;}';
    const mountBaitStyle = () => { if (doc.head && baitStyle.parentNode !== doc.head) doc.head.appendChild(baitStyle); };
    if (doc.documentElement) mountBaitStyle();
    doc.addEventListener('DOMContentLoaded', mountBaitStyle);

    // 4) 检测脚本会在 body 上打 abp 标记，持续移除
    const startAttrGuard = () => {
      if (doc.body && !startAttrGuard._mo) {
        startAttrGuard._mo = new MutationObserver(() => {
          if (doc.body.hasAttribute('abp')) doc.body.removeAttribute('abp');
        });
        startAttrGuard._mo.observe(doc.body, { attributes: true, attributeFilter: ['abp'] });
      }
    };
    doc.addEventListener('DOMContentLoaded', startAttrGuard);
    try { startAttrGuard(); } catch (e) {}

    // 5) 保险丝：万一仍弹检测提示，按文本特征把弹窗隐藏
    const TIP = /广告拦截器已启用|检测到您的浏览器启用了广告拦截器|PWA 已暂停渲染|ad.?blocker (is|has been) enabled/i;
    sweepTipsFn = () => {
      doc.querySelectorAll('.arco-notification, .arco-modal, [role="dialog"], [id*="adblock-tips"]').forEach((box) => {
        if (box.dataset.vkAdRule) return;
        if (TIP.test(box.textContent || '')) hide(box, 'detect-tip');
      });
    };
  })();

  /* ---------------- 第 3 层：外链直达（可选，默认开） ---------------- */
  // 站点会把外链导航到 /external?url=... 中转页（滚动确认/人机验证/推广App）。
  // 开启后读取 url 参数直接跳转；关闭则完全保持站点原有行为。仅处理 http(s) 外链。
  (function externalDirect() {
    if (!cfg.externalDirect) return;
    let jumped = false;
    const jump = () => {
      try {
        if (jumped || cfg.externalDirect === false || location.pathname !== '/external') return;
        const url = new URLSearchParams(location.search).get('url') || '';
        if (!/^https?:\/\//i.test(url)) return;
        const target = new URL(url, location.href);
        if (target.host === location.host) return;
        jumped = true;
        location.replace(target.href);
      } catch (e) {}
    };
    jump();
    try {
      const ps = win.history.pushState, rs = win.history.replaceState;
      win.history.pushState = function () { const r = ps.apply(this, arguments); jump(); return r; };
      win.history.replaceState = function () { const r = rs.apply(this, arguments); jump(); return r; };
      win.addEventListener('popstate', jump);
    } catch (e) {}
    // 通用兜底：低频检查路径（兼容各脚本引擎的沙箱差异）
    setInterval(jump, 800);
  })();

  /* ---------------- 第 4 层：拦截自动弹出的广告页 ---------------- */
  // 站点广告系统会在投票/收藏/搜索/做任务等操作后自动 window.open 打开广告页
  // （代码中的 click_source:"auto"），且对"检测到拦截器"或安卓用户更频繁。
  // 这里在 window.open 上设闸：同源放行；OAuth 登录域放行；用户点击的链接本身放行；
  // 其余跨域弹出（即广告自动弹窗）一律拦截。不触碰 location 跳转与 <a> 链接点击。
  (function guardWindowOpen() {
    if (!cfg.blockAutoAds) return;
    try {
      const OAUTH = /(^|\.)(accounts\.google\.com|github\.com|twitter\.com|x\.com|facebook\.com|apple\.com|discord\.com|discord\.gg)$/i;
      let lastClickHref = null;
      doc.addEventListener('pointerdown', (e) => {
        try {
          if (!e.isTrusted) return;
          const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
          lastClickHref = a ? a.href : null;
        } catch (err) {}
      }, true);
      const origOpen = win.open;
      win.open = function (url) {
        let u = null;
        try { u = new URL(String(url === undefined ? '' : url), location.href); } catch (e) { return null; }
        // 非 http(s)（如 vikacg:// 深链、about:blank）不拦
        if (!/^https?:$/.test(u.protocol)) return origOpen.apply(this, arguments);
        if (u.host === location.host) return origOpen.apply(this, arguments);
        // 中转页上的手动"继续访问"按钮不做限制（开启外链直达时该页本就不会停留）
        if (location.pathname === '/external') return origOpen.apply(this, arguments);
        if (OAUTH.test(u.host)) return origOpen.apply(this, arguments);
        // 用户点击的就是这个链接（如中键/新窗口打开）
        try { if (lastClickHref && u.href.split('#')[0] === lastClickHref.split('#')[0]) return origOpen.apply(this, arguments); } catch (e) {}
        console.log('[VikACG 去广告] 已拦截自动弹出的广告页:', u.href);
        return null;
      };
    } catch (e) {}
  })();

  /* ---------------- 第 5 层：DOM 广告清除 ---------------- */
  (function domSweep() {
    const sweep = () => {
      // 1) 顶部广告条（CSS 已兜底，这里覆盖开关变化）
      if (cfg.headerAds) doc.querySelectorAll('div.ads-scroll-hide').forEach((el) => hide(el, 'header'));
      else unhideIf('header');

      // 2) arco 轮播形态兜底（幻灯片不是标准 a.w-full 形态时）
      if (cfg.carouselAds) {
        doc.querySelectorAll('.arco-carousel').forEach((c) => {
          if (c.dataset.vkAdRule || c.closest('[data-vk-ad-rule]')) return;
          if (Array.from(c.querySelectorAll('a[href]')).some(isExternal)) {
            hide(c.closest('div.rounded-2xl') || c, 'carousel');
          }
        });
      }

      // 3) 统一广告识别：站外 a.w-full 是站点广告渲染器的固定特征（均经 div.contents 包裹）
      doc.querySelectorAll('a.w-full[href]').forEach((a) => {
        if (a.dataset.vkAdRule || a.closest('[data-vk-ad-rule]') || !isExternal(a)) return;
        // 跳过正文区域：文章内嵌的图片/下载链接可能同样是"站外 w-full 链接"
        if (a.closest('main .prose, article')) return;
        const contents = a.closest('div.contents');
        if (!contents) return;
        // 纯广告包装层：内部链接全部站外且数量少（无任何站内内容链接）
        const pureAdBox = (el) => {
          if (!el || el === doc.body) return false;
          const links = Array.from(el.querySelectorAll('a[href]'));
          return links.length >= 1 && links.length <= 8 && links.every(isExternal);
        };
        // 逐单元隐藏：contents 的父层若仍是纯广告层则连同隐藏（如正文内多个广告共用一层）
        const hideUnit = () => {
          if (!cfg.carouselAds) return;
          const box = contents.parentElement;
          if (pureAdBox(box)) { hide(box, 'banner'); return; }
          hide(contents, 'banner');
        };
        // 3a) shadow-card 广告卡 → 整卡隐藏；若整卡是正文容器（文章内嵌广告）→ 逐单元隐藏
        const card = a.closest('div.shadow-card');
        if (card && card.contains(contents)) {
          if (!looksLikeContent(card)) {
            if (cfg.sidebarAds) hide(card, 'sidebar');
          } else {
            hideUnit(); // 文章内嵌广告横幅
          }
          return;
        }
        // 3b) arco 轮播内的幻灯片
        const carouselEl = a.closest('.arco-carousel');
        if (carouselEl) {
          if (cfg.carouselAds) hide(carouselEl.closest('div.rounded-2xl') || carouselEl, 'carousel');
          return;
        }
        // 3c) 弹窗（如搜索框）内横幅 → 只隐藏横幅层，保留弹窗其他功能
        const modal = a.closest('.arco-modal');
        if (modal && modal.contains(contents)) {
          if (cfg.sidebarAds) {
            const box = contents.parentElement;
            if (pureAdBox(box)) hide(box, 'modal-ad');
            else if (pureAdBox(contents)) hide(contents, 'modal-ad');
          }
          return;
        }
        // 3d) 页面横幅区（新版轮播幻灯片）：纯广告包装层才隐藏，避免误伤
        hideUnit();
      });

      // 4) 信息流广告卡片
      if (cfg.feedAds) {
        // 变体一：无"推广"角标，卡片本身就是站外链接
        doc.querySelectorAll('a.shadow-card[href]').forEach((a) => {
          if (a.dataset.vkAdRule || a.closest('[data-vk-ad-rule]') || !isExternal(a)) return;
          hide(a, 'feed');
        });
        // 变体二：带"XX区-推广"角标。只隐藏"整卡是一个链接"的列表卡（a.shadow-card）
        // 或无语义包装层（div.contents）；绝不上爬到 div.shadow-card——
        // 文章详情页的正文容器也是 shadow-card，里面同样有推广角标
        doc.querySelectorAll('a[href], span').forEach((el) => {
          if (el.children.length > 0 || el.dataset.vkAdRule) return;
          if (!/^[^/\n]{0,10}区-推广$/.test((el.textContent || '').trim())) return;
          const listCard = el.closest('a.shadow-card');
          const wrapper = el.closest('div.contents');
          if (listCard) { hide(listCard, 'feed'); return; }
          if (wrapper) { hide(wrapper, 'feed'); return; }
          hide(el, 'feed'); // 兜底只隐藏角标本身
        });
      }

      // 5) 菜单里的粉色广告链接（仅站外链接，站内粉色 UI 不动）
      if (cfg.pinkLinks) {
        doc.querySelectorAll('a[class*="text-pink"][href]').forEach((a) => {
          if (a.dataset.vkAdRule || !isExternal(a)) return;
          // 跳过正文区域：文章正文/评论里的粉色样式链接不是广告
          if (a.closest('main, .prose, article')) return;
          const item = a.parentElement;
          // 仅当父容器只包着这一个链接时连容器一起隐藏，避免误伤菜单
          if (item && item.querySelectorAll('a[href]').length === 1 && (item.textContent || '').trim().length <= 30) {
            hide(item, 'pink');
          } else {
            hide(a, 'pink');
          }
        });
      }

      // 6) 底部"下载App"悬浮横幅（含其占位条）
      if (cfg.bottomBar) {
        doc.querySelectorAll('div[class*="fixed bottom-0 left-0"]').forEach((bar) => {
          if (bar.dataset.vkAdRule || !/h-\[60px\]/.test(bar.className)) return;
          hide(bar, 'bottom');
          const prev = bar.previousElementSibling;
          if (prev && !prev.dataset.vkAdRule && /h-\[60px\]/.test(prev.className)) hide(prev, 'bottom');
        });
      }

      if (sweepTipsFn) sweepTipsFn();
    };

    // 变更监听（广告异步注入 / SPA 换页后再次清除）
    let raf = 0;
    const mo = new MutationObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; sweep(); });
    });
    const start = () => { try { mo.observe(doc.documentElement, { childList: true, subtree: true }); } catch (e) {} };
    doc.addEventListener('DOMContentLoaded', () => { start(); sweep(); });
    try { start(); } catch (e) {}
    win.addEventListener('load', sweep);
    setTimeout(sweep, 3000);
    setInterval(sweep, 5000); // Nuxt 换页不触发整页刷新，低频兜底清扫
  })();

  /* ---------------- 油猴菜单开关 ---------------- */
  (function menu() {
    if (typeof GM_registerMenuCommand !== 'function') {
      win.__vkacgAd = { cfg, saveCfg, applyCss }; // 备用：控制台 __vkacgAd.cfg.externalDirect=false; __vkacgAd.saveCfg(); location.reload()
      return;
    }
    const ITEMS = [
      ['externalDirect', '外链直达（跳过 /external 中转页）'],
      ['adShowOff', '从源头关闭广告（站点 adShow 开关）'],
      ['headerAds', '隐藏顶部广告条'],
      ['carouselAds', '隐藏轮播/横幅广告图'],
      ['sidebarAds', '隐藏侧栏广告卡/弹窗广告横幅'],
      ['feedAds', '隐藏信息流推广卡片'],
      ['pinkLinks', '隐藏菜单广告链接'],
      ['bottomBar', '隐藏底部下载App横幅'],
      ['killDetect', '使广告拦截器检测失效'],
      ['blockAutoAds', '拦截自动弹出的广告页'],
    ];
    let ids = [];
    const registerAll = () => {
      ids.forEach((id) => { try { GM_unregisterMenuCommand(id); } catch (e) {} });
      ids = ITEMS.map(([key, label]) => GM_registerMenuCommand(
        (cfg[key] ? '✅ ' : '❌ ') + label,
        () => {
          cfg[key] = !cfg[key];
          saveCfg();
          applyCss();
          if (key === 'adShowOff' && !cfg.adShowOff) {
            try { const p = win.__NUXT__ && win.__NUXT__.config && win.__NUXT__.config.public; if (p) p.adShow = true; } catch (e) {}
            setTimeout(() => location.reload(), 300); // 恢复广告需要重新加载让站点重新拉取
          }
          registerAll();
        },
      ));
    };
    registerAll();
  })();
})();
