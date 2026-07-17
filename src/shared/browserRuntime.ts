/**
 * Hybrid opening kit for browser-like generated apps.
 *
 * Real websites cannot be embedded reliably in the generated-app iframe: many
 * opt out with X-Frame-Options/frame-ancestors, while CrazyOS intentionally
 * blocks network egress from model-authored documents. This runtime therefore
 * keeps browser mechanics (tabs, history, address bar and shortcuts) local and
 * instant. Searches and destination pages are page-level Crazy hooks, so the
 * assistant can stream genuinely new content instead of showing fixed mocks.
 * Arbitrary HTTP(S) destinations can still be handed to the system browser via
 * the explicit, scheme-checked bridge.
 */

export const BROWSER_RUNTIME_VERSION = 7

export function isBrowserLikeApp(
  app: string | { id?: string; name?: string; tagline?: string }
): boolean {
  const text = typeof app === 'string'
    ? app
    : `${app.id ?? ''}\n${app.name ?? ''}\n${app.tagline ?? ''}`
  const normalized = text.normalize('NFKC').toLowerCase().replace(/[\s_-]+/g, ' ').trim()
  if (!normalized) return false
  return /(?:浏览器|瀏覽器|网页浏览|網頁瀏覽|web browser|internet browser|\bbrowser\b|google chrome|\bchrome\b|microsoft edge|\bedge browser\b|mozilla firefox|\bfirefox\b|\bsafari\b|\bopera browser\b|\barc browser\b|夸克浏览器)/i.test(normalized)
}

/** Return a canonical HTTP(S) URL, or null for unsafe/non-web schemes. */
export function normalizeSafeExternalUrl(candidate: string): string | null {
  const raw = candidate.trim()
  if (!raw || raw.length > 4096) return null
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (!parsed.hostname || parsed.username || parsed.password) return null
    return parsed.href
  } catch {
    return null
  }
}

/**
 * Fingerprints opening kits emitted by older CrazyOS fallbacks. This is kept
 * intentionally narrow because long-term.html otherwise remains fully user
 * authoritative. Callers must additionally verify that the app identity is a
 * browser before replacing anything.
 */
export function isLegacyStaticBrowserKit(html: string): boolean {
  const lower = html.trim().toLowerCase()
  if (!lower) return false
  // v1 was the deterministic, fully local mock browser. It looked complete,
  // but searches/results/navigation never reached Crazy. Keep this fingerprint
  // deliberately exact so a hand-authored browser is never replaced merely
  // because it uses the browser runtime marker.
  const localOnlyRuntimeV1 =
    lower.includes('data-crazy-browser-runtime="1"') &&
    lower.includes('function resulttemplates(query)') &&
    lower.includes('crazy.local') &&
    lower.includes('function renderreader(url)') &&
    !lower.includes('data-crazy-browser-hook-contract="2"')
  const sharedPageRuntimeV2 =
    lower.includes('data-crazy-browser-runtime="1"') &&
    lower.includes('data-crazy-browser-hook-contract="2"') &&
    lower.includes('function requestpage(raw, options)') &&
    lower.includes("targetregion: '#browser-page'") &&
    !lower.includes('data-crazy-browser-hook-contract="3"')
  const perTabRuntimeV3 =
    lower.includes('data-crazy-browser-runtime="1"') &&
    lower.includes('data-crazy-browser-hook-contract="3"') &&
    lower.includes('function ensurepageslots()') &&
    lower.includes('function requestpage(raw, options)') &&
    !lower.includes('data-crazy-browser-hook-contract="4"')
  const perTabRuntimeV4 =
    lower.includes('data-crazy-browser-runtime="1"') &&
    lower.includes('data-crazy-browser-hook-contract="4"') &&
    lower.includes('function ensurepageslots()') &&
    lower.includes('function requestpage(raw, options)') &&
    !lower.includes('data-crazy-browser-hook-contract="5"')
  const presetContentRuntimeV5 =
    lower.includes('data-crazy-browser-runtime="1"') &&
    lower.includes('data-crazy-browser-hook-contract="5"') &&
    lower.includes('function ensurepageslots()') &&
    lower.includes('function requestpage(raw, options)') &&
    !lower.includes('data-crazy-browser-hook-contract="6"')
  const placeholderRuntimeV6 =
    lower.includes('data-crazy-browser-runtime="1"') &&
    lower.includes('data-crazy-browser-hook-contract="6"') &&
    lower.includes('function ensurepageslots()') &&
    lower.includes('function requestpage(raw, options)') &&
    !lower.includes('data-crazy-browser-hook-contract="7"')
  if (lower.includes('data-crazy-browser-runtime=')) return localOnlyRuntimeV1 || sharedPageRuntimeV2 || perTabRuntimeV3 || perTabRuntimeV4 || presetContentRuntimeV5 || placeholderRuntimeV6
  const genericMock =
    lower.includes('data-action="count"') &&
    lower.includes('data-hook="more"') &&
    lower.includes('app.count')
  const hookedSinglePageBrowser =
    lower.includes('id="browser-shell"') &&
    lower.includes('id="browser-content"') &&
    (lower.includes('app.browserask') || lower.includes('action: "browsernavigate"') || lower.includes('action:"browsernavigate"')) &&
    !lower.includes('id="browser-tabs"') &&
    !lower.includes('browsernewtab')
  const misplacedChatKit =
    lower.includes('app.state.chatgpt') &&
    lower.includes('id="chat-shell"') &&
    lower.includes('data-action="sendchat"')
  return genericMock || hookedSinglePageBrowser || misplacedChatKit
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]!)
}

const BROWSER_TEMPLATE = String.raw`<!--plan:[{"id":"browser","label":"搭好浏览器与交互"}]-->
<script data-browser-runtime-script="1">
app.browserRuntime = (function(){
  'use strict';
  var HOME = 'crazy://home';
  var ENGINE = {
    google: { label: 'Google', home: 'https://www.google.com/', key: 'q' },
    baidu: { label: '百度', home: 'https://www.baidu.com/', key: 'wd' },
    bing: { label: 'Bing', home: 'https://www.bing.com/', key: 'q' }
  };
  var root = null;
  var state = freshState();

  function freshState(){
    return {
      tabs: [{ id: 'tab-1', title: '新标签页', history: [HOME], cursor: 0, pending: null, engine: 'google' }],
      activeId: 'tab-1',
      nextTab: 2,
      nextRequest: 1,
      lastReload: 0
    };
  }

  function esc(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
    });
  }

  function attr(value){ return esc(value); }

  function engineInfo(key){ return ENGINE[key] || ENGINE.google; }

  function activeTab(){
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].id === state.activeId) return state.tabs[i];
    }
    state.activeId = state.tabs[0].id;
    return state.tabs[0];
  }

  function currentUrl(tab){
    tab = tab || activeTab();
    return tab.history[tab.cursor] || HOME;
  }

  function rollbackPending(tab){
    if (!tab || !tab.pending || !Array.isArray(tab.pending.previousHistory) || !tab.pending.previousHistory.length) return;
    tab.history = tab.pending.previousHistory.slice();
    tab.cursor = Math.max(0, Math.min(Number(tab.pending.previousCursor) || 0, tab.history.length - 1));
    tab.title = typeof tab.pending.previousTitle === 'string' && tab.pending.previousTitle
      ? tab.pending.previousTitle
      : titleFor(currentUrl(tab));
    tab.pending = null;
  }

  function validState(candidate){
    if (!candidate || !Array.isArray(candidate.tabs) || !candidate.tabs.length) return false;
    for (var i = 0; i < candidate.tabs.length; i++) {
      var tab = candidate.tabs[i];
      if (!tab || typeof tab.id !== 'string' || !Array.isArray(tab.history) || !tab.history.length) return false;
      if (typeof tab.cursor !== 'number' || tab.cursor < 0 || tab.cursor >= tab.history.length) return false;
    }
    return typeof candidate.activeId === 'string';
  }

  function tabFromSlot(slot){
    var id = slot && slot.getAttribute('data-browser-tab-id');
    if (!id) return null;
    var pageUrl = slot.getAttribute('data-browser-page-url') || HOME;
    var requestUrl = slot.getAttribute('data-browser-request-url') || '';
    var requestId = slot.getAttribute('data-browser-request-id') || '';
    var history = [pageUrl];
    var cursor = 0;
    var pending = null;
    if (requestId && requestUrl) {
      if (requestUrl !== pageUrl) { history.push(requestUrl); cursor = 1; }
      else history = [requestUrl];
      pending = {
        url: requestUrl,
        kind: 'recovered',
        requestId: requestId,
        previousHistory: [pageUrl],
        previousCursor: 0,
        previousTitle: titleFor(pageUrl)
      };
    }
    return { id: id, title: titleFor(history[cursor]), history: history, cursor: cursor, pending: pending, engine: 'google' };
  }

  function recoverStateFromDom(){
    var pages = document.getElementById('browser-pages');
    if (!pages) return false;
    var slots = pages.querySelectorAll(':scope > .browser-page-slot[data-browser-tab-id]');
    if (!slots.length) return false;
    var tabs = [];
    var activeId = '';
    var maxTab = 0;
    var maxRequest = 0;
    for (var i = 0; i < slots.length; i++) {
      var tab = tabFromSlot(slots[i]);
      if (!tab) continue;
      tabs.push(tab);
      if (slots[i].classList.contains('active') || slots[i].getAttribute('aria-hidden') === 'false') activeId = tab.id;
      var tabNumber = Number((tab.id.match(/(\d+)$/) || [])[1]) || 0;
      var requestNumber = Number(((slots[i].getAttribute('data-browser-request-id') || '').match(/(\d+)$/) || [])[1]) || 0;
      maxTab = Math.max(maxTab, tabNumber);
      maxRequest = Math.max(maxRequest, requestNumber);
    }
    if (!tabs.length) return false;
    state = { tabs: tabs, activeId: activeId || tabs[0].id, nextTab: maxTab + 1, nextRequest: maxRequest + 1, lastReload: 0 };
    return true;
  }

  function mergeDomSlots(){
    var pages = document.getElementById('browser-pages');
    if (!pages) return;
    var slots = pages.querySelectorAll(':scope > .browser-page-slot[data-browser-tab-id]');
    var known = {};
    var activeId = '';
    var maxTab = Number(state.nextTab) - 1 || 0;
    var maxRequest = Number(state.nextRequest) - 1 || 0;
    for (var i = 0; i < state.tabs.length; i++) known[state.tabs[i].id] = state.tabs[i];
    for (var j = 0; j < slots.length; j++) {
      var slot = slots[j];
      var id = slot.getAttribute('data-browser-tab-id');
      if (!id) continue;
      if (!known[id]) {
        var recovered = tabFromSlot(slot);
        if (recovered) { state.tabs.push(recovered); known[id] = recovered; }
      }
      var tab = known[id];
      if (tab) {
        var requestId = slot.getAttribute('data-browser-request-id') || '';
        var requestUrl = slot.getAttribute('data-browser-request-url') || '';
        var pageUrl = slot.getAttribute('data-browser-page-url') || '';
        if (requestId && requestUrl && (!tab.pending || tab.pending.requestId !== requestId)) {
          var previousHistory = Array.isArray(tab.history) && tab.history.length ? tab.history.slice() : [pageUrl || HOME];
          var previousCursor = typeof tab.cursor === 'number' ? tab.cursor : Math.max(0, previousHistory.length - 1);
          if (currentUrl(tab) !== requestUrl) {
            tab.history = previousHistory.slice(0, previousCursor + 1);
            tab.history.push(requestUrl);
            tab.cursor = tab.history.length - 1;
          }
          tab.pending = { url: requestUrl, kind: 'recovered', requestId: requestId, previousHistory: previousHistory, previousCursor: previousCursor, previousTitle: tab.title };
        } else if (!requestId && pageUrl && pageUrl !== HOME && currentUrl(tab) === HOME) {
          tab.history = [pageUrl];
          tab.cursor = 0;
          tab.pending = null;
          tab.title = titleFor(pageUrl);
        }
      }
      if (slot.classList.contains('active') || slot.getAttribute('aria-hidden') === 'false') activeId = id;
      maxTab = Math.max(maxTab, Number((id.match(/(\d+)$/) || [])[1]) || 0);
      maxRequest = Math.max(maxRequest, Number((requestId.match(/(\d+)$/) || [])[1]) || 0);
    }
    if (activeId && known[activeId]) state.activeId = activeId;
    if (!known[state.activeId]) state.activeId = state.tabs[0].id;
    state.nextTab = Math.max(Number(state.nextTab) || 1, maxTab + 1);
    state.nextRequest = Math.max(Number(state.nextRequest) || 1, maxRequest + 1);
  }

  function restore(){
    var raw = root && root.getAttribute('data-browser-state');
    if (!raw) { recoverStateFromDom(); return; }
    try {
      var parsed = JSON.parse(raw);
      if (validState(parsed)) {
        state = parsed;
        var legacyEngine = ENGINE[state.engine] ? state.engine : 'google';
        for (var tabIndex = 0; tabIndex < state.tabs.length; tabIndex++) {
          state.tabs[tabIndex].engine = ENGINE[state.tabs[tabIndex].engine] ? state.tabs[tabIndex].engine : legacyEngine;
        }
        delete state.engine;
        state.nextTab = Number(state.nextTab) || state.tabs.length + 1;
        state.nextRequest = Number(state.nextRequest) || 1;
        state.lastReload = Number(state.lastReload) || 0;
        mergeDomSlots();
        return;
      }
    } catch (ignore) {}
    recoverStateFromDom();
  }

  function persist(){
    if (root) root.setAttribute('data-browser-state', JSON.stringify(state));
  }

  function parseWebUrl(value){
    try {
      var parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      if (!parsed.hostname || parsed.username || parsed.password) return null;
      return parsed;
    } catch (ignore) { return null; }
  }

  function engineFromUrl(parsed){
    var host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'google.com' || host.slice(-11) === '.google.com' || /^google\.[a-z.]+$/.test(host)) return 'google';
    if (host === 'baidu.com' || host.slice(-10) === '.baidu.com') return 'baidu';
    if (host === 'bing.com' || host.slice(-9) === '.bing.com') return 'bing';
    return null;
  }

  function searchUrl(engine, query, tab){
    var info = engineInfo(engine);
    var pageUrl = tab ? currentUrl(tab) : '';
    if (engine === 'google' && /(?:images\.google\.|[?&]tbm=isch(?:&|$))/i.test(pageUrl)) {
      return info.home + 'search?q=' + encodeURIComponent(query) + '&tbm=isch';
    }
    if (engine === 'baidu' && /image\.baidu\./i.test(pageUrl)) {
      return 'https://image.baidu.com/search/index?tn=baiduimage&word=' + encodeURIComponent(query);
    }
    if (engine === 'bing' && /\/images(?:\/|\?|$)/i.test(pageUrl)) {
      return 'https://www.bing.com/images/search?q=' + encodeURIComponent(query);
    }
    if (engine === 'baidu') return info.home + 's?wd=' + encodeURIComponent(query);
    return info.home + 'search?q=' + encodeURIComponent(query);
  }

  function normalizeAddress(raw, tab){
    tab = tab || activeTab();
    var value = String(raw || '').trim();
    if (!value) return HOME;
    if (/^crazy:\/\/(?:home|reader)(?:[/?#]|$)/i.test(value)) return value;
    var direct = parseWebUrl(value);
    if (direct) return direct.href;
    if (/^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#]|$)/i.test(value) || /^[\w-]+(?:\.[\w-]+)+(?:[/:?#]|$)/i.test(value)) {
      direct = parseWebUrl('https://' + value);
      if (direct) return direct.href;
    }
    return searchUrl(tab.engine, value, tab);
  }

  function titleFor(url){
    if (url === HOME) return '新标签页';
    if (/^crazy:\/\/reader/i.test(url)) {
      try { return new URL(url).searchParams.get('title') || '阅读页面'; } catch (ignore) { return '阅读页面'; }
    }
    var parsed = parseWebUrl(url);
    if (!parsed) return '页面';
    var engine = engineFromUrl(parsed);
    if (engine) {
      var query = parsed.searchParams.get(engineInfo(engine).key);
      return query ? query + ' - ' + engineInfo(engine).label : engineInfo(engine).label;
    }
    return parsed.hostname;
  }

  function renderTabs(){
    var box = document.getElementById('browser-tabs');
    if (!box) return;
    var html = '';
    for (var i = 0; i < state.tabs.length; i++) {
      var tab = state.tabs[i];
      var active = tab.id === state.activeId;
      html += '<div class="browser-tab-wrap' + (active ? ' active' : '') + '" data-crazyos-key="' + attr(tab.id) + '">' +
        '<button class="browser-tab" role="tab" aria-selected="' + active + '" data-active="' + active + '" data-action="browserSwitchTab" data-tab-id="' + attr(tab.id) + '">' +
          '<span class="browser-favicon">' + (currentUrl(tab) === HOME ? '✦' : '◉') + '</span>' +
          '<span class="browser-tab-label">' + esc(tab.title) + '</span>' +
        '</button>' +
        '<button class="browser-tab-close" aria-label="关闭 ' + attr(tab.title) + '" title="关闭标签页" data-action="browserCloseTab" data-tab-id="' + attr(tab.id) + '">×</button>' +
      '</div>';
    }
    box.innerHTML = html;
  }

  function renderHome(tab){
    tab = tab || activeTab();
    return '<section class="browser-home" data-page-title="新标签页">' +
      '<div class="browser-doodle">✦</div>' +
      '<h1>新标签页</h1>' +
      '<p class="muted">在上方地址栏输入网址或搜索内容。</p>' +
      '<div class="browser-tip">⌘ / Ctrl + L 聚焦地址栏 · Ctrl + T 新标签页 · Alt + ← / → 前进后退</div>' +
    '</section>';
  }

  function slotId(tabId){
    return 'browser-page-' + String(tabId || '').replace(/[^a-zA-Z0-9_-]/g, '-');
  }

  function slotSelector(tabId){ return '#' + slotId(tabId); }

  function pageSlot(tabId){ return document.getElementById(slotId(tabId)); }

  function ensurePageSlots(){
    var pages = document.getElementById('browser-pages');
    if (!pages) return;
    var keep = {};
    for (var i = 0; i < state.tabs.length; i++) {
      var tab = state.tabs[i];
      keep[tab.id] = true;
      var slot = pageSlot(tab.id);
      if (!slot) {
        slot = document.createElement('section');
        slot.id = slotId(tab.id);
        slot.className = 'browser-page-slot';
        slot.setAttribute('data-browser-tab-id', tab.id);
        slot.setAttribute('aria-live', 'polite');
        if (currentUrl(tab) === HOME) slot.innerHTML = renderHome(tab);
        else slot.replaceChildren();
        pages.appendChild(slot);
      }
      var active = tab.id === state.activeId;
      slot.hidden = !active;
      slot.classList.toggle('active', active);
      slot.setAttribute('aria-hidden', active ? 'false' : 'true');
    }
    var slots = pages.querySelectorAll('.browser-page-slot[data-browser-tab-id]');
    for (var j = 0; j < slots.length; j++) {
      var savedId = slots[j].getAttribute('data-browser-tab-id');
      if (!keep[savedId]) slots[j].remove();
    }
  }

  function render(){
    if (!root) return;
    var tab = activeTab();
    var url = currentUrl(tab);
    ensurePageSlots();
    var slot = pageSlot(tab.id);
    if (slot && url === HOME) {
      slot.innerHTML = renderHome(tab);
      slot.setAttribute('data-browser-page-url', HOME);
      slot.removeAttribute('data-browser-request-id');
    }
    renderChromeOnly();
  }

  function navigate(raw, replace){
    var tab = activeTab();
    var target = normalizeAddress(raw, tab);
    if (replace) tab.history[tab.cursor] = target;
    else if (target !== currentUrl(tab)) {
      tab.history = tab.history.slice(0, tab.cursor + 1);
      tab.history.push(target);
      tab.cursor = tab.history.length - 1;
    }
    state.lastReload = 0;
    render();
  }

  // Browser chrome is deterministic and instant. Destination content is never
  // fabricated here: page-level navigation asks Crazy to stream the next
  // surface into #browser-page while the current page stays visible.
  function renderChromeOnly(){
    if (!root) return;
    var tab = activeTab();
    var url = currentUrl(tab);
    tab.title = titleFor(url);
    ensurePageSlots();
    persist();
    renderTabs();
    var address = document.getElementById('browser-address');
    if (address) address.value = url === HOME ? '' : url;
    var backButton = document.getElementById('browser-back');
    var forwardButton = document.getElementById('browser-forward');
    if (backButton) backButton.disabled = tab.cursor <= 0;
    if (forwardButton) forwardButton.disabled = tab.cursor >= tab.history.length - 1;
    var pending = document.getElementById('browser-page-pending');
    if (pending) {
      pending.hidden = !tab.pending;
      pending.textContent = tab.pending ? 'Crazy 正在生成这个页面…' : '';
    }
    var page = pageSlot(tab.id);
    if (page) page.setAttribute('aria-busy', tab.pending ? 'true' : 'false');
    var status = document.getElementById('browser-status');
    if (status) status.textContent = tab.pending ? '正在生成页面…' : '';
  }

  function pageInstructions(kind, target, selector, tabId, requestId){
    var namespace = String(tabId || '').replace(/[^a-zA-Z0-9_]/g, '_');
    return '只生成标签 ' + tabId + ' 的页面内容（' + kind + '，requestId=' + requestId + '），目标是 ' + target + '，写入 ' + selector + '。输出纯声明式 HTML，不要 script/style、浏览器壳层或其他标签页。所有 id 以 page-' + namespace + '- 开头。搜索表单使用 input[type=search].browser-engine-search-input（name=q/query/wd）和 data-action="browserSearchPage"；结果使用 data-action="browserOpenResult" + data-url。';
  }

  function requestPage(raw, options){
    options = options || {};
    var tab = activeTab();
    if (options.tabId) {
      for (var tabIndex = 0; tabIndex < state.tabs.length; tabIndex++) {
        if (state.tabs[tabIndex].id === options.tabId) tab = state.tabs[tabIndex];
      }
    }
    rollbackPending(tab);
    var previousHistory = options.previousHistory ? options.previousHistory.slice() : tab.history.slice();
    var previousCursor = typeof options.previousCursor === 'number' ? options.previousCursor : tab.cursor;
    var target = normalizeAddress(raw, tab);
    if (options.replace) tab.history[tab.cursor] = target;
    else if (target !== currentUrl(tab)) {
      tab.history = tab.history.slice(0, tab.cursor + 1);
      tab.history.push(target);
      tab.cursor = tab.history.length - 1;
    }
    state.lastReload = 0;
    var requestId = 'page-' + tab.id + '-' + state.nextRequest++;
    var selector = slotSelector(tab.id);
    tab.pending = { url: target, kind: options.kind || 'navigate', requestId: requestId, previousHistory: previousHistory, previousCursor: previousCursor, previousTitle: tab.title };
    renderChromeOnly();
    var page = pageSlot(tab.id);
    if (page) {
      page.setAttribute('data-browser-request-url', target);
      page.setAttribute('data-browser-request-id', requestId);
      page.setAttribute('aria-busy', 'true');
    }
    window.crazyos.ask({
      action: options.action || 'browser_navigate_page',
      kind: 'navigate',
      target: selector,
      placement: 'replace',
      role: options.query ? '浏览器搜索结果页；结果必须可点击并继续调用 app.browserOpenResult' : '浏览器目标页面；保留浏览器壳层并生成可继续交互的页面内容',
      detail: {
        hookType: 'browser.page',
        navigationKind: options.kind || 'navigate',
        source: options.source || 'browser',
        targetRegion: selector,
        tabId: tab.id,
        requestId: requestId,
        url: target,
        engine: options.engine || tab.engine,
        query: options.query || '',
        title: options.title || titleFor(target),
        instructions: pageInstructions(options.kind || 'navigate', target, selector, tab.id, requestId)
      }
    });
    return requestId;
  }

  function hydrate(){
    // Streaming can finish after the user has switched tabs. Pending is only
    // cleared by browserPageReady for the matching tab/request pair.
    renderChromeOnly();
    var tab = activeTab();
    var page = pageSlot(tab.id);
    if (currentUrl(tab) === HOME && page && (page.hasAttribute('data-browser-placeholder') || !page.children.length)) {
      page.removeAttribute('data-browser-placeholder');
      page.innerHTML = renderHome(tab);
      page.setAttribute('data-browser-page-url', HOME);
      renderChromeOnly();
    }
  }

  function pageReady(payload){
    payload = payload || {};
    var tab = null;
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].id === payload.tabId) tab = state.tabs[i];
    }
    if (!tab || !tab.pending || !payload.requestId) return false;
    if (tab.pending.requestId !== payload.requestId) return false;
    var page = pageSlot(tab.id);
    if (page) {
      page.removeAttribute('data-browser-request-url');
      page.removeAttribute('data-browser-request-id');
      page.removeAttribute('data-browser-placeholder');
      page.setAttribute('data-browser-page-url', currentUrl(tab));
      page.setAttribute('aria-busy', 'false');
    }
    tab.pending = null;
    renderChromeOnly();
    return true;
  }

  function pageFailed(payload){
    payload = payload || {};
    var tab = null;
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].id === payload.tabId) tab = state.tabs[i];
    }
    if (!tab || !tab.pending || !payload.requestId) return false;
    if (tab.pending.requestId !== payload.requestId) return false;
    rollbackPending(tab);
    var page = pageSlot(tab.id);
    if (page) {
      page.removeAttribute('data-browser-request-url');
      page.removeAttribute('data-browser-request-id');
      page.setAttribute('aria-busy', 'false');
      if (payload.message) page.setAttribute('data-browser-last-error', String(payload.message).slice(0, 160));
    }
    tab.pending = null;
    renderChromeOnly();
    if (window.__czToast) window.__czToast(payload.message || '页面生成失败，已保留原页面');
    return true;
  }

  function addressValue(payload){
    if (payload && payload.value) return payload.value;
    var input = document.getElementById('browser-address');
    return input ? input.value : '';
  }

  function init(){
    root = document.getElementById('crazy-browser');
    if (!root) return;
    restore();
    hydrate();
    if (!window.__crazyBrowserKeyHandler) {
      window.__crazyBrowserKeyHandler = true;
      document.addEventListener('keydown', function(event){
        var mod = event.ctrlKey || event.metaKey;
        if (mod && event.key.toLowerCase() === 'l') {
          event.preventDefault();
          var address = document.getElementById('browser-address');
          if (address) { address.focus(); address.select(); }
        } else if (mod && event.key.toLowerCase() === 't') {
          event.preventDefault(); newTab();
        } else if (mod && event.key.toLowerCase() === 'w') {
          event.preventDefault(); closeTab({ tabId: state.activeId });
        } else if (mod && event.key.toLowerCase() === 'r') {
          event.preventDefault(); reload();
        } else if (event.altKey && event.key === 'ArrowLeft') {
          event.preventDefault(); back();
        } else if (event.altKey && event.key === 'ArrowRight') {
          event.preventDefault(); forward();
        }
      });
    }
  }

  function newTab(){
    var id = 'tab-' + state.nextTab++;
    state.tabs.push({ id: id, title: '新标签页', history: [HOME], cursor: 0, pending: null, engine: 'google' });
    state.activeId = id;
    state.lastReload = 0;
    render();
    var address = document.getElementById('browser-address');
    if (address) address.focus();
  }

  function tabIdFrom(payload){
    return payload && (payload.tabId || payload['tab-id']);
  }

  function switchTab(payload){
    var requested = tabIdFrom(payload);
    if (!requested) return;
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].id === requested) {
        state.activeId = requested;
        state.lastReload = 0;
        ensurePageSlots();
        renderChromeOnly();
        return;
      }
    }
  }

  function closeTab(payload){
    var id = tabIdFrom(payload) || state.activeId;
    var index = -1;
    for (var i = 0; i < state.tabs.length; i++) if (state.tabs[i].id === id) index = i;
    if (index < 0) return;
    if (state.tabs.length === 1) {
      state.tabs[0] = { id: state.tabs[0].id, title: '新标签页', history: [HOME], cursor: 0, pending: null, engine: 'google' };
      state.activeId = state.tabs[0].id;
    } else {
      state.tabs.splice(index, 1);
      if (state.activeId === id) state.activeId = state.tabs[Math.min(index, state.tabs.length - 1)].id;
    }
    state.lastReload = 0;
    if (currentUrl() === HOME) render();
    else { ensurePageSlots(); renderChromeOnly(); }
  }

  function restoreHistory(direction){
    var tab = activeTab();
    rollbackPending(tab);
    var previousHistory = tab.history.slice();
    var previousCursor = tab.cursor;
    if (direction === 'back' && tab.cursor > 0) tab.cursor--;
    else if (direction === 'forward' && tab.cursor < tab.history.length - 1) tab.cursor++;
    else return;
    state.lastReload = 0;
    if (currentUrl() === HOME) { activeTab().pending = null; render(); }
    else {
      requestPage(currentUrl(), { replace: true, kind: 'history_' + direction, action: 'browser_history_navigate', source: direction, previousHistory: previousHistory, previousCursor: previousCursor });
    }
  }
  function back(){ restoreHistory('back'); }
  function forward(){ restoreHistory('forward'); }
  function reload(){
    state.lastReload = Date.now();
    if (currentUrl() === HOME) render();
    else {
      var tab = activeTab();
      requestPage(currentUrl(), { replace: true, kind: 'reload', action: 'browser_reload_page', source: 'reload' });
    }
  }
  function home(){ var tab = activeTab(); rollbackPending(tab); tab.pending = null; navigate(HOME); render(); }

  function go(payload){
    var raw = addressValue(payload);
    var tab = activeTab();
    var target = normalizeAddress(raw, tab);
    if (target === HOME) { home(); return; }
    var parsed = parseWebUrl(target);
    var engine = parsed && engineFromUrl(parsed);
    var query = engine ? (parsed.searchParams.get(engineInfo(engine).key) || '') : '';
    if (engine) tab.engine = engine;
    requestPage(target, {
      kind: query ? 'address_search' : 'address_navigation',
      action: query ? 'browser_search_page' : 'browser_navigate_page',
      source: 'address_bar',
      engine: engine || tab.engine,
      query: query
    });
  }

  function tabIdFromElement(el){
    var slot = el && el.closest ? el.closest('.browser-page-slot[data-browser-tab-id]') : null;
    return slot ? slot.getAttribute('data-browser-tab-id') : activeTab().id;
  }

  function searchPage(payload, event, el){
    payload = payload || {};
    var tabId = tabIdFromElement(el);
    var tab = activeTab();
    for (var tabIndex = 0; tabIndex < state.tabs.length; tabIndex++) if (state.tabs[tabIndex].id === tabId) tab = state.tabs[tabIndex];
    var slot = pageSlot(tabId);
    var form = el && (el.form || (el.closest && el.closest('form')));
    var searchBox = form || (el && el.closest && el.closest('[role="search"], .engine-search-row, .browser-search-form, .browser-serp-head')) || slot;
    var requestedInput = payload['search-input'] || payload.searchInput || '';
    var input = requestedInput && slot ? slot.querySelector(String(requestedInput)) : null;
    if (!input) input = searchBox ? searchBox.querySelector('.browser-engine-search-input, #engine-search-input, input[type="search"], input[name="q"], input[name="query"], input[name="wd"], input[name="search"], input[name="keyword"], input[type="text"]') : null;
    if (!input && slot) input = slot.querySelector('.browser-engine-search-input, #engine-search-input, input[type="search"], input[name="q"], input[name="query"], input[name="wd"]');
    var supplied = payload.value || payload.q || payload.query || payload.wd || payload.search || payload.keyword || '';
    var query = supplied ? String(supplied).trim() : (input ? input.value.trim() : '');
    var engine = payload.engine && ENGINE[payload.engine] ? payload.engine : tab.engine;
    if (!query) { if (input) input.focus(); return; }
    tab.engine = engine;
    requestPage(searchUrl(engine, query, tab), { kind: 'search', action: 'browser_search_page', source: 'search_box', engine: engine, query: query, tabId: tabId });
  }

  function openEngine(payload, event, el){
    var engine = payload && ENGINE[payload.engine] ? payload.engine : 'google';
    var tabId = tabIdFromElement(el);
    for (var i = 0; i < state.tabs.length; i++) if (state.tabs[i].id === tabId) state.tabs[i].engine = engine;
    requestPage(ENGINE[engine].home, { kind: 'engine_home', action: 'browser_navigate_page', source: 'engine_entry', engine: engine, tabId: tabId, title: ENGINE[engine].label });
  }

  function openResult(payload, event, el){
    if (!payload || !payload.url) return;
    var tabId = tabIdFromElement(el);
    var tab = activeTab();
    for (var tabIndex = 0; tabIndex < state.tabs.length; tabIndex++) if (state.tabs[tabIndex].id === tabId) tab = state.tabs[tabIndex];
    requestPage(payload.url, {
      kind: 'search_result',
      action: 'browser_open_result',
      source: 'search_result',
      engine: payload.engine || tab.engine,
      query: payload.query || '',
      title: payload.title || '',
      tabId: tabId
    });
  }

  function external(payload){
    var url = payload && payload.url ? payload.url : currentUrl();
    var parsed = parseWebUrl(url);
    if (!parsed) { if (window.__czToast) window.__czToast('只允许打开 HTTP(S) 地址'); return; }
    window.crazyos.openExternal(parsed.href);
    if (window.__czToast) window.__czToast('已交给系统浏览器');
  }

  return {
    init: init,
    go: go,
    newTab: newTab,
    switchTab: switchTab,
    closeTab: closeTab,
    back: back,
    forward: forward,
    reload: reload,
    home: home,
    searchPage: searchPage,
    openEngine: openEngine,
    openResult: openResult,
    pageReady: pageReady,
    pageFailed: pageFailed,
    external: external,
    snapshot: function(){ return JSON.parse(JSON.stringify(state)); }
  };
})();

app.browserGo = function(payload){ app.browserRuntime.go(payload); };
app.browserNewTab = function(){ app.browserRuntime.newTab(); };
app.browserSwitchTab = function(payload){ app.browserRuntime.switchTab(payload); };
app.browserCloseTab = function(payload){ app.browserRuntime.closeTab(payload); };
app.browserBack = function(){ app.browserRuntime.back(); };
app.browserForward = function(){ app.browserRuntime.forward(); };
app.browserReload = function(){ app.browserRuntime.reload(); };
app.browserHome = function(){ app.browserRuntime.home(); };
app.browserSearchPage = function(payload, event, el){ app.browserRuntime.searchPage(payload, event, el); };
app.browserOpenEngine = function(payload, event, el){ app.browserRuntime.openEngine(payload, event, el); };
app.browserOpenResult = function(payload, event, el){ app.browserRuntime.openResult(payload, event, el); };
app.browserPageReady = function(payload){ return app.browserRuntime.pageReady(payload); };
app.browserPageFailed = function(payload){ return app.browserRuntime.pageFailed(payload); };
app.browserExternal = function(payload){ app.browserRuntime.external(payload); };
app.init_browser = function(){ app.browserRuntime.init(); };
</script>

<style data-browser-runtime-style="1">
  #crazy-browser{height:calc(100vh - 28px);min-height:430px;padding:0;overflow:hidden;display:flex;flex-direction:column;background:var(--paper);position:relative}
  .browser-top{background:color-mix(in srgb,var(--card) 90%,var(--accent));border-bottom:2px solid var(--ink);flex:0 0 auto}
  .browser-tab-strip{display:flex;align-items:flex-end;gap:4px;padding:6px 8px 0;min-height:38px}
  #browser-tabs{display:flex;gap:5px;align-items:flex-end;min-width:0;overflow:hidden;flex:1}
  .browser-tab-wrap{display:flex;align-items:center;min-width:105px;max-width:220px;border:1.5px solid transparent;border-bottom:0;border-radius:13px 13px 0 0;background:color-mix(in srgb,var(--soft) 10%,var(--card));overflow:hidden}
  .browser-tab-wrap.active{border-color:var(--ink);background:var(--card);position:relative;bottom:-2px}
  .browser-tab{font:inherit;color:var(--ink);border:0;background:transparent;display:flex;align-items:center;gap:6px;min-width:0;flex:1;padding:5px 4px 7px 10px;cursor:pointer;text-align:left}
  .browser-tab-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.88em}
  .browser-favicon{font-size:.78em;color:var(--accent)}
  .browser-tab-close,.browser-new-tab{font:inherit;color:var(--ink);background:transparent;border:0;cursor:pointer;border-radius:50%;line-height:1;padding:4px 7px}
  .browser-tab-close:hover,.browser-new-tab:hover{background:color-mix(in srgb,var(--accent) 20%,transparent)}
  .browser-new-tab{font-size:1.25em;margin:0 4px 5px}
  .browser-toolbar{display:grid;grid-template-columns:auto minmax(150px,1fr) auto;gap:7px;align-items:center;padding:6px 10px 8px;background:var(--card)}
  .browser-nav{display:flex;gap:4px}
  .browser-icon-btn{font:inherit;width:34px;height:34px;padding:0;display:grid;place-items:center;border:2px solid transparent;border-radius:50%;background:transparent;color:var(--ink);cursor:pointer}
  .browser-icon-btn:hover:not(:disabled){border-color:var(--ink);background:color-mix(in srgb,var(--accent) 14%,var(--card))}
  .browser-icon-btn:disabled{opacity:.3;cursor:default}
  .browser-address-wrap{position:relative;display:flex;align-items:center}
  .browser-lock{position:absolute;left:12px;font-size:.72em;color:var(--accent);pointer-events:none}
  #browser-address{width:100%;height:36px;padding-left:32px;padding-right:42px;border-width:1.5px;border-radius:999px;background:color-mix(in srgb,var(--accent) 6%,var(--paper))}
  .browser-go{position:absolute;right:4px;border:0;background:transparent;color:var(--accent);font:inherit;font-weight:700;cursor:pointer;padding:4px 8px}
  #browser-status{font-size:.72em;color:var(--soft);white-space:nowrap;max-width:118px;overflow:hidden;text-overflow:ellipsis}#browser-status:empty{display:none}
  #browser-pages{position:relative;flex:1;min-height:0;overflow:hidden;background:var(--paper)}
  #browser-page-pending{position:absolute;z-index:20;top:8px;left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100% - 24px);padding:6px 14px;border:1px dashed var(--ink);border-radius:999px;background:color-mix(in srgb,var(--accent) 14%,var(--card));box-shadow:0 3px 12px color-mix(in srgb,var(--ink) 12%,transparent);font-size:.78em;color:var(--ink);pointer-events:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #browser-page-pending:not([hidden]){display:block;animation:browser-pulse 1.2s ease-in-out infinite alternate}
  @keyframes browser-pulse{from{opacity:.58}to{opacity:1}}
  .browser-page-slot{height:100%;min-height:0;overflow:auto;overscroll-behavior:contain;background:var(--paper);padding:clamp(14px,2.5vw,30px);container-type:inline-size}
  .browser-page-slot[hidden]{display:none!important}
  .browser-page-slot,.browser-page-slot *{box-sizing:border-box}
  .browser-page-slot>*,.browser-generated-page{width:min(100%,1080px);max-width:100%;margin-inline:auto;overflow-wrap:anywhere}
  .browser-generated-page *{min-width:0}
  .browser-generated-page :where(div,section,article,header,footer,main,form,nav,aside){max-width:100%}
  .browser-page-slot :is(button,.btn,[role="button"]):not(.browser-result):not(.browser-text-link){font:inherit;line-height:1.25;min-height:36px;max-width:100%;padding:.5rem .8rem;border:2px solid var(--ink);border-radius:12px;background:var(--card);color:var(--ink);white-space:normal;overflow-wrap:anywhere;cursor:pointer}
  .browser-page-slot :is(button,.btn,[role="button"]):not(.browser-result):not(.browser-text-link):hover{background:color-mix(in srgb,var(--accent) 12%,var(--card));transform:translateY(-1px)}
  .browser-page-slot :is(input,textarea,select){font:inherit;width:100%;min-width:0;max-width:100%;padding:.55rem .75rem;border:2px solid var(--ink);border-radius:11px;background:var(--paper);color:var(--ink)}
  .browser-page-slot textarea{min-height:6rem;resize:vertical}
  .browser-page-slot :is(img,video,canvas,svg,iframe){max-width:100%;height:auto}
  .browser-page-slot :is(pre,code,.mono){max-width:100%;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
  .browser-page-slot table{display:block;width:100%;max-width:100%;overflow:auto;border-collapse:collapse}
  .browser-page-slot :is(.row,.toolbar,.actions,.button-group,.browser-page-actions){display:flex;flex-wrap:wrap;align-items:center;gap:.65rem;max-width:100%}
  .browser-page-slot :is(.grid,[class*="-grid"],.browser-page-grid){display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:clamp(.7rem,2vw,1.25rem);max-width:100%}
  .browser-page-slot :is(.card,[class*="-card"],.browser-page-card):not(.browser-result){min-width:0;max-width:100%;padding:clamp(.8rem,2vw,1.25rem);border:1.5px solid color-mix(in srgb,var(--ink) 74%,transparent);border-radius:16px;background:var(--card);overflow:hidden}
  .browser-page-slot :is(ul,ol,.list,.browser-page-list){max-width:100%;padding-inline-start:clamp(1.1rem,4vw,2rem)}
  .browser-page-slot :is(li,.list-item,.browser-page-list-item){max-width:100%;overflow-wrap:anywhere}
  .browser-page-empty{display:grid;min-height:180px;place-items:center;text-align:center}
  .browser-home,.external-preview{max-width:920px;margin:0 auto;text-align:center;padding-top:clamp(8px,5vh,52px)}
  .browser-home h1,.external-preview h1{font-size:clamp(1.7em,4vw,2.6em);margin:.15em 0}
  .browser-doodle,.external-icon{font-size:3em;color:var(--accent);line-height:1}
  .engine-search,.browser-search-form{max-width:680px;margin:24px auto;display:flex;flex-direction:column;gap:13px;align-items:center}
  .engine-search.compact,.browser-serp-head .browser-search-form{max-width:none;margin:0 0 10px;align-items:stretch}
  .engine-mark{font-weight:800;font-size:clamp(1.9em,5vw,3.2em);letter-spacing:-.04em}
  .engine-search.compact .engine-mark{font-size:1.45em}
  .engine-google{color:#4285f4}.engine-baidu{color:#315efb}.engine-bing{color:#0f766e}
  .engine-search-row{display:flex;gap:8px;width:100%}.engine-input{flex:1;min-width:0;padding:10px 16px;border-radius:999px!important}
  .browser-primary{background:color-mix(in srgb,var(--accent) 18%,var(--card));font-weight:700}
  .browser-tip{margin-top:32px;font-size:.78em;color:var(--soft)}
  .browser-note,.reader-callout{border:2px dashed var(--ink);border-radius:18px;padding:14px 18px;background:color-mix(in srgb,var(--accent) 7%,var(--card));text-align:left;margin:26px auto;max-width:680px}
  .browser-generated-page{min-height:100%;color:var(--ink)}
  .browser-text-link{border:0;background:transparent;color:var(--ink);font:inherit;padding:4px;cursor:pointer}.browser-text-link:hover{color:var(--accent);text-decoration:underline}
  .browser-search-page{width:min(100%,1120px)!important;margin:0 auto;text-align:left}.browser-serp-head{max-width:780px}.browser-serp-head :is(.engine-search,.browser-search-form){display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px}.browser-serp-head .engine-mark{font-size:1.35em;white-space:nowrap}.browser-serp-head .engine-search-row{min-width:0}.browser-serp-tabs{display:flex;gap:20px;overflow:auto;border-bottom:1px solid color-mix(in srgb,var(--ink) 18%,transparent);padding:0 4px;color:var(--soft);font-size:.82em}.browser-serp-tabs span{padding:7px 0;white-space:nowrap}.browser-serp-tabs .active{color:var(--accent);border-bottom:2px solid var(--accent)}
  .browser-serp-main{display:grid;grid-template-columns:minmax(0,720px) minmax(220px,300px);gap:clamp(28px,5vw,64px);align-items:start;margin-top:16px}.browser-search-results{min-width:0}.result-summary{font-size:.78em;color:var(--soft);margin:0 0 16px}.browser-result-list,.result-list{display:flex!important;flex-direction:column;gap:18px;padding:0!important;margin:0!important;list-style:none}.browser-page-slot .browser-result{font:inherit;color:var(--ink);width:100%;min-height:0;max-width:100%;text-align:left;border:0!important;background:transparent!important;padding:0!important;cursor:pointer;display:flex;flex-direction:column;align-items:flex-start;gap:3px;border-radius:0!important;box-shadow:none!important;transform:none!important}.browser-page-slot .browser-result:hover{background:transparent!important}.browser-page-slot .browser-result:hover .result-title,.browser-page-slot .browser-result:hover strong{text-decoration:underline}.browser-result .result-source,.browser-result-source,.result-source{font-size:.76em;color:var(--soft);line-height:1.35}.browser-result .result-title,.browser-result-title,.browser-result>strong{font-size:1.16em;line-height:1.3;color:var(--accent);font-weight:650}.browser-result .result-snippet,.browser-result-snippet,.browser-result>span:last-child{font-size:.9em;line-height:1.55;color:var(--ink)}.browser-knowledge-panel{padding:18px;border:1px solid color-mix(in srgb,var(--ink) 22%,transparent);border-radius:14px;background:color-mix(in srgb,var(--card) 72%,transparent)}
  .browser-reader{max-width:760px;margin:0 auto}.browser-reader h1{font-size:clamp(1.8em,4vw,2.7em);line-height:1.18}.browser-reader h2{margin-top:1.6em}.reader-crumb{color:var(--accent);font-size:.82em}.reader-lead{font-size:1.18em}.browser-reader li{margin:.45em 0}
  .external-url{word-break:break-all;background:color-mix(in srgb,var(--accent) 7%,var(--card));padding:8px 12px;border-radius:10px;max-width:720px;margin:20px auto}
  @media(max-width:860px){.browser-serp-main{grid-template-columns:minmax(0,1fr)}.browser-serp-main>:is(.browser-knowledge-panel,.browser-knowledge-skeleton){display:none}}
  @media(max-width:650px){.browser-toolbar{grid-template-columns:1fr}.browser-nav{order:2}.browser-toolbar>#browser-status{display:none}.browser-tab-wrap{min-width:90px}.engine-search-row{flex-direction:column}.browser-serp-head :is(.engine-search,.browser-search-form){grid-template-columns:1fr}.browser-serp-head .engine-mark{text-align:left}.browser-page-slot{padding:12px}.browser-serp-tabs{gap:14px}}
</style>

<main id="crazy-browser" class="window" data-crazy-browser-runtime="1" data-crazy-browser-hook-contract="7">
  <header class="browser-top">
    <div class="browser-tab-strip">
      <div id="browser-tabs" role="tablist" aria-label="标签页"><span class="muted">新标签页</span></div>
      <button class="browser-new-tab" aria-label="新建标签页" title="新建标签页" data-action="browserNewTab">＋</button>
    </div>
    <div class="browser-toolbar">
      <nav class="browser-nav" aria-label="网页导航">
        <button id="browser-back" class="browser-icon-btn" title="后退" aria-label="后退" data-action="browserBack">←</button>
        <button id="browser-forward" class="browser-icon-btn" title="前进" aria-label="前进" data-action="browserForward">→</button>
        <button class="browser-icon-btn" title="刷新" aria-label="刷新" data-action="browserReload">↻</button>
        <button class="browser-icon-btn" title="主页" aria-label="主页" data-action="browserHome">⌂</button>
      </nav>
      <div class="browser-address-wrap">
        <span class="browser-lock">◇</span>
        <input id="browser-address" class="input" aria-label="地址和搜索栏" autocomplete="off" placeholder="输入网址或搜索关键词" data-action="browserGo">
        <button class="browser-go" aria-label="转到" title="转到" data-action="browserGo">GO</button>
      </div>
      <span id="browser-status">本地安全浏览</span>
    </div>
  </header>
  <div id="browser-pages">
    <div id="browser-page-pending" role="status" hidden></div>
    <section id="browser-page-tab-1" class="browser-page-slot active" data-browser-tab-id="tab-1" data-browser-page-url="crazy://home" data-browser-placeholder="true" aria-live="polite" aria-hidden="false"></section>
  </div>
</main>
<!--done:browser-->`

export function browserOpeningKit(displayName = 'Crazy 浏览器'): string {
  const name = displayName.trim() || 'Crazy 浏览器'
  return BROWSER_TEMPLATE.replaceAll('{{APP_NAME}}', escapeHtml(name))
}
