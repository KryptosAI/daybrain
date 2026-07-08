const API = 'http://127.0.0.1:19840';

const SIDEBAR_HTML = `
<div id="daybrain-sidebar" style="
  position: fixed; top: 0; right: 0; width: 340px; height: 100vh;
  background: #1a1a2e; color: #e0e0e0; z-index: 999999;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px; overflow-y: auto; border-left: 1px solid #333;
  transform: translateX(100%); transition: transform 0.25s ease;
  box-shadow: -4px 0 24px rgba(0,0,0,0.4);
">
  <div style="padding: 16px; border-bottom: 1px solid #333; display: flex; align-items: center; justify-content: space-between;">
    <span style="font-weight: 700; font-size: 16px;">🧠 DayBrain</span>
    <button id="daybrain-close" style="background: none; border: none; color: #888; font-size: 20px; cursor: pointer; padding: 0 4px;">✕</button>
  </div>
  <div id="daybrain-content" style="padding: 16px;">
    <div style="text-align: center; padding: 40px 0; color: #666;">
      <div style="font-size: 32px; margin-bottom: 12px;">🧠</div>
      <div>Loading your context...</div>
    </div>
  </div>
  <div style="padding: 16px; border-top: 1px solid #333; position: sticky; bottom: 0; background: #1a1a2e;">
    <button id="daybrain-inject" style="
      width: 100%; padding: 10px; border: none; border-radius: 8px;
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: white; font-weight: 600; font-size: 14px; cursor: pointer;
    ">📋 Inject Context into Chat</button>
  </div>
</div>

<div id="daybrain-toggle" style="
  position: fixed; top: 12px; right: 12px; z-index: 999998;
  width: 40px; height: 40px; border-radius: 50%;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white; border: none; cursor: pointer; font-size: 20px;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 12px rgba(102, 126, 234, 0.4);
  transition: transform 0.2s ease;
">🧠</div>
`;

let sidebarVisible = false;

function inject() {
  if (document.getElementById('daybrain-sidebar')) return;

  const container = document.createElement('div');
  container.innerHTML = SIDEBAR_HTML;
  document.body.appendChild(container.firstElementChild);
  document.body.appendChild(container.firstElementChild);

  document.getElementById('daybrain-toggle').addEventListener('click', () => {
    sidebarVisible = !sidebarVisible;
    const sidebar = document.getElementById('daybrain-sidebar');
    sidebar.style.transform = sidebarVisible ? 'translateX(0)' : 'translateX(100%)';
    if (sidebarVisible) loadContext();
  });

  document.getElementById('daybrain-close').addEventListener('click', () => {
    sidebarVisible = false;
    document.getElementById('daybrain-sidebar').style.transform = 'translateX(100%)';
  });

  document.getElementById('daybrain-inject').addEventListener('click', injectContext);
}

async function loadContext() {
  const content = document.getElementById('daybrain-content');
  if (!content) return;

  content.innerHTML = '<div style="text-align: center; padding: 40px 0; color: #888;">⏳ Loading...</div>';

  try {
    const res = await fetch(`${API}/summary`);
    const data = await res.json();
    renderSummary(content, data);
  } catch {
    content.innerHTML = `
      <div style="text-align: center; padding: 40px 0; color: #e74c3c;">
        <div style="font-size: 32px; margin-bottom: 12px;">⚠️</div>
        <div style="font-weight: 600; margin-bottom: 8px;">DayBrain server not running</div>
        <div style="font-size: 12px; color: #888;">Start it with: <code style="background: #333; padding: 2px 6px; border-radius: 4px;">npx daybrain</code></div>
      </div>`;
  }
}

function renderSummary(content, data) {
  if (data.active_time === 0) {
    content.innerHTML = `
      <div style="text-align: center; padding: 30px 0;">
        <div style="font-size: 28px; margin-bottom: 8px;">☀️</div>
        <div style="font-weight: 600; color: #888;">No activity yet today</div>
        <div style="font-size: 11px; color: #666; margin-top: 8px;">Activity will appear here as you browse</div>
      </div>`;
    return;
  }

  let html = '';

  html += `<div style="margin-bottom: 16px;">
    <div style="font-size: 24px; font-weight: 700; color: #667eea;">${data.active_time} min</div>
    <div style="font-size: 11px; color: #888;">active today</div>
  </div>`;

  if (data.top_apps && data.top_apps.length > 0) {
    html += `<div style="margin-bottom: 16px;">
      <div style="font-weight: 600; margin-bottom: 8px; color: #aaa;">Top Apps</div>`;
    for (const app of data.top_apps.slice(0, 5)) {
      const pct = app.percentage || 0;
      html += `<div style="margin-bottom: 4px;">
        <div style="display: flex; justify-content: space-between; font-size: 12px;">
          <span>${escapeHtml(app.app)}</span><span>${app.minutes} min</span>
        </div>
        <div style="height: 4px; background: #333; border-radius: 2px; margin-top: 2px;">
          <div style="height: 4px; width: ${pct}%; background: linear-gradient(90deg, #667eea, #764ba2); border-radius: 2px;"></div>
        </div>
      </div>`;
    }
    html += `</div>`;
  }

  if (data.switch_count > 0) {
    const label = data.switch_count > 100 ? '🔴 High' : data.switch_count > 40 ? '🟡 Moderate' : '🟢 Low';
    html += `<div style="margin-bottom: 16px; padding: 10px; background: #222; border-radius: 8px;">
      <div style="font-weight: 600; margin-bottom: 4px; color: #aaa;">Context Switches</div>
      <div style="font-size: 20px; font-weight: 700;">${data.switch_count} <span style="font-size: 12px; font-weight: 400; color: #888;">${label}</span></div>
    </div>`;
  }

  if (data.insights && data.insights.length > 0) {
    html += `<div style="margin-bottom: 16px;">
      <div style="font-weight: 600; margin-bottom: 8px; color: #aaa;">Insights</div>`;
    for (const ins of data.insights) {
      const emoji = ins.type === 'commitment' ? '🤝' : ins.type === 'avoidance' ? '👀' : ins.type === 'context_switch' ? '🔄' : '💡';
      const statusIcon = ins.status === 'dismissed' ? ' ✓' : ins.status === 'done' ? ' ✅' : '';
      html += `<div class="daybrain-insight" data-id="${ins.id || ''}" style="padding: 10px; background: #222; border-radius: 8px; margin-bottom: 8px; position: relative; ${ins.status === 'dismissed' ? 'opacity: 0.4;' : ''}">
        <div style="font-weight: 600; font-size: 12px; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: flex-start;">
          <span>${emoji} ${escapeHtml(ins.title)} <span style="color: ${ins.confidence > 60 ? '#667eea' : '#888'}; font-size: 10px;">${ins.confidence}%${statusIcon}</span></span>
          <div style="display: flex; gap: 4px; flex-shrink: 0; margin-left: 8px;">
            <button class="daybrain-dismiss-btn" data-id="${ins.id || ''}" data-action="done" style="background: none; border: 1px solid #444; color: #4caf50; font-size: 10px; padding: 1px 5px; border-radius: 3px; cursor: pointer;" title="Mark done">✓</button>
            <button class="daybrain-dismiss-btn" data-id="${ins.id || ''}" data-action="dismiss" style="background: none; border: 1px solid #444; color: #888; font-size: 10px; padding: 1px 5px; border-radius: 3px; cursor: pointer;" title="Dismiss">✕</button>
          </div>
        </div>
        <div style="font-size: 11px; color: #aaa;">${escapeHtml(ins.description).slice(0, 120)}</div>
        ${ins.action_text ? `<div style="font-size: 11px; color: #888; margin-top: 4px;">→ ${escapeHtml(ins.action_text).slice(0, 100)}</div>` : ''}
      </div>`;
    }
    html += `</div>`;
  }

  // Quick actions
  html += `<div style="display: flex; gap: 8px; margin-top: 16px;">
    <button onclick="document.getElementById('daybrain-inject').click()" style="
      flex: 1; padding: 8px; border: 1px solid #444; border-radius: 6px;
      background: transparent; color: #ccc; font-size: 12px; cursor: pointer;
    ">📋 Inject Context</button>
    <button onclick="document.getElementById('daybrain-content').dispatchEvent(new Event('refresh'))" style="
      flex: 1; padding: 8px; border: 1px solid #444; border-radius: 6px;
      background: transparent; color: #ccc; font-size: 12px; cursor: pointer;
    ">🔄 Refresh</button>
  </div>`;

  content.innerHTML = html;
  content.addEventListener('refresh', loadContext);

  // Attach dismiss handlers
  setTimeout(() => {
    document.querySelectorAll('.daybrain-dismiss-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        const insightEl = btn.closest('.daybrain-insight');
        try {
          await fetch(`${API}/insight-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: Number(id), status: action === 'done' ? 'done' : 'dismissed' }),
          });
          if (insightEl) {
            insightEl.style.opacity = '0.3';
            insightEl.style.transition = 'opacity 0.3s';
          }
          showToast(action === 'done' ? 'Marked as done' : 'Dismissed');
        } catch {
          showToast('Server not reachable');
        }
      });
    });
  }, 100);
}

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function injectContext() {
  try {
    const res = await fetch(`${API}/context`);
    const data = await res.json();

    if (!data.text) {
      alert('No context available yet. Activity will appear as you browse.');
      return;
    }

    const textarea = findChatInput();
    if (textarea) {
      const existing = textarea.value || textarea.textContent || '';
      textarea.value = existing ? existing + '\n\n' + data.text : data.text;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.focus();

      const sidebar = document.getElementById('daybrain-sidebar');
      if (sidebar) sidebar.style.transform = 'translateX(100%)';
      sidebarVisible = false;

      showToast('Context injected!');
    } else {
      await navigator.clipboard.writeText(data.text);
      showToast('Context copied to clipboard — paste into chat');
    }
  } catch {
    showToast('DayBrain server not running. Start: npx daybrain');
  }
}

function findChatInput() {
  // Claude.ai
  let el = document.querySelector('[contenteditable="true"].ProseMirror');
  if (el) return el;

  // ChatGPT
  el = document.querySelector('#prompt-textarea');
  if (el) return el;

  // Generic contenteditable
  el = document.querySelector('[contenteditable="true"][role="textbox"]');
  if (el) return el;

  // Fallback: any large textarea
  const textareas = document.querySelectorAll('textarea');
  for (const ta of textareas) {
    if (ta.offsetHeight > 40 && ta.offsetWidth > 200) return ta;
  }

  return null;
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.textContent = msg;
  Object.assign(toast.style, {
    position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
    background: '#333', color: 'white', padding: '10px 20px', borderRadius: '8px',
    fontSize: '13px', zIndex: '9999999', boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
    transition: 'opacity 0.3s ease',
  });
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2000);
}

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inject);
} else {
  inject();
}

// Listen for toggle from popup
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'toggle-sidebar') {
    sidebarVisible = !sidebarVisible;
    const sidebar = document.getElementById('daybrain-sidebar');
    if (sidebar) {
      sidebar.style.transform = sidebarVisible ? 'translateX(0)' : 'translateX(100%)';
      if (sidebarVisible) loadContext();
    }
  }
});
