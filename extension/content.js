const API = 'http://127.0.0.1:19840';

let panelVisible = false;
let panelEl = null;

function inject() {
  if (document.getElementById('daybrain-root')) return;

  const root = document.createElement('div');
  root.id = 'daybrain-root';
  root.innerHTML = getStyles() + getPanel();
  document.body.appendChild(root);

  panelEl = document.getElementById('daybrain-panel');

  document.addEventListener('click', (e) => {
    if (panelVisible && !e.target.closest('#daybrain-root')) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelVisible) close();
  });

  injectChatButton();
  setTimeout(injectChatButton, 3000);
  setTimeout(injectChatButton, 8000);
}

function getStyles() {
  return `<style>
    #daybrain-panel {
      position: fixed; bottom: 16px; right: 20px; z-index: 2147483647;
      width: 320px; background: #fff; border: 1px solid #dadce0;
      border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 4px 16px rgba(0,0,0,.12);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px; color: #202124; display: none;
      overflow: hidden; transition: opacity .15s;
    }
    #daybrain-panel.visible { display: block; }
    #daybrain-panel.dark { background: #202124; border-color: #3c4043; color: #e8eaed; }
    #daybrain-panel.dark .db-section { color: #9aa0a6; }
    #daybrain-panel.dark .db-card { background: #303134; }
    #daybrain-panel.dark .db-insight { background: #303134; }
    #daybrain-panel.dark .db-close { color: #9aa0a6; }
    .db-header {
      padding: 12px 16px; display: flex; align-items: center; justify-content: space-between;
      font-weight: 500; font-size: 14px; border-bottom: 1px solid #e8eaed;
    }
    .db-header.dark-border { border-color: #3c4043; }
    .db-body { padding: 12px 16px 16px; }
    .db-card {
      background: #f8f9fa; border-radius: 12px; padding: 12px 14px;
      margin-bottom: 10px; display: flex; gap: 16px;
    }
    .db-card .num { font-size: 22px; font-weight: 500; line-height: 1; color: #1a73e8; }
    .db-card .label { font-size: 11px; color: #5f6368; margin-top: 2px; }
    .db-section { font-size: 11px; font-weight: 500; color: #5f6368; margin: 2px 0 6px; letter-spacing: .3px; }
    .db-insight {
      padding: 10px 12px; border-radius: 10px; margin-bottom: 6px;
      background: #f8f9fa; font-size: 12px; line-height: 1.4;
    }
    .db-insight .t { font-weight: 500; margin-bottom: 2px; }
    .db-insight .d { color: #5f6368; font-size: 11px; }
    .db-pill {
      display: inline-block; background: #e8f0fe; color: #1a73e8;
      font-size: 10px; font-weight: 500; padding: 1px 6px; border-radius: 8px;
      margin-left: 6px;
    }
    .db-btn {
      display: block; width: 100%; padding: 9px; border: none; border-radius: 8px;
      font-size: 13px; font-weight: 500; cursor: pointer; text-align: center;
      background: #1a73e8; color: white; margin-top: 10px;
      transition: box-shadow .15s;
    }
    .db-btn:hover { box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 2px 8px rgba(26,115,232,.3); }
    .db-btn.secondary {
      background: transparent; color: #1a73e8; margin-top: 6px; font-size: 12px;
    }
    .db-btn.secondary:hover { background: #f1f3f4; box-shadow: none; }
    .db-empty { text-align: center; padding: 24px 0; color: #5f6368; font-size: 13px; }
    .db-close { background: none; border: none; color: #5f6368; cursor: pointer; font-size: 18px; padding: 2px; line-height: 1; }
    .db-close:hover { color: #202124; }
    .db-fab {
      position: fixed; bottom: 20px; right: 20px; z-index: 2147483646;
      width: 40px; height: 40px; border-radius: 50%;
      background: #fff; border: 1px solid #dadce0; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 1px 3px rgba(0,0,0,.08); font-size: 18px;
      transition: box-shadow .15s;
    }
    .db-fab:hover { box-shadow: 0 2px 6px rgba(0,0,0,.15); }
    .db-fab .db-badge {
      position: absolute; top: -4px; right: -4px;
      background: #1a73e8; color: white; font-size: 9px; font-weight: 500;
      padding: 1px 5px; border-radius: 8px; min-width: 16px; text-align: center;
      display: none; line-height: 14px;
    }
    .db-toast {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: #202124; color: white; padding: 8px 18px; border-radius: 8px;
      font-size: 12px; z-index: 2147483647; box-shadow: 0 2px 8px rgba(0,0,0,.2);
      transition: opacity .3s;
    }
  </style>`;
}

function getPanel() {
  return `
  <div class="db-fab" id="daybrain-fab" title="Your day in context">
    <img src="${chrome.runtime.getURL('icons/icon48.png')}" width="24" height="24" style="border-radius:5px">
    <span class="db-badge" id="daybrain-badge"></span>
  </div>
  <div id="daybrain-panel">
    <div class="db-header">
      <span>Your day</span>
      <button class="db-close" id="daybrain-close">×</button>
    </div>
    <div class="db-body" id="daybrain-body">
      <div class="db-empty">Loading…</div>
    </div>
  </div>`;
}

function injectChatButton() {
  if (document.getElementById('daybrain-chat-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'daybrain-chat-btn';
  btn.innerHTML = '🧠';
  btn.title = 'Tell Claude about your day';
  btn.type = 'button';
  Object.assign(btn.style, {
    background: 'transparent', border: 'none', cursor: 'pointer',
    fontSize: '16px', padding: '4px 6px', marginRight: '2px',
    opacity: '.55', borderRadius: '4px', transition: 'opacity .15s',
  });
  btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
  btn.addEventListener('mouseleave', () => { btn.style.opacity = '.55'; });
  btn.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    await injectContext();
  });

  const place = () => {
    if (document.getElementById('daybrain-chat-btn')) return;
    // Claude: toolbar above the input
    const claude = document.querySelector('[contenteditable]')?.closest('[class*="flex"]');
    if (claude) {
      const first = claude.firstElementChild;
      if (first) first.before(btn);
      return;
    }
    // ChatGPT: bottom toolbar
    const gptBox = document.querySelector('#prompt-textarea');
    if (gptBox) {
      const toolbar = gptBox.closest('form') || gptBox.parentElement?.parentElement;
      if (toolbar) {
        const row = toolbar.querySelector('[class*="flex"]') || toolbar;
        row.prepend(btn);
      }
    }
  };
  place();
}

// --- Panel ---
async function toggle() {
  panelVisible = !panelVisible;
  panelEl.classList.toggle('visible', panelVisible);
  if (panelVisible) {
    await loadPanel();
    // Detect dark mode
    const isDark = document.documentElement.classList.contains('dark') ||
      document.body.classList.contains('dark') ||
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (isDark) {
      panelEl.classList.add('dark');
      panelEl.querySelector('.db-header')?.classList.add('dark-border');
    }
  }
}

function close() {
  panelVisible = false;
  panelEl.classList.remove('visible');
}

// --- Data ---
async function loadBadge() {
  try {
    const res = await fetch(`${API}/summary`);
    const data = await res.json();
    const badge = document.getElementById('daybrain-badge');
    if (data.active_time > 0 && badge) {
      badge.textContent = data.active_time > 99 ? '99+' : String(data.active_time);
      badge.style.display = 'block';
    }
  } catch {}
}

async function loadPanel() {
  const body = document.getElementById('daybrain-body');
  if (!body) return;
  try {
    const res = await fetch(`${API}/summary`);
    render(body, await res.json());
  } catch {
    body.innerHTML = `<div class="db-empty">Server not running.<br><span style="font-size:11px;color:#80868b">Start: npx daybrain</span></div>`;
  }
}

function render(body, data) {
  if (!data.active_time) {
    body.innerHTML = `<div class="db-empty">No activity yet today</div>`;
    return;
  }

  const top3 = (data.top_apps || []).slice(0, 3);
  const insights = (data.insights || []).slice(0, 3);

  let h = '';

  // Stat cards
  h += `<div class="db-card">
    <div style="flex:1;text-align:center"><div class="num">${data.active_time}m</div><div class="label">active</div></div>
    <div style="flex:1;text-align:center"><div class="num">${data.switch_count}</div><div class="label">switches</div></div>
    <div style="flex:1;text-align:center"><div class="num">${insights.length}</div><div class="label">caught</div></div>
  </div>`;

  // Top apps
  if (top3.length) {
    h += `<div class="db-section">TOP APPS</div>`;
    top3.forEach(a => {
      h += `<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px;color:#5f6368">
        <span>${esc(a.app)}</span><span style="font-weight:500;color:#202124">${a.minutes}m</span>
      </div>`;
    });
  }

  // Insights
  if (insights.length) {
    h += `<div class="db-section" style="margin-top:10px">THINGS YOU SAID</div>`;
    insights.forEach(i => {
      const pct = i.confidence || 0;
      h += `<div class="db-insight">
        <div class="t">${esc(i.title || '').slice(0,70)}<span class="db-pill">${pct}%</span></div>
        <div class="d">${esc(i.description || '').slice(0,90)}</div>
      </div>`;
    });
  }

  h += `<button class="db-btn" id="daybrain-inject">Share with Claude</button>`;
  h += `<button class="db-btn secondary" id="daybrain-refresh">Refresh</button>`;

  body.innerHTML = h;

  document.getElementById('daybrain-fab')?.addEventListener('click', toggle);
  document.getElementById('daybrain-inject')?.addEventListener('click', injectContext);
  document.getElementById('daybrain-refresh')?.addEventListener('click', loadPanel);
  document.getElementById('daybrain-close')?.addEventListener('click', close);

  loadBadge();
}

function esc(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

async function injectContext() {
  try {
    const res = await fetch(`${API}/context`);
    const data = await res.json();
    if (!data.text) { toast('No activity yet'); return; }

    const el = findChatInput();
    if (el) {
      const existing = el.value || el.textContent || '';
      el.value = existing ? existing + '\n\n' + data.text : data.text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.focus();
      toast('Shared with Claude');
    } else {
      await navigator.clipboard.writeText(data.text);
      toast('Copied — paste into chat');
    }
    close();
  } catch { toast('Server not running'); }
}

function findChatInput() {
  return document.querySelector('[contenteditable].ProseMirror') ||
    document.querySelector('#prompt-textarea') ||
    document.querySelector('[contenteditable][role="textbox"]') ||
    (() => { const ts = document.querySelectorAll('textarea'); for (const t of ts) { if (t.offsetHeight>40&&t.offsetWidth>200) return t; } return null; })();
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'db-toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; setTimeout(() => t.remove(), 300); }, 1800);
}

// --- Init ---
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
else inject();
setInterval(loadBadge, 30000);

chrome.runtime.onMessage.addListener((msg) => { if (msg.action === 'toggle-sidebar') toggle(); });
