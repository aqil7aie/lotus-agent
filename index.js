// Lotus agent extension for Luker — v0.1.0
// A real agent with its own chat window, connected to the Memory Graph.
// Spec (Aqil): extension, not a fork; Lotus window, not ST's window;
// agent-specific icon; runs only when opened (spend rule); memory work
// on a cheap preset. v0.1: recall-before-reply is automatic, writes to
// the graph are explicit (per-message button, or the auto-extract toggle).

import { extension_settings, getContext } from '../../../extensions.js';

const EXTENSION_NAME = 'lotus-agent';
const HISTORY_KEY = 'lotus-agent-history-v1';
const HISTORY_LIMIT = 100;
const CONTEXT_WINDOW = 20;

const LOTUS_SVG = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g fill="#e8730c"><ellipse cx="24" cy="26" rx="6" ry="12"/><ellipse cx="12" cy="28" rx="5" ry="10" transform="rotate(-28 12 28)"/><ellipse cx="36" cy="28" rx="5" ry="10" transform="rotate(28 36 28)"/><ellipse cx="6" cy="32" rx="4" ry="8" transform="rotate(-48 6 32)"/><ellipse cx="42" cy="32" rx="4" ry="8" transform="rotate(48 42 32)"/></g></svg>`;

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
  if (els.status) els.status.textContent = text;
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
  const backdrop = document.createElement('div');
  backdrop.className = 'lotus-agent-backdrop';
  backdrop.id = 'lotus-agent-backdrop';
  // Critical geometry inline: the button/window must position even if
  // style.css fails to load for any reason (v0.1.1 hardening).
  backdrop.style.position = 'fixed';
  backdrop.style.inset = '0';
  backdrop.style.zIndex = '9991';

  const win = document.createElement('div');
  win.className = 'lotus-agent-window';
  win.id = 'lotus-agent-window';
  win.style.position = 'fixed';
  win.style.left = '12px';
  win.style.right = '12px';
  win.style.top = '12px';
  win.style.bottom = '12px';
  win.style.zIndex = '9992';
  win.innerHTML = `
    <div class="lotus-agent-pill">
      <div class="lotus-agent-avatar">${LOTUS_SVG}</div>
      <div class="lotus-agent-name" id="lotus-agent-name"></div>
      <div class="lotus-agent-status" id="lotus-agent-status">الذاكرة: ...</div>
      <button class="lotus-agent-close" id="lotus-agent-close" title="إغلاق">×</button>
    </div>
    <div class="lotus-agent-messages" id="lotus-agent-messages"></div>
    <div class="lotus-agent-composer">
      <textarea class="lotus-agent-input" id="lotus-agent-input" rows="1" placeholder="اكتب رسالتك..."></textarea>
      <button class="lotus-agent-send" id="lotus-agent-send" title="إرسال">➤</button>
    </div>`;

  document.body.appendChild(backdrop);
  document.body.appendChild(win);

  els = {
    backdrop,
    win,
    name: win.querySelector('#lotus-agent-name'),
    status: win.querySelector('#lotus-agent-status'),
    messages: win.querySelector('#lotus-agent-messages'),
    input: win.querySelector('#lotus-agent-input'),
    send: win.querySelector('#lotus-agent-send'),
  };

  els.name.textContent = settings.agentName;
  els.close = win.querySelector('#lotus-agent-close');
  els.close.addEventListener('click', closeWindow);
  backdrop.addEventListener('click', closeWindow);
  els.send.addEventListener('click', onSend);
  els.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  });
  els.input.addEventListener('input', () => {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 120) + 'px';
  });

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
  fab.addEventListener('click', openWindow);
  document.body.appendChild(fab);
}

function openWindow() {
  els.backdrop.classList.add('open');
  els.win.classList.add('open');
  renderMessages();
  els.input.focus();
  getMemorySession().then((session) => {
    setMemoryStatus(session ? 'الذاكرة: متصلة' : 'الذاكرة: غير متاحة');
  });
}

function closeWindow() {
  els.backdrop.classList.remove('open');
  els.win.classList.remove('open');
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
    div.innerHTML = escapeHtml(msg.text).replace(/\n/g, '<br>');
    if (msg.role === 'assistant' && index > 0) {
      const btn = document.createElement('button');
      btn.className = 'lotus-agent-remember';
      btn.textContent = msg.saved ? 'تم الحفظ' : 'تذكّر هذا';
      btn.disabled = !!msg.saved;
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
      div.appendChild(btn);
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

// ---- Entry ----

jQuery(async () => {
  loadSettings();
  buildWindow();
  buildSettingsDrawer();
});
