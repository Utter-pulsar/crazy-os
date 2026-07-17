import { iframeFontUrls } from './assets'

// Builds the document that wraps the model's body-only HTML inside the view iframe.
// The host owns the <head>: fonts, the hand-drawn theme, and a trusted runtime
// script. The model only ever supplies <body> content. This is what keeps the
// aesthetic stable across regenerations — structure varies, style is pinned.

// Fonts come from the renderer module graph, so Vite rewrites them to stable dev/prod
// URLs and the iframe can load them under both the dev server and packaged file:// builds.
function fontFaces(): string {
  return `
@font-face { font-family:'Excalifont'; src:url('${iframeFontUrls.excalifont}') format('woff2'); font-display:swap; }
@font-face { font-family:'Xiaolai'; src:url('${iframeFontUrls.xiaolai}') format('truetype'); font-display:swap; }
@font-face { font-family:'XiaolaiMono'; src:url('${iframeFontUrls.xiaolaiMono}') format('truetype'); font-display:swap; }`
}

// Hand-drawn theme. The wonky asymmetric border-radius is the classic sketch-box trick;
// a tiny SVG turbulence filter gives borders an organic wobble.
const THEME_CSS = `
:root{ --ink:#2b2b2b; --paper:#fdfcf7; --card:#fffef8; --accent:#3a6ea5; --soft:#6b6b6b; }
/* dark mode — the host adds/removes class="dark" on <html> to follow (or override) the OS theme */
html.dark{ --ink:#e8e4db; --paper:#1a1612; --card:#2a2420; --accent:#7bb0e6; --soft:#a5a096; }
html.dark body{ background:transparent; }
*{ box-sizing:border-box; }
html,body{ margin:0; height:100%; }
body{
  font-family:'Excalifont','Xiaolai',system-ui,sans-serif;
  color:var(--ink); background:transparent;
  font-size:17px; line-height:1.55; padding:14px;
  overflow:auto;
}
.paper{ background:
  repeating-linear-gradient(180deg, transparent 0 31px, rgba(58,110,165,.07) 31px 32px),
  var(--paper); }
code,pre,.mono{ font-family:'XiaolaiMono',monospace; }
.title{ font-size:1.25em; font-weight:700; margin:.1em 0 .3em; }
.muted{ color:var(--soft); }
.row{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.col{ display:flex; flex-direction:column; gap:10px; }
.grow{ flex:1; }

.window{ background:var(--card); border:2.5px solid var(--ink);
  border-radius:255px 14px 225px 14px/14px 225px 14px 255px;
  box-shadow:5px 6px 0 rgba(43,43,43,.16); padding:14px 16px 18px; }
.titlebar{ display:flex; justify-content:space-between; align-items:baseline;
  border-bottom:2px dashed var(--ink); padding-bottom:8px; margin-bottom:12px; }
.toolbar{ display:flex; gap:10px; align-items:center; margin-bottom:12px; flex-wrap:wrap; }

.card,.sketch{ border:2.5px solid var(--ink); background:var(--card);
  border-radius:225px 14px 255px 14px/14px 255px 14px 225px;
  padding:12px 14px; margin:8px 0; }
.card:nth-of-type(even){ border-radius:14px 225px 14px 255px/255px 14px 225px 14px; }

.btn{ font:inherit; cursor:pointer; background:var(--card); color:var(--ink);
  border:2.5px solid var(--ink); border-radius:18px 220px 22px 220px/220px 18px 220px 22px;
  padding:5px 14px; transition:transform .08s ease, background .1s ease; }
.btn:hover{ transform:rotate(-1.2deg) translateY(-1px); background:color-mix(in srgb, var(--accent) 18%, var(--card)); }
.btn:active{ transform:translateY(1px) rotate(.6deg); }

.input{ font:inherit; background:transparent; color:var(--ink);
  border:2.5px solid var(--ink); border-radius:220px 16px 220px 18px/16px 220px 18px 220px;
  padding:6px 12px; outline:none; }
.input:focus{ background:color-mix(in srgb, var(--accent) 12%, var(--card)); }

.chip{ display:inline-block; cursor:default; border:2px solid var(--ink);
  border-radius:14px; padding:2px 10px; background:var(--card); text-decoration:none; color:var(--ink); }
button.chip,a.chip,.chip[data-action],.chip[data-hook],.chip[role="button"]{ cursor:pointer; }
button.chip:hover,a.chip:hover,.chip[data-action]:hover,.chip[data-hook]:hover,.chip[role="button"]:hover{
  background:color-mix(in srgb, var(--accent) 18%, var(--card)); }

.list{ display:flex; flex-direction:column; }
.list-item{ border-bottom:2px dotted rgba(43,43,43,.4); padding:9px 2px; }
.list-item:last-child{ border-bottom:none; }
a{ color:var(--accent); }

/* Native scrollbars are hidden everywhere inside the app; the host runtime overlays
   hand-drawn spokes instead (hair-thin at rest, thicker on hover/drag). */
html{ scrollbar-width:none; }
::-webkit-scrollbar{ width:0; height:0; display:none; }

.czsb{ position:fixed; z-index:2147483000; display:flex; align-items:center; justify-content:center;
  cursor:pointer; touch-action:none; opacity:0; transition:opacity 160ms ease; }
.czsb-bar{ background:rgba(43,43,43,.38); border-radius:999px; filter:url(#czwobble);
  transition:width 130ms ease, height 130ms ease, background-color 150ms ease; }
.czsb.v .czsb-bar{ width:3px; height:100%; }
.czsb.h .czsb-bar{ width:100%; height:3px; }
.czsb:hover .czsb-bar,.czsb.dragging .czsb-bar{ background:rgba(43,43,43,.72); }
.czsb.v:hover .czsb-bar,.czsb.v.dragging .czsb-bar{ width:8px; }
.czsb.h:hover .czsb-bar,.czsb.h.dragging .czsb-bar{ height:8px; }

/* the "this part is still being drawn" toast */
#__cz_toast{ position:fixed; left:50%; bottom:18px; transform:translateX(-50%) rotate(-.6deg);
  background:#fffef8; border:2.5px solid var(--ink);
  border-radius:18px 220px 22px 220px/220px 18px 220px 22px;
  padding:6px 16px; font-family:inherit; color:var(--ink);
  box-shadow:3px 4px 0 rgba(43,43,43,.16); opacity:0; pointer-events:none;
  transition:opacity 180ms ease, transform 180ms ease; z-index:2147483001; }
#__cz_toast.show{ opacity:1; transform:translateX(-50%) rotate(.4deg); }
`

// Trusted, host-authored runtime. It provides:
//  * a merge-protected shared `app` object (a whole-object assignment merges instead of
//    replacing, so a later unit can't erase earlier units' handlers)
//  * data-action delegation → app.<name>(payload, event, el); missing handler → a toast
//    ("still being drawn"), which is what makes partially-generated apps operable
//  * data-hook delegation + window.crazyos.ask → model round-trips
//  * raise / Escape forwarding to the host (events don't cross the iframe boundary)
//  * hand-drawn overlay scrollbars for every scrollable region (thin → thick on hover)
const HOST_SCRIPT = `
(function(){
  // --- merge-protected shared app object -------------------------------------------
  var appObj = {};
  try {
    Object.defineProperty(window, 'app', {
      configurable: false,
      get: function(){ return appObj; },
      set: function(v){ if (v && typeof v === 'object') { for (var k in v) appObj[k] = v[k]; } }
    });
  } catch (e) { window.app = appObj; }

  var activeActionElement = null;
  function browserSourceTabId(el){
    var cursor = el;
    while (cursor && cursor.closest) {
      var slot = cursor.closest('.browser-page-slot[data-browser-tab-id]');
      if (!slot) return '';
      if (slot.parentElement && slot.parentElement.id === 'browser-pages') {
        return String(slot.getAttribute('data-browser-tab-id') || '');
      }
      cursor = slot.parentElement;
    }
    return '';
  }
  function stampHookSource(hook, el){
    var tabId = browserSourceTabId(el);
    if (!tabId || !hook || typeof hook !== 'object') return hook;
    var detail = hook.detail && typeof hook.detail === 'object' ? hook.detail : {};
    var copied = {};
    for (var key in detail) copied[key] = detail[key];
    copied.sourceTabId = tabId;
    var routed = {};
    for (var hookKey in hook) routed[hookKey] = hook[hookKey];
    routed.detail = copied;
    return routed;
  }

  function collect(el){
    var p = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (a.name.indexOf('data-') === 0 && a.name !== 'data-hook' && a.name !== 'data-action' && a.name.indexOf('data-hook-') !== 0 && a.name.indexOf('data-crazyos-') !== 0)
        p[a.name.slice(5)] = a.value;
    }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') p.value = el.value;
    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) p.checked = !!el.checked;
    var ownerForm = el.tagName === 'FORM' ? el : (el.form || (el.closest && el.closest('form')));
    if (ownerForm && typeof FormData !== 'undefined') {
      try {
        var fd = new FormData(ownerForm);
        fd.forEach(function(value, key){ p[key] = String(value); });
      } catch (ignore) {}
    }
    return p;
  }

  window.crazyos = {
    // Ask the OS model to modify the current view. Use ONLY for things local JS can't do
    // (imagine a new screen, generate fresh content). For a predesigned region,
    // hook = {action, kind:'navigate'|'content', target, placement, role, template, detail}.
    ask: function(hook){
      try {
        var routed = stampHookSource(hook || {}, activeActionElement);
        parent.postMessage({ __crazyos: 'ask', hook: routed || {} }, '*');
      } catch (e) {}
    },
    // Persist a compact snapshot of this app's important data, so a later reopen can rebuild it.
    save: function(state){ try { parent.postMessage({ __crazyos: 'save', state: state }, '*'); runtimeDirty(); } catch (e) {} },
    // Ask the trusted host to open a web URL. Main accepts HTTP(S) only; generated
    // app code never receives shell or ipcRenderer access.
    openExternal: function(url){ try { parent.postMessage({ __crazyos: 'external', url: String(url || '') }, '*'); } catch (e) {} }
  };
  function runtimeDirty(){
    try { parent.postMessage({ __crazyos: 'runtime-dirty' }, '*'); } catch (e) {}
  }

  // --- toast + unit error surface ---------------------------------------------------
  var toastTimer = null;
  function toast(msg){
    if (!document.body) return;
    var t = document.getElementById('__cz_toast');
    if (!t) { t = document.createElement('div'); t.id = '__cz_toast'; t.setAttribute('data-crazyos-host','true'); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 1700);
  }
  window.__czToast = toast;
  window.__unitError = function(err){
    try { console.error('[crazy_os unit]', err); } catch (e) {}
    toast('有个部件没画好 😵');
  };

  // --- delegation: data-action (local) and data-hook (model round-trip) --------------
  // Try to satisfy a click by firing a nearby input's data-hook (a go/search/submit-style
  // button acting on an input). Returns true if it fired one.
  function fireNearbyHook(fromEl){
    var box = (fromEl.closest && fromEl.closest('.toolbar, .row, form, .card, .col')) || document.body;
    var inp = box.querySelector('input[data-hook], textarea[data-hook]');
    if (inp) { return fireHook(inp, inp.getAttribute('data-hook')); }
    return false;
  }
  function isDisabled(el){
    return !el || !!el.disabled || el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
  }
  function firstText(node){
    if (!node) return '';
    return (node.getAttribute && (node.getAttribute('aria-label') || node.getAttribute('title'))) || (node.textContent || '').trim();
  }
  function genericHookFromEl(el){
    if (!el) return null;
    var text = firstText(el).slice(0, 80);
    var detail = collect(el);
    if (text) detail.label = text;
    if (el.id) detail.id = el.id;
    var role = el.getAttribute && el.getAttribute('role');
    if (role) detail.role = role;
    return { action: 'continue_ui', detail: detail };
  }
  function owningBrowserSlot(el){
    var cursor = el;
    while (cursor && cursor.closest) {
      var slot = cursor.closest('.browser-page-slot[data-browser-tab-id]');
      if (!slot) return null;
      if (slot.parentElement && slot.parentElement.id === 'browser-pages') return slot;
      cursor = slot.parentElement;
    }
    return null;
  }
  function browserOwnedSelector(slot, selector){
    var tabId = slot && String(slot.getAttribute('data-browser-tab-id') || '');
    var safeTab = tabId.replace(/[^a-zA-Z0-9_]/g, '_');
    if (!selector || !new RegExp('^#page-' + safeTab + '-[a-zA-Z0-9_:.-]+$').test(selector)) return null;
    try {
      var node = slot.querySelector(selector);
      return node && owningBrowserSlot(node) === slot ? node : null;
    } catch (ignore) { return null; }
  }
  function sanitizeUserBubble(fragment){
    if (!fragment || !fragment.querySelectorAll) return fragment;
    fragment.querySelectorAll('script,style,link,meta,base,iframe,object,embed,form,input,button,textarea,select,foreignObject,use').forEach(function(node){ node.remove(); });
    fragment.querySelectorAll('*').forEach(function(node){
      Array.prototype.slice.call(node.attributes || []).forEach(function(attr){
        var name = String(attr.name || '').toLowerCase();
        if (name.indexOf('on') === 0 || name === 'srcdoc' || name === 'id' || name === 'data-action' || name === 'data-hook' || name.indexOf('data-hook-') === 0 || name === 'data-crazyos-slot' || name.indexOf('data-browser-') === 0) node.removeAttribute(attr.name);
      });
    });
    return fragment;
  }
  function browserSendContent(payload, el){
    payload = payload || {};
    var slot = owningBrowserSlot(el);
    if (!slot) return false;
    var targetSelector = String(payload.target || '');
    var target = browserOwnedSelector(slot, targetSelector);
    if (!target || target.getAttribute('data-crazyos-slot') !== 'content') return false;
    var message = String(payload.message || payload.value || payload.query || '').trim();
    if (!message) return false;
    var userTemplateSelector = String(payload['user-template'] || payload.userTemplate || '');
    var userTemplate = browserOwnedSelector(slot, userTemplateSelector);
    var bubble = null;
    if (userTemplate && userTemplate.tagName === 'TEMPLATE') {
      bubble = sanitizeUserBubble(userTemplate.content.cloneNode(true));
      var content = bubble.querySelector('[data-crazy-user-content]');
      if (content) content.textContent = message;
    }
    if (!bubble || !bubble.firstElementChild) {
      bubble = document.createDocumentFragment();
      var article = document.createElement('article');
      article.className = 'list-item browser-page-list-item';
      var who = document.createElement('strong');
      who.textContent = '你';
      var text = document.createElement('p');
      text.textContent = message;
      article.append(who, text);
      bubble.appendChild(article);
    }
    target.appendChild(bubble);
    var replyTemplateSelector = String(payload['reply-template'] || payload.replyTemplate || '');
    var replyTemplate = browserOwnedSelector(slot, replyTemplateSelector);
    var detail = {};
    for (var key in payload) detail[key] = payload[key];
    detail.message = message;
    window.crazyos.ask({
      action: String(payload['content-action'] || payload.contentAction || 'browser_content_reply').slice(0, 80),
      kind: 'content',
      target: targetSelector,
      placement: 'append',
      role: String(payload.role || 'assistant reply').slice(0, 160),
      template: replyTemplate && replyTemplate.tagName === 'TEMPLATE' ? replyTemplateSelector : undefined,
      detail: detail
    });
    var form = el && (el.form || (el.closest && el.closest('form')));
    if (form) {
      var field = form.querySelector('textarea[name="message"],input[name="message"],textarea,input[type="text"]');
      if (field) field.value = '';
    }
    runtimeDirty();
    return true;
  }
  try {
    Object.defineProperty(appObj, 'browserSendContent', {
      configurable: false,
      enumerable: true,
      writable: false,
      value: function(payload, event, el){ return browserSendContent(payload, el); }
    });
  } catch (ignore) { appObj.browserSendContent = function(payload, event, el){ return browserSendContent(payload, el); }; }
  function fireHook(el, action){
    if (!action) return false;
    var routed = genericHookFromEl(el) || { action: action, detail: collect(el) };
    routed.action = action;
    var kind = el.getAttribute('data-hook-kind');
    var target = el.getAttribute('data-hook-target');
    var placement = el.getAttribute('data-hook-placement');
    var role = el.getAttribute('data-hook-role');
    var template = el.getAttribute('data-hook-template');
    if (kind === 'navigate' || kind === 'content') routed.kind = kind;
    if (target) routed.target = target;
    if (placement === 'replace' || placement === 'append') routed.placement = placement;
    if (role) routed.role = role;
    if (template) routed.template = template;
    window.crazyos.ask(stampHookSource(routed, el));
    return true;
  }
  function fireAction(el, event){
    var name = el.getAttribute('data-action');
    var explicitHook = el.getAttribute('data-hook');
    if (el.getAttribute('data-crazyos-auto-hook') === 'true' && explicitHook) {
      if (el.getAttribute('data-crazyos-proxy-input') === 'true' && fireNearbyHook(el)) return true;
      return fireHook(el, explicitHook);
    }
    var fn = appObj[name];
    if (typeof fn === 'function') {
      var previousActionElement = activeActionElement;
      activeActionElement = el;
      var sourceTabId = browserSourceTabId(el);
      var generatedBrowserPrefix = sourceTabId ? 'page_' + sourceTabId.replace(/[^a-zA-Z0-9_]/g, '_') + '_' : '';
      var handlerEvent = generatedBrowserPrefix && name.indexOf(generatedBrowserPrefix) === 0 ? null : event;
      var actionResult;
      try { actionResult = fn(collect(el), handlerEvent, el); runtimeDirty(); } catch (err) { window.__unitError(err); }
      finally { activeActionElement = previousActionElement; }
      if (name === 'browserSendContent' && actionResult === false) toast('聊天发送区还没有连接到本标签的消息列表');
      return true;
    }
    // The renderer auto-adds data-hook when generated local logic is missing.
    // Preserve the model's intended action name and let Crazy finish the
    // interaction instead of treating the whole application as broken.
    if (explicitHook) {
      return fireHook(el, explicitHook);
    }
    if (fireNearbyHook(el)) return true;
    var hook = genericHookFromEl(el);
    if (hook) { window.crazyos.ask(hook); return true; }
    return false;
  }
  document.addEventListener('click', function(e){
    if (e.defaultPrevented) return;
    var t = e.target;
    if (!t || !t.closest) return;
    var el = t.closest('[data-action]');
    if (el) {
      if (isDisabled(el)) return;
      if (el.matches('textarea, select, input:not([type="button"]):not([type="submit"]):not([type="reset"])')) return;
      e.preventDefault();
      if (!fireAction(el, e)) window.crazyos.ask({ action: 'continue_ui', detail: collect(el) });
      return;
    }
    var h = t.closest('[data-hook]');
    if (h) {
      if (isDisabled(h)) return;
      if ((h.tagName === 'INPUT' || h.tagName === 'TEXTAREA' || h.tagName === 'SELECT') && !h.hasAttribute('data-hook-on-click')) return;
      e.preventDefault();
      if (h.getAttribute('data-crazyos-proxy-input') === 'true' && fireNearbyHook(h)) return;
      fireHook(h, h.getAttribute('data-hook'));
      return;
    }
    // Fallback for a plain button/link the model forgot to wire at all.
    var btn = t.closest('button, a[href], .btn, [role="button"]');
    if (btn) {
      if (isDisabled(btn) || typeof btn.onclick === 'function') return;
      e.preventDefault();
      if (!fireNearbyHook(btn)) {
        var hook = genericHookFromEl(btn);
        if (hook) window.crazyos.ask(hook);
      }
    }
  });
  document.addEventListener('submit', function(e){
    if (e.defaultPrevented) return;
    var form = e.target;
    if (!form || !form.querySelector) return;
    e.preventDefault();
    var submitter = e.submitter || form.querySelector('button[type="submit"], input[type="submit"]');
    if (isDisabled(submitter || form)) return;
    if (submitter && submitter.hasAttribute('data-action')) {
      if (!fireAction(submitter, e)) window.crazyos.ask(genericHookFromEl(submitter));
      return;
    }
    if (submitter && submitter.hasAttribute('data-hook')) {
      fireHook(submitter, submitter.getAttribute('data-hook'));
      return;
    }
    if (!fireNearbyHook(form)) window.crazyos.ask(genericHookFromEl(submitter || form));
  });
  document.addEventListener('keydown', function(e){
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') { try { parent.postMessage({ __crazyos: 'esc' }, '*'); } catch (err) {} return; }
    var roleButton = e.target && e.target.closest && e.target.closest('[role="button"]');
    if (roleButton && (e.key === 'Enter' || e.key === ' ')) {
      if (isDisabled(roleButton)) return;
      e.preventDefault(); roleButton.click(); return;
    }
    if (e.key !== 'Enter') return;
    var el = e.target;
    if (!el || !(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
    if (el.hasAttribute('data-action')) {
      e.preventDefault();
      if (!fireAction(el, e)) window.crazyos.ask({ action: 'continue_ui', detail: collect(el) });
    }
    else if (el.hasAttribute('data-hook')) {
      e.preventDefault();
      fireHook(el, el.getAttribute('data-hook'));
    }
  });
  document.addEventListener('input', runtimeDirty, true);
  document.addEventListener('change', function(e){
    runtimeDirty();
    if (e.defaultPrevented) return;
    var el = e.target;
    if (!el || !el.getAttribute) return;
    var changeRouted = el.tagName === 'SELECT' ||
      (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) ||
      el.hasAttribute('data-hook-on-change') || el.hasAttribute('data-action-on-change');
    if (!changeRouted || isDisabled(el)) return;
    if (el.hasAttribute('data-action')) {
      if (!fireAction(el, e)) fireHook(el, 'continue_ui');
    } else if (el.hasAttribute('data-hook')) {
      fireHook(el, el.getAttribute('data-hook'));
    }
  });

  // Clicking anywhere inside the app raises its window (clicks don't cross the iframe
  // boundary, so the host can't see them without this).
  document.addEventListener('pointerdown', function(){
    try { parent.postMessage({ __crazyos: 'raise' }, '*'); } catch (e) {}
  }, true);

  // --- hand-drawn overlay scrollbars -------------------------------------------------
  // Every scrollable region gets a thin inky spoke (3px) along its edge that thickens
  // (8px) on hover/drag. Native bars are hidden in CSS. Runs against the LIVE document,
  // so regions appear/disappear correctly while the model is still streaming.
  var HIT = 10, PAD = 3, MINLEN = 26;
  var thumbs = new Map(); // el -> { v?: thumbEl, x?: thumbEl }

  function makeThumb(el, axis){
    var t = document.createElement('div');
    t.className = 'czsb ' + (axis === 'v' ? 'v' : 'h');
    t.setAttribute('data-crazyos-host','true');
    t.style[axis === 'v' ? 'width' : 'height'] = HIT + 'px';
    var bar = document.createElement('div');
    bar.className = 'czsb-bar';
    t.appendChild(bar);
    document.body.appendChild(t);
    var dragStart = 0, scrollStart = 0;
    t.addEventListener('pointerdown', function(e){
      e.preventDefault(); e.stopPropagation();
      dragStart = axis === 'v' ? e.clientY : e.clientX;
      scrollStart = axis === 'v' ? el.scrollTop : el.scrollLeft;
      t.classList.add('dragging');
      try { t.setPointerCapture(e.pointerId); } catch (err) {}
    });
    t.addEventListener('pointermove', function(e){
      if (!t.classList.contains('dragging')) return;
      var m = metrics(el, axis);
      if (!m) return;
      var delta = (axis === 'v' ? e.clientY : e.clientX) - dragStart;
      var next = scrollStart + (m.maxOffset > 0 ? (delta / m.maxOffset) * m.overflow : 0);
      if (axis === 'v') el.scrollTop = next; else el.scrollLeft = next;
      schedule();
    });
    function up(e){ t.classList.remove('dragging'); try { t.releasePointerCapture(e.pointerId); } catch (err) {} }
    t.addEventListener('pointerup', up);
    t.addEventListener('pointercancel', up);
    return t;
  }

  function metrics(el, axis){
    var vertical = axis === 'v';
    var isRoot = el === document.documentElement || el === document.body;
    var client = isRoot ? (vertical ? window.innerHeight : window.innerWidth)
                        : (vertical ? el.clientHeight : el.clientWidth);
    var scroll = vertical ? el.scrollHeight : el.scrollWidth;
    var overflow = scroll - client;
    if (overflow <= 4 || client <= 0) return null;
    var track = client - PAD * 2;
    var size = Math.max(MINLEN, Math.min(track, (client / scroll) * track));
    var maxOffset = track - size;
    var pos = vertical ? el.scrollTop : el.scrollLeft;
    var offset = PAD + (maxOffset > 0 ? (pos / overflow) * maxOffset : 0);
    var rect = isRoot ? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
                      : el.getBoundingClientRect();
    return { size: size, offset: offset, overflow: overflow, maxOffset: maxOffset, rect: rect };
  }

  function layoutThumb(el, axis){
    var entry = thumbs.get(el) || {};
    var m = metrics(el, axis);
    var t = entry[axis];
    if (!m) {
      if (t) { t.remove(); delete entry[axis]; thumbs.set(el, entry); }
      return;
    }
    if (!t) { t = makeThumb(el, axis); entry[axis] = t; thumbs.set(el, entry); }
    t.style.opacity = '1';
    if (axis === 'v') {
      t.style.height = m.size + 'px';
      t.style.top = (m.rect.top + m.offset) + 'px';
      t.style.left = (m.rect.right - HIT - 1) + 'px';
    } else {
      t.style.width = m.size + 'px';
      t.style.left = (m.rect.left + m.offset) + 'px';
      t.style.top = (m.rect.bottom - HIT - 1) + 'px';
    }
  }

  function layoutAll(){
    if (!document.body) return;
    var candidates = [document.documentElement];
    var all = document.body.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.className === 'czsb' || (el.classList && el.classList.contains('czsb'))) continue;
      if (el.scrollHeight - el.clientHeight > 4 || el.scrollWidth - el.clientWidth > 4) {
        var cs = getComputedStyle(el);
        if (/(auto|scroll|overlay)/.test(cs.overflowY + ' ' + cs.overflowX)) candidates.push(el);
      }
    }
    var seen = new Set(candidates);
    thumbs.forEach(function(entry, el){
      if (!seen.has(el) || !el.isConnected) {
        if (entry.v) entry.v.remove();
        if (entry.h) entry.h.remove();
        thumbs.delete(el);
      }
    });
    for (var j = 0; j < candidates.length; j++) {
      layoutThumb(candidates[j], 'v');
      layoutThumb(candidates[j], 'h');
    }
  }

  var rafId = 0;
  function schedule(){
    if (rafId) return;
    rafId = requestAnimationFrame(function(){ rafId = 0; layoutAll(); });
  }

  // boot once <body> exists (this script runs in <head> while the doc is still streaming)
  var bootTimer = setInterval(function(){
    if (!document.body) return;
    clearInterval(bootTimer);
    // the wobble filter the .czsb-bar CSS references
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('data-crazyos-host','true'); svg.style.position = 'absolute';
    svg.innerHTML = '<defs><filter id="czwobble"><feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2" xChannelSelector="R" yChannelSelector="G"/></filter></defs>';
    document.body.appendChild(svg);
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    schedule();
  }, 120);
})();
`

// ONLY restrict network egress (so model-written JS can't phone home). We deliberately do
// NOT set default-src/script-src: the model's whole point is to run its own inline JS —
// a script-src would silently kill all of it.
const CSP = "connect-src 'none'; object-src 'none'; base-uri 'none'"

/** The head + opening body tag written before any model output streams in. `dark` starts the
 *  document in dark mode so apps follow the system theme from the first paint. */
export function viewDocHead(dark = false): string {
  return `<!doctype html><html lang="zh-CN"${dark ? ' class="dark"' : ''}><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${CSP}" />
<style>${fontFaces()}${THEME_CSS}</style>
<script>${HOST_SCRIPT}<\/script>
</head><body>`
}

/** Written after the model finishes, to close the streamed document. */
export const VIEW_DOC_TAIL = `</body></html>`

/** A small "the model is sketching…" placeholder shown the instant a view opens. */
export const SKETCHING_PLACEHOLDER = `<div class="window"><div class="titlebar"><span class="title">正在动笔…</span><span class="muted">crazy_os</span></div><p class="muted">模型正在想象这个界面长什么样。</p></div>`
