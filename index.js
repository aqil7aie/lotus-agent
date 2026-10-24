// Lotus agent extension for Luker — v0.4.0
// A real agent with its own chat window, connected to the Memory Graph.
// Spec (Aqil): extension, not a fork; Lotus window, not ST's window;
// the agents get their OWN icon up in the top bar (not a floating
// button) — because more agents and features will join later, and this
// is not a simple extension. The top icon is the agents' home: Lotus
// first, more agents later. Runs only when opened (spend rule); memory
// work on a cheap preset. v0.1: recall-before-reply is automatic,
// writes to the graph are explicit (per-message button, or the
// auto-extract toggle).

import { extension_settings, getContext } from '../../../extensions.js';

const EXTENSION_NAME = 'lotus-agent';
const HISTORY_KEY = 'lotus-agent-history-v1';
const HISTORY_LIMIT = 100;
const CONTEXT_WINDOW = 20;

const LOTUS_SVG = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g fill="#e8730c"><ellipse cx="24" cy="26" rx="6" ry="12"/><ellipse cx="12" cy="28" rx="5" ry="10" transform="rotate(-28 12 28)"/><ellipse cx="36" cy="28" rx="5" ry="10" transform="rotate(28 36 28)"/><ellipse cx="6" cy="32" rx="4" ry="8" transform="rotate(-48 6 32)"/><ellipse cx="42" cy="32" rx="4" ry="8" transform="rotate(48 42 32)"/></g></svg>`;
const LOTUS_SVG_WHITE = LOTUS_SVG.replace('fill="#e8730c"', 'fill="#ffffff"');

const defaultSettings = {
  agentName: 'Lotus',
  chatPreset: '',
  memoryPreset: '',
  memoryEnabled: true,
  autoExtract: false,
};

let settings = { ...defaultSettings };
let history = [];
let busy = false;
let els = {};

function loadSettings() {
  extension_settings[EXTENSION_NAME] = extension_settings[EXTENSION_NAME] || {};
  Object.assign(extension_settings[EXTENSION_NAME], {
    ...defaultSettings,
    ...extension_settings[EXTENSION_NAME],
  });
  settings = extension_settings[EXTENSION_NAME];
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    history = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(history)) history = [];
  } catch {
    history = [];
  }
}

function saveHistory() {
  history = history.slice(-HISTORY_LIMIT);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch { /* storage may be unavailable; extension_settings still holds it */ }
  extension_settings[EXTENSION_NAME].history = history;
}

function saveSettings() {
  extension_settings[EXTENSION_NAME] = settings;
  saveHistory();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function setMemoryStatus(text) {
  // Command readout: agent + connection profile + memory, live.
  if (els.status) els.status.textContent = `${text} • ${settings.chatPreset || 'بدون بروفايل'}`;
  // Chatwin dot: green while the memory session is live, muted else.
  if (els.dot) els.dot.style.background = text.includes('متصلة') ? '#3f9e4d' : '#70746c';
}

// ---- Memory Graph (session facade; never import memory-graph files) ----

async function getMemorySession() {
  try {
    const extMod = await import('../../../extensions.js');
    const getExtensionApi = extMod.getExtensionApi;
    if (typeof getExtensionApi !== 'function') return null;
    const memoryApi = getExtensionApi('memory-graph');
    if (!memoryApi || typeof memoryApi.openSession !== 'function') return null;
    const context = getContext();
    const session = await memoryApi.openSession(context);
    return session || null;
  } catch {
    return null;
  }
}

async function recallBriefs(userText) {
  if (!settings.memoryEnabled) return [];
  try {
    const session = await getMemorySession();
    if (!session || typeof session.keywordSearch !== 'function') {
      setMemoryStatus('الذاكرة: غير متاحة');
      return [];
    }
    setMemoryStatus('الذاكرة: متصلة');
    const hits = await session.keywordSearch(userText);
    const list = Array.isArray(hits) ? hits : (hits?.results || []);
    return list.slice(0, 3).map((hit) => {
      const brief = hit?.brief || hit?.title || hit?.summary || '';
      return brief ? String(brief) : '';
    }).filter(Boolean);
  } catch {
    setMemoryStatus('الذاكرة: غير متاحة');
    return [];
  }
}

async function rememberText(text) {
  const session = await getMemorySession();
  if (!session || typeof session.applyExtractionBatch !== 'function') {
    throw new Error('memory session unavailable');
  }
  const title = String(text).replace(/\s+/g, ' ').slice(0, 40);
  const result = await session.applyExtractionBatch({
    ops: [{
      op: 'create',
      type: 'event',
      title,
      fields: { summary: String(text).slice(0, 500) },
    }],
  });
  if (result?.rejected?.length) {
    throw new Error(result.rejected[0]?.error?.message || 'rejected');
  }
  return result;
}

// ---- Window (Lotus window: floating, no header bar) ----

function buildWindow() {
  const win = document.createElement('div');
  win.className = 'lotus-agent-window';
  win.id = 'lotus-agent-window';
  // v0.4.0: the box IS Lotus's own chatwin (from lotus__9__11S.html on
  // Drive, same file Aqil runs on his phone) — not Copilot's header,
  // not an invented box. Placement stays v0.3.1 (panel below Luker's
  // top bar, measured at open, z 9992); only the LOOK is now pure
  // Lotus: floating white id-pill + 40px corner buttons over the
  // conversation, absolute messages (92px top / 150px bottom), and the
  // 28px composer at the bottom. All styles inline, as always.
  win.style.position = 'fixed';
  win.style.left = '0';
  win.style.right = '0';
  win.style.bottom = '0';
  win.style.top = '56px';
  win.style.width = 'auto';
  win.style.height = 'auto';
  win.style.transform = 'none';
  win.style.minWidth = '0';
  win.style.minHeight = '0';
  win.style.maxWidth = 'none';
  win.style.maxHeight = 'none';
  win.style.resize = 'none';
  win.style.overflow = 'hidden';
  win.style.zIndex = '9992';
  win.style.display = 'none';
  win.style.background = '#eef0ee';
  win.style.color = '#1d1f1c';
  win.style.borderInline = '1px solid rgba(29,31,28,0.09)';
  win.style.borderRadius = '0';
  win.style.boxShadow = '0 0 60px rgba(0,0,0,0.08)';
  win.innerHTML = `
    <div class="lotus-agent-float-top" id="lotus-agent-float-top">
      <div class="lotus-agent-id-pill" id="lotus-agent-pill">
        <div class="lotus-agent-avatar">${LOTUS_SVG_WHITE}</div>
        <div class="lotus-agent-head-meta">
          <div class="lotus-agent-name" id="lotus-agent-name"></div>
          <div class="lotus-agent-head-status"><span class="lotus-agent-dot" id="lotus-agent-dot"></span><span id="lotus-agent-status">الذاكرة: ...</span></div>
        </div>
      </div>
      <div class="lotus-agent-float-actions">
        <button class="lotus-agent-float-btn" id="lotus-agent-max" title="عائمة / لوحة">⤢</button>
        <button class="lotus-agent-float-btn" id="lotus-agent-close" title="إغلاق">×</button>
      </div>
    </div>
    <div class="lotus-agent-messages" id="lotus-agent-messages"></div>
    <div class="lotus-agent-composer-zone">
      <div class="lotus-agent-diag" id="lotus-agent-diag"></div>
      <div class="lotus-agent-composer" id="lotus-agent-composer">
        <div class="lotus-agent-field"><textarea class="lotus-agent-input" id="lotus-agent-input" rows="1" placeholder="اكتب رسالتك..."></textarea></div>
        <button class="lotus-agent-send" id="lotus-agent-send" title="إرسال">➤</button>
      </div>
    </div>`;
  // Chatwin measurements, inline, verbatim from 9.11S.
  const floatTop = win.querySelector('#lotus-agent-float-top');
  floatTop.style.cssText = 'position:absolute;top:calc(10px + env(safe-area-inset-top));left:12px;right:12px;width:auto;display:flex;align-items:center;justify-content:space-between;gap:10px;z-index:5;pointer-events:none;';
  const pill = win.querySelector('#lotus-agent-pill');
  pill.style.cssText = 'pointer-events:auto;display:flex;align-items:center;gap:10px;background:#ffffff;border:1px solid rgba(29,31,28,0.09);border-radius:999px;box-shadow:0 8px 28px rgba(29,31,28,0.09),0 1px 6px rgba(29,31,28,0.05);padding:5px 6px 5px 14px;cursor:grab;touch-action:none;';
  const avatar = pill.querySelector('.lotus-agent-avatar');
  avatar.style.cssText = 'width:36px;height:36px;border-radius:50%;background:#bc451f;display:grid;place-items:center;flex-shrink:0;';
  avatar.querySelector('svg').style.cssText = 'width:19px;height:19px;';
  const headMeta = win.querySelector('.lotus-agent-head-meta');
  headMeta.style.cssText = 'min-width:0;';
  const pillName = win.querySelector('#lotus-agent-name');
  pillName.style.cssText = 'font-weight:700;font-size:15.5px;line-height:1.25;color:#1d1f1c;white-space:nowrap;';
  const headStatus = win.querySelector('.lotus-agent-head-status');
  headStatus.style.cssText = 'font-size:12px;color:#70746c;display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  const dot = win.querySelector('#lotus-agent-dot');
  dot.style.cssText = 'width:7px;height:7px;border-radius:50%;background:#70746c;display:inline-block;flex-shrink:0;';
  const actions = win.querySelector('.lotus-agent-float-actions');
  actions.style.cssText = 'display:flex;gap:8px;pointer-events:auto;';
  const maxBtn = win.querySelector('#lotus-agent-max');
  const closeBtn = win.querySelector('#lotus-agent-close');
  maxBtn.style.cssText = 'pointer-events:auto;width:40px;height:40px;border-radius:50%;border:1px solid rgba(29,31,28,0.09);background:#ffffff;color:#70746c;box-shadow:0 8px 28px rgba(29,31,28,0.09),0 1px 6px rgba(29,31,28,0.05);display:grid;place-items:center;cursor:pointer;font-size:19px;flex-shrink:0;padding:0;';
  closeBtn.style.cssText = 'pointer-events:auto;width:40px;height:40px;border-radius:50%;border:1px solid rgba(29,31,28,0.09);background:#ffffff;color:#70746c;box-shadow:0 8px 28px rgba(29,31,28,0.09),0 1px 6px rgba(29,31,28,0.05);display:grid;place-items:center;cursor:pointer;font-size:19px;flex-shrink:0;padding:0;';
  const messages = win.querySelector('#lotus-agent-messages');
  messages.style.cssText = 'position:absolute;inset:0;overflow-y:auto;padding:92px 18px 150px;display:flex;flex-direction:column;gap:18px;scroll-behavior:smooth;overscroll-behavior:contain;';
  const zone = win.querySelector('.lotus-agent-composer-zone');
  zone.style.cssText = 'position:absolute;bottom:0;left:0;right:0;padding:8px 12px calc(12px + env(safe-area-inset-bottom));background:transparent;z-index:6;';
  const diag = win.querySelector('#lotus-agent-diag');
  diag.style.cssText = 'font-size:12px;color:#70746c;text-align:center;padding:0 12px 6px;';
  const composer = win.querySelector('#lotus-agent-composer');
  composer.style.cssText = 'box-sizing:border-box;background:#ffffff;border:1px solid #ffffff;border-radius:28px;box-shadow:0 8px 28px rgba(29,31,28,0.09),0 1px 6px rgba(29,31,28,0.05);display:flex;flex-wrap:wrap;align-items:flex-end;gap:2px 4px;padding:6px;';
  const field = win.querySelector('.lotus-agent-field');
  field.style.cssText = 'flex:1;min-width:0;display:flex;align-items:center;overflow:hidden;';
  const input = win.querySelector('#lotus-agent-input');
  input.style.cssText = 'font:inherit;font-size:16px;line-height:24px;width:100%;border:none;outline:none;resize:none;background:transparent;color:#1d1f1c;padding:8px 4px;margin:0;overflow-y:hidden;max-height:144px;';
  const send = win.querySelector('#lotus-agent-send');
  send.style.cssText = 'border:none;border-radius:50%;width:40px;height:40px;cursor:pointer;background:#2f7cf6;color:#ffffff;font-size:18px;flex-shrink:0;display:grid;place-items:center;opacity:0;transform:scale(0.6);pointer-events:none;transition:opacity 0.22s ease,transform 0.3s cubic-bezier(0.22,1,0.36,1),background 0.15s ease;';

  document.body.appendChild(win);

  els = {
    win,
    name: win.querySelector('#lotus-agent-name'),
    status: win.querySelector('#lotus-agent-status'),
    dot: win.querySelector('#lotus-agent-dot'),
    messages: win.querySelector('#lotus-agent-messages'),
    input: win.querySelector('#lotus-agent-input'),
    send: win.querySelector('#lotus-agent-send'),
    composer: win.querySelector('#lotus-agent-composer'),
  };

  els.name.textContent = settings.agentName;
  els.close = win.querySelector('#lotus-agent-close');
  els.close.addEventListener('click', closeWindow);
  els.pill = win.querySelector('#lotus-agent-pill');
  els.max = win.querySelector('#lotus-agent-max');
  els.max.addEventListener('click', togglePanel);
  els.pill.addEventListener('pointerdown', onHeaderDragStart);
  els.send.addEventListener('click', onSend);
  els.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  });
  els.input.addEventListener('input', () => {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 144) + 'px';
    // Chatwin send: hidden while empty, appears while typing; the
    // composer rounds to 24px once the field goes multiline.
    const hasText = els.input.value.trim().length > 0;
    els.send.style.opacity = hasText ? '1' : '0';
    els.send.style.transform = hasText ? 'scale(1)' : 'scale(0.6)';
    els.send.style.pointerEvents = hasText ? 'auto' : 'none';
    els.composer.style.borderRadius = els.input.scrollHeight > 24 ? '24px' : '28px';
  });
}

function openWindow() {
  try {
    if (isPanel) applyPanel();
    else applyFloating();
  } catch (error) {
    // If the panel geometry fails for any reason, fall back to the
    // floating card that provably rendered in v0.2.x — never nothing.
    applyFloating();
  }
  els.win.style.display = 'flex';
  setIconActive(true);
  renderMessages();
  // Diagnostic strip: version + message count + height + mode. If this
  // strip is absent, the update never reached the app.
  const diag = els.win.querySelector('#lotus-agent-diag');
  if (diag) {
    const height = Math.round(els.win.getBoundingClientRect().height || 0);
    diag.textContent = `v0.4.0 • رسائل: ${history.length} • ارتفاع: ${height}px • ${isPanel ? 'لوحة' : 'عائمة'}`;
  }
  els.input.focus();
  getMemorySession().then((session) => {
    setMemoryStatus(session ? 'الذاكرة: متصلة' : 'الذاكرة: غير متاحة');
  });
}

function closeWindow() {
  els.win.style.display = 'none';
  setIconActive(false);
}

// The top icon lights up while the window is open: if a press tints
// the icon but no window appears, the click runs and the window is
// hidden — if it never tints, the click never fires. One-word report.
function setIconActive(active) {
  const icon = document.querySelector('#lotus-agent-top-icon');
  if (icon) icon.style.background = active ? 'rgba(188, 69, 31, 0.25)' : 'transparent';
}

function toggleWindow() {
  if (els.win.style.display === 'flex') closeWindow();
  else openWindow();
}

// ---- Panel / floating states (v0.3.0: panel by default) ----

let isPanel = true;

function measurePanelTop() {
  const bar = document.querySelector('#top-settings-holder');
  if (!bar) return 56;
  const bottom = Math.round(bar.getBoundingClientRect().bottom || 0);
  return bottom > 0 ? bottom : 56;
}

function applyPanel() {
  els.win.style.transform = 'none';
  els.win.style.left = '0';
  els.win.style.right = '0';
  els.win.style.bottom = '0';
  els.win.style.top = measurePanelTop() + 'px';
  els.win.style.width = 'auto';
  els.win.style.height = 'auto';
  els.win.style.borderRadius = '0';
  els.win.style.borderInline = '1px solid rgba(29,31,28,0.09)';
  els.win.style.boxShadow = '0 0 60px rgba(0,0,0,0.08)';
  els.win.style.resize = 'none';
  els.win.style.zIndex = '9992';
  els.max.textContent = '⤢';
  isPanel = true;
}

function applyFloating() {
  els.win.style.transform = 'translate(-50%, -50%)';
  els.win.style.left = '50%';
  els.win.style.top = '50%';
  els.win.style.right = 'auto';
  els.win.style.bottom = 'auto';
  els.win.style.width = 'min(92vw, 520px)';
  els.win.style.height = 'min(78vh, 660px)';
  els.win.style.minWidth = '300px';
  els.win.style.minHeight = '420px';
  els.win.style.maxWidth = '96vw';
  els.win.style.maxHeight = '92vh';
  els.win.style.borderRadius = '24px';
  els.win.style.boxShadow = '0 0 60px rgba(0, 0, 0, 0.08), 0 8px 28px rgba(29, 31, 28, 0.09)';
  els.win.style.resize = 'both';
  els.win.style.zIndex = '9992';
  els.max.textContent = '⛶';
  isPanel = false;
}

function togglePanel() {
  if (isPanel) applyFloating();
  else applyPanel();
}

function onHeaderDragStart(event) {
  if (event.target.closest('#lotus-agent-close, #lotus-agent-max')) return;
  if (isPanel) return;
  const rect = els.win.getBoundingClientRect();
  els.win.style.transform = 'none';
  els.win.style.left = rect.left + 'px';
  els.win.style.top = rect.top + 'px';
  els.win.style.width = rect.width + 'px';
  els.win.style.height = rect.height + 'px';
  const startX = event.clientX;
  const startY = event.clientY;
  const baseLeft = rect.left;
  const baseTop = rect.top;
  const width = rect.width;
  const height = rect.height;
  function onMove(move) {
    const left = Math.min(Math.max(baseLeft + move.clientX - startX, -(width - 120)), window.innerWidth - 60);
    const top = Math.min(Math.max(baseTop + move.clientY - startY, 0), window.innerHeight - 80);
    els.win.style.left = left + 'px';
    els.win.style.top = top + 'px';
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function renderMessages() {
  if (history.length === 0) {
    history.push({
      role: 'assistant',
      text: `أنا ${settings.agentName}. إيجنت حقيقي داخل Luker، مو خط أنابيب خفي: عندي دردشتي الخاصة، وأتذكر من الـgraph. اسألني، وأنا أجاوبك — وإذا تريد أحفظ شي من ردي، دوس "تذكّر هذا" تحت الرسالة.`,
    });
    saveHistory();
  }
  els.messages.innerHTML = '';
  history.forEach((msg, index) => {
    const div = document.createElement('div');
    div.className = `lotus-agent-msg ${msg.role}`;
    const body = document.createElement('div');
    body.className = 'lotus-agent-body';
    body.innerHTML = escapeHtml(msg.text).replace(/\n/g, '<br>');
    if (msg.role === 'assistant') {
      div.style.cssText = 'display:flex;gap:10px;align-self:flex-start;max-width:100%;';
      const avatar = document.createElement('div');
      avatar.className = 'lotus-agent-mini-avatar';
      avatar.innerHTML = LOTUS_SVG_WHITE;
      avatar.style.cssText = 'width:28px;height:28px;border-radius:50%;background:#bc451f;display:grid;place-items:center;flex-shrink:0;margin-top:2px;';
      avatar.querySelector('svg').style.cssText = 'width:15px;height:15px;';
      const content = document.createElement('div');
      content.className = 'lotus-agent-content';
      content.style.cssText = 'min-width:0;';
      body.style.cssText = 'font-size:15.5px;line-height:1.75;white-space:pre-wrap;word-break:break-word;color:#1d1f1c;padding-top:3px;';
      content.appendChild(body);
      div.appendChild(avatar);
      div.appendChild(content);
    } else {
      div.style.cssText = 'align-self:flex-end;max-width:85%;';
      body.style.cssText = 'background:#23261f;color:#f4f4ec;padding:10px 16px;border-radius:22px;border-bottom-right-radius:6px;line-height:1.65;font-size:15.5px;white-space:pre-wrap;word-break:break-word;';
      div.appendChild(body);
    }
    if (msg.role === 'assistant' && index > 0) {
      const btn = document.createElement('button');
      btn.className = 'lotus-agent-remember';
      btn.textContent = msg.saved ? 'تم الحفظ' : 'تذكّر هذا';
      btn.disabled = !!msg.saved;
      btn.style.cssText = 'display:inline-block;margin-top:8px;background:#ffffff;border:1px solid rgba(29,31,28,0.09);border-radius:999px;box-shadow:0 4px 14px rgba(29,31,28,0.08);cursor:pointer;font-size:13px;color:#1d1f1c;padding:7px 14px;';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'جارٍ الحفظ...';
        try {
          await rememberText(msg.text);
          msg.saved = true;
          btn.textContent = 'تم الحفظ';
          saveHistory();
        } catch (error) {
          btn.disabled = false;
          btn.textContent = 'فشل الحفظ — أعد المحاولة';
        }
      });
      div.querySelector('.lotus-agent-content').appendChild(btn);
    }
    els.messages.appendChild(div);
  });
  els.messages.scrollTop = els.messages.scrollHeight;
}

function pushMessage(role, text) {
  history.push({ role, text });
  saveHistory();
  renderMessages();
}

// ---- Send: runs ONLY when the window is open (spend rule) ----

async function onSend() {
  const text = els.input.value.trim();
  if (!text || busy) return;
  busy = true;
  els.send.disabled = true;
  els.input.value = '';
  els.input.style.height = 'auto';
  pushMessage('user', text);

  const typing = document.createElement('div');
  typing.className = 'lotus-agent-typing';
  typing.textContent = `${settings.agentName} يكتب...`;
  els.messages.appendChild(typing);
  els.messages.scrollTop = els.messages.scrollHeight;

  try {
    const context = getContext();
    if (!context || typeof context.generateTask !== 'function') {
      throw new Error('generation unavailable');
    }

    const briefs = await recallBriefs(text);
    const systemLines = [
      `You are ${settings.agentName}, a real agent living inside Luker. You have your own chat window and a memory graph. Answer in the user's language. Be direct and useful; say plainly when you do not know something.`,
    ];
    if (briefs.length) {
      systemLines.push('Relevant memories from the graph (use them, do not recite them as a list):');
      briefs.forEach((brief) => systemLines.push(`- ${brief}`));
    }

    const recent = history.slice(-CONTEXT_WINDOW).map((msg) => ({
      role: msg.role,
      content: msg.text,
    }));

    const result = await context.generateTask({
      taskMessages: [
        { role: 'system', content: systemLines.join('\n') },
        ...recent,
        { role: 'user', content: text },
      ],
      includeCharacterCard: false,
      worldInfoSource: 'none',
      apiPresetName: settings.chatPreset || '',
      llmPresetName: settings.memoryPreset || '',
      tools: null,
      toolChoice: 'none',
    });

    typing.remove();
    const reply = result?.assistantText || 'وصل رد فارغ من النموذج — جرّب مرة ثانية.';
    pushMessage('assistant', reply);

    if (settings.autoExtract) {
      try {
        await rememberText(reply);
      } catch { /* auto-extract failure must never break the reply */ }
    }
  } catch (error) {
    typing.remove();
    pushMessage('assistant', 'ما قدرت أوصل لمحرك التوليد هسه — تأكد من اتصال المزوّد والبريست، وجرّب مرة ثانية.');
  } finally {
    busy = false;
    els.send.disabled = false;
    els.input.focus();
  }
}

// ---- Settings drawer (inside Luker's extension settings area) ----

function buildSettingsDrawer() {
  const host = document.querySelector('#extensions_settings');
  if (!host) return;
  const drawer = document.createElement('div');
  drawer.className = 'lotus-agent-settings';
  drawer.setAttribute('data-extension-name', EXTENSION_NAME);
  drawer.innerHTML = `
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>Lotus — إيجنت داخل Luker</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down"></div>
      </div>
      <div class="inline-drawer-content">
        <label>اسم الإيجنت
          <input type="text" id="lotus-agent-set-name" value="${escapeHtml(settings.agentName)}">
        </label>
        <label>بروفايل الاتصال للدردشة (اختر من المحفوظة — البروفايل = المزوّد + النموذج + المفتاح)
          <select id="lotus-agent-set-chat"></select>
        </label>
        <p id="lotus-agent-profiles-note" style="opacity:0.7;font-size:12px"></p>
        <label>بريست رخيص لشغل الذاكرة (اختر من المحفوظة — البريست = طريقة التوليد)
          <select id="lotus-agent-set-memory"></select>
        </label>
        <label>
          <input type="checkbox" id="lotus-agent-set-memory-on" ${settings.memoryEnabled ? 'checked' : ''}>
          تفعيل الذاكرة (استرجاع قبل الرد)
        </label>
        <label>
          <input type="checkbox" id="lotus-agent-set-auto" ${settings.autoExtract ? 'checked' : ''}>
          حفظ تلقائي بعد كل رد (مطفأ افتراضياً — الحفظ اليدوي أأمن)
        </label>
        <p style="opacity:0.7;font-size:12px">قاعدة الصرف: الإيجنت يشتغل بس من تنفتح نافذته — ما يستهلك شي وهو مسكر. تاريخ الدردشة ينحفظ محلياً (إعدادات الإضافة + ذاكرة المتصفح)؛ التخزين بملف سيرفر خاص خيار لاحق.</p>
      </div>
    </div>`;
  host.appendChild(drawer);

  drawer.querySelector('#lotus-agent-set-name').addEventListener('change', (e) => {
    settings.agentName = e.target.value.trim() || 'Lotus';
    if (els.name) els.name.textContent = settings.agentName;
    saveSettings();
  });
  drawer.querySelector('#lotus-agent-set-chat').addEventListener('change', (e) => {
    settings.chatPreset = e.target.value;
    saveSettings();
  });
  drawer.querySelector('#lotus-agent-set-memory').addEventListener('change', (e) => {
    settings.memoryPreset = e.target.value;
    saveSettings();
  });

  // Populate the dropdowns from Luker's own saved lists (v0.1.1: no more
  // blind typing). Refreshed on load and whenever the drawer is opened,
  // so a profile saved after load still shows up.
  const refreshProfileSelects = () => {
    const chatSel = drawer.querySelector('#lotus-agent-set-chat');
    const memSel = drawer.querySelector('#lotus-agent-set-memory');
    const note = drawer.querySelector('#lotus-agent-profiles-note');
    const fill = (sel, names, current) => {
      const seen = new Set(['']);
      sel.innerHTML = '';
      const currentOpt = document.createElement('option');
      currentOpt.value = '';
      currentOpt.textContent = '(الحالي)';
      sel.appendChild(currentOpt);
      seen.add('');
      const all = [...names];
      if (current && !all.includes(current)) all.push(current);
      all.forEach((name) => {
        if (!name || seen.has(name)) return;
        seen.add(name);
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
      });
      sel.value = current || '';
    };
    try {
      const context = getContext();
      const profiles = context?.connectionProfiles?.list?.() || [];
      const profileNames = profiles.map((p) => p?.name).filter(Boolean);
      fill(chatSel, profileNames, settings.chatPreset);
      note.textContent = profileNames.length === 0
        ? 'ما كو بروفايلات محفوظة بعد — احفظ واحد من Connection Profile أولاً، وبعدين ارجع افتح هالدرج واختاره.'
        : '';
    } catch {
      fill(chatSel, [], settings.chatPreset);
    }
    try {
      const context = getContext();
      const presets = context?.presets?.list?.('openai') || [];
      const presetNames = presets.map((p) => p?.name).filter(Boolean);
      fill(memSel, presetNames, settings.memoryPreset);
    } catch {
      fill(memSel, [], settings.memoryPreset);
    }
  };
  refreshProfileSelects();
  const toggle = drawer.querySelector('.inline-drawer-toggle');
  if (toggle) toggle.addEventListener('click', () => setTimeout(refreshProfileSelects, 0));
  drawer.querySelector('#lotus-agent-set-memory-on').addEventListener('change', (e) => {
    settings.memoryEnabled = e.target.checked;
    saveSettings();
  });
  drawer.querySelector('#lotus-agent-set-auto').addEventListener('change', (e) => {
    settings.autoExtract = e.target.checked;
    saveSettings();
  });
}

// ---- Entry point: the agents' OWN icon in the icons row ----
// v0.1.2 put the button in #top-bar, but #top-bar is a separate empty
// bar layered over the icons — so the lotus sat ON TOP of the first
// icon. The real icons row is #top-settings-holder (flex, centered):
// the button joins it as a flex item, beside the icons, not over one.
// Fallback chain: icons row → #top-bar → floating button.

function injectTopIcon() {
  const row = document.querySelector('#top-settings-holder') || document.querySelector('#top-bar');
  if (!row) return false;
  if (document.querySelector('#lotus-agent-top-icon')) return true;
  const btn = document.createElement('button');
  btn.id = 'lotus-agent-top-icon';
  btn.className = 'lotus-agent-top-icon';
  btn.title = settings.agentName;
  btn.innerHTML = LOTUS_SVG;
  btn.style.background = 'transparent';
  btn.style.border = 'none';
  btn.style.cursor = 'pointer';
  btn.style.padding = '6px';
  btn.style.display = 'inline-flex';
  btn.style.alignItems = 'center';
  btn.style.justifyContent = 'center';
  const svg = btn.querySelector('svg');
  if (svg) {
    svg.style.width = '26px';
    svg.style.height = '26px';
  }
  btn.addEventListener('click', toggleWindow);
  row.appendChild(btn);
  return true;
}

function buildFabFallback() {
  if (document.querySelector('#lotus-agent-top-icon')) return;
  const fab = document.createElement('button');
  fab.className = 'lotus-agent-fab';
  fab.title = settings.agentName;
  fab.innerHTML = LOTUS_SVG;
  fab.style.position = 'fixed';
  fab.style.left = '16px';
  fab.style.bottom = '96px';
  fab.style.width = '56px';
  fab.style.height = '56px';
  fab.style.zIndex = '9990';
  fab.style.borderRadius = '50%';
  fab.style.display = 'flex';
  fab.style.alignItems = 'center';
  fab.style.justifyContent = 'center';
  fab.addEventListener('click', toggleWindow);
  document.body.appendChild(fab);
}

function buildEntry() {
  if (injectTopIcon()) {
    const row = document.querySelector('#top-settings-holder') || document.querySelector('#top-bar');
    if (row && typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => {
        if (!document.querySelector('#lotus-agent-top-icon')) injectTopIcon();
      });
      observer.observe(row, { childList: true });
    }
    return;
  }
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (injectTopIcon() || attempts >= 20) {
      clearInterval(timer);
      if (!document.querySelector('#lotus-agent-top-icon')) buildFabFallback();
    }
  }, 500);
}

// ---- Entry ----

jQuery(async () => {
  loadSettings();
  buildWindow();
  buildEntry();
  buildSettingsDrawer();
});
