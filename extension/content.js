const API = 'http://127.0.0.1:19840';

let panelVisible = false;
let panelEl = null;
let badgeEl = null;

function inject() {
  if (document.getElementById('daybrain-root')) return;

  const root = document.createElement('div');
  root.id = 'daybrain-root';
  root.innerHTML = getStyles() + getButton() + getPanel();
  document.body.appendChild(root);

  badgeEl = document.getElementById('daybrain-badge');
  panelEl = document.getElementById('daybrain-panel');

  document.getElementById('daybrain-btn').addEventListener('click', toggle);
  document.addEventListener('click', (e) => {
    if (panelVisible && !e.target.closest('#daybrain-root')) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelVisible) close();
  });

  loadBadge();
  setInterval(loadBadge, 30000);
}

function getStyles() {
  return `<style>
    #daybrain-btn {
      position: fixed; bottom: 20px; right: 20px; z-index: 2147483646;
      width: 44px; height: 44px; border-radius: 50%;
      background: #1a1a2e; border: 1px solid #333;
      color: #e0e0e0; cursor: pointer; font-size: 20px;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 12px rgba(0,0,0,0.3);
      transition: all 0.2s; user-select: none;
    }
    #daybrain-btn:hover { transform: scale(1.08); border-color: #667eea; }
    #daybrain-badge {
      position: absolute; top: -4px; right: -4px;
      background: #667eea; color: white; font-size: 9px; font-weight: 700;
      padding: 1px 5px; border-radius: 8px; min-width: 18px; text-align: center;
      display: none; line-height: 14px;
    }
    #daybrain-panel {
      position: fixed; bottom: 72px; right: 20px; z-index: 2147483647;
      width: 320px; max-height: 480px; overflow-y: auto;
      background: #1a1a2e; border: 1px solid #333; border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 12px; color: #c9d1d9;
      display: none; transition: opacity 0.15s;
    }
    #daybrain-panel.visible { display: block; }
    #daybrain-panel::-webkit-scrollbar { width: 5px; }
    #daybrain-panel::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
    .db-header {
      padding: 14px 16px 10px; border-bottom: 1px solid #222;
      display: flex; align-items: center; justify-content: space-between;
      font-weight: 700; font-size: 14px; position: sticky; top: 0;
      background: #1a1a2e; z-index: 1;
    }
    .db-body { padding: 12px 16px; }
    .db-stat-row { display: flex; gap: 8px; margin-bottom: 12px; }
    .db-stat {
      flex: 1; background: #222; border-radius: 8px; padding: 10px; text-align: center;
    }
    .db-stat .val { font-size: 18px; font-weight: 700; color: #667eea; }
    .db-stat .lbl { font-size: 10px; color: #888; margin-top: 2px; }
    .db-app-row { display: flex; align-items: center; margin-bottom: 4px; gap: 8px; }
    .db-app-row .name { width: 70px; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .db-app-row .bar { flex: 1; height: 4px; background: #222; border-radius: 2px; }
    .db-app-row .bar .fill { height: 4px; border-radius: 2px; background: linear-gradient(90deg, #667eea, #764ba2); }
    .db-app-row .time { font-size: 10px; color: #888; width: 32px; text-align: right; }
    .db-section { font-size: 11px; font-weight: 600; color: #888; margin: 14px 0 8px; }
    .db-insight {
      padding: 8px 10px; background: #222; border-radius: 8px; margin-bottom: 6px;
      font-size: 11px; line-height: 1.4;
    }
    .db-insight .t { font-weight: 600; margin-bottom: 2px; }
    .db-insight .d { color: #888; font-size: 10px; }
    .db-btn {
      display: block; width: 100%; padding: 8px; border: 1px solid #333; border-radius: 8px;
      background: transparent; color: #c9d1d9; font-size: 11px; cursor: pointer;
      text-align: center; margin-top: 8px;
    }
    .db-btn.primary {
      background: linear-gradient(135deg, #667eea, #764ba2);
      border: none; color: white; font-weight: 600; margin-top: 14px;
    }
    .db-btn:hover { opacity: 0.9; }
    .db-empty { text-align: center; padding: 30px 0; color: #666; font-size: 12px; }
    .db-close {
      background: none; border: none; color: #666; font-size: 16px;
      cursor: pointer; padding: 2px 4px; line-height: 1;
    }
    .db-close:hover { color: #c9d1d9; }
  </style>`;
}

function getButton() {
  return `<div id="daybrain-btn" title="DayBrain — Your AI's memory">
    🧠<span id="daybrain-badge"></span>
  </div>`;
}

function getPanel() {
  return `<div id="daybrain-panel">
    <div class="db-header">
      <span>🧠 DayBrain</span>
      <button class="db-close" id="daybrain-close">✕</button>
    </div>
    <div class="db-body" id="daybrain-body">
      <div class="db-empty">Loading...</div>
    </div>
  </div>`;
}

async function toggle() {
  panelVisible = !panelVisible;
  panelEl.classList.toggle('visible', panelVisible);
  if (panelVisible) await loadPanel();
}

function close() {
  panelVisible = false;
  panelEl.classList.remove('visible');
}

async function loadBadge() {
  try {
    const res = await fetch(`${API}/summary`);
    const data = await res.json();
    if (data.active_time > 0 && badgeEl) {
      const mins = data.active_time;
      badgeEl.textContent = mins > 99 ? '99+' : String(mins);
      badgeEl.style.display = 'block';
    }
  } catch {}
}

async function loadPanel() {
  const body = document.getElementById('daybrain-body');
  if (!body) return;

  try {
    const res = await fetch(`${API}/summary`);
    const data = await res.json();
    render(body, data);
  } catch {
    body.innerHTML = `<div class="db-empty">
      <div style="font-size:24px;margin-bottom:8px;">⚠</div>
      <div>Server not running</div>
      <div style="font-size:10px;color:#555;margin-top:4px;">npx daybrain</div>
    </div>`;
  }
}

function render(body, data) {
  if (data.active_time === 0) {
    body.innerHTML = `<div class="db-empty">
      <div style="font-size:28px;margin-bottom:6px;">☀</div>
      <div>No activity yet</div>
    </div>`;
    return;
  }

  let h = '';

  // Stats row
  h += `<div class="db-stat-row">
    <div class="db-stat"><div class="val">${data.active_time}m</div><div class="lbl">active</div></div>
    <div class="db-stat"><div class="val">${data.switch_count}</div><div class="lbl">switches</div></div>
    <div class="db-stat"><div class="val">${data.insights?.length||0}</div><div class="lbl">insights</div></div>
  </div>`;

  // Top apps
  if (data.top_apps?.length) {
    h += `<div class="db-section">Top apps</div>`;
    data.top_apps.slice(0, 4).forEach(a => {
      const pct = Math.round(a.percentage || 0);
      h += `<div class="db-app-row">
        <span class="name">${esc(a.app)}</span>
        <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
        <span class="time">${a.minutes}m</span>
      </div>`;
    });
  }

  // Insights
  if (data.insights?.length) {
    h += `<div class="db-section">Insights</div>`;
    data.insights.slice(0, 4).forEach(i => {
      const e = i.type === 'commitment' ? '🤝' : i.type === 'avoidance' ? '👀' : '💡';
      h += `<div class="db-insight">
        <div class="t">${e} ${esc(i.title||'').slice(0,60)} <span style="color:#667eea;font-size:10px">${i.confidence}%</span></div>
        <div class="d">${esc(i.description||'').slice(0,100)}</div>
      </div>`;
    });
  }

  // Actions
  h += `<button class="db-btn primary" id="daybrain-inject">📋 Inject context into chat</button>`;
  h += `<button class="db-btn" id="daybrain-refresh">🔄 Refresh</button>`;

  body.innerHTML = h;

  document.getElementById('daybrain-inject')?.addEventListener('click', injectContext);
  document.getElementById('daybrain-refresh')?.addEventListener('click', loadPanel);
  document.getElementById('daybrain-close')?.addEventListener('click', close);
}

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function injectContext() {
  try {
    const res = await fetch(`${API}/context`);
    const data = await res.json();
    if (!data.text) {
      showToast('No context yet. Activity will appear as you browse.');
      return;
    }

    const el = findChatInput();
    if (el) {
      const existing = el.value || el.textContent || '';
      el.value = existing ? existing + '\n\n' + data.text : data.text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.focus();
    } else {
      await navigator.clipboard.writeText(data.text);
      showToast('Copied — paste into chat');
    }
    close();
  } catch {
    showToast('Server not running. Start: npx daybrain');
  }
}

function findChatInput() {
  let el = document.querySelector('[contenteditable="true"].ProseMirror');
  if (el) return el;
  el = document.querySelector('#prompt-textarea');
  if (el) return el;
  el = document.querySelector('[contenteditable="true"][role="textbox"]');
  if (el) return el;
  const textareas = document.querySelectorAll('textarea');
  for (const ta of textareas) {
    if (ta.offsetHeight > 40 && ta.offsetWidth > 200) return ta;
  }
  return null;
}

function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position:'fixed',bottom:'20px',left:'50%',transform:'translateX(-50%)',
    background:'#333',color:'#fff',padding:'8px 16px',borderRadius:'8px',
    fontSize:'12px',zIndex:'2147483647',boxShadow:'0 4px 12px rgba(0,0,0,0.3)',
    transition:'opacity 0.3s',
  });
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; setTimeout(() => t.remove(),300); }, 2000);
}

// Init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inject);
} else {
  inject();
}

// --- Chat bar inject button ---
function injectChatButton() {
  if (document.getElementById('daybrain-chat-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'daybrain-chat-btn';
  btn.innerHTML = '🧠';
  btn.title = 'Share your day with the AI';
  Object.assign(btn.style, {
    background: 'transparent', border: 'none', cursor: 'pointer',
    fontSize: '18px', padding: '4px', marginRight: '4px',
    opacity: '0.7', transition: 'opacity 0.2s', borderRadius: '4px',
    lineHeight: '1',
  });
  btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
  btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.7'; });
  btn.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    await injectContext();
  });

  // Try to find the chat input area and prepend the button
  const tryInject = () => {
    // Claude.ai: the toolbar above the input
    const claudeToolbar = document.querySelector('[class*="flex"][class*="items-center"]:has([contenteditable])');
    if (claudeToolbar && !document.getElementById('daybrain-chat-btn')) {
      const firstChild = claudeToolbar.firstChild;
      if (firstChild) firstChild.before(btn);
      return true;
    }
    // ChatGPT: the area around the textarea
    const gptArea = document.querySelector('#prompt-textarea')?.parentElement?.parentElement;
    if (gptArea && !document.getElementById('daybrain-chat-btn')) {
      const toolbar = gptArea.querySelector('[class*="flex"]');
      if (toolbar) toolbar.prepend(btn);
      return true;
    }
    return false;
  };

  if (!tryInject()) {
    // DOM not ready yet, retry
    setTimeout(() => { if (!tryInject()) setTimeout(tryInject, 2000); }, 1000);
  }
}

setTimeout(injectChatButton, 2000);
setTimeout(injectChatButton, 5000);

// Toggle from popup
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'toggle-sidebar') toggle();
});
