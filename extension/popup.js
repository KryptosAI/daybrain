const DEFAULT_API = 'http://127.0.0.1:19840';

async function getApiUrl() {
  const result = await chrome.storage.sync.get(['daybrain_api_url']);
  return result.daybrain_api_url || DEFAULT_API;
}

async function load() {
  const apiUrl = await getApiUrl();
  const el = document.getElementById('stats');
  try {
    const res = await fetch(`${apiUrl}/summary`);
    const data = await res.json();

    if (data.active_time === 0) {
      el.innerHTML = `<div class="stat">
        <div class="stat-label">Today</div>
        <div class="stat-value">—</div>
        <div style="font-size: 11px; color: #888; margin-top: 4px;">No activity yet</div>
      </div>`;
      return;
    }

    let html = `<div class="stat">
      <div class="stat-label">Active Today</div>
      <div class="stat-value">${data.active_time} min</div>
    </div>`;

    if (data.top_apps && data.top_apps.length > 0) {
      html += `<div class="stat">
        <div class="stat-label">Top App</div>
        <div style="font-size: 14px; font-weight: 600; margin-top: 2px;">${data.top_apps[0].app}</div>
        <div style="font-size: 11px; color: #888;">${data.top_apps[0].minutes} min</div>
      </div>`;
    }

    if (data.switch_count > 0) {
      html += `<div class="stat">
        <div class="stat-label">Context Switches</div>
        <div style="font-size: 14px; font-weight: 600; margin-top: 2px;">${data.switch_count}</div>
      </div>`;
    }

    if (data.insights && data.insights.length > 0) {
      html += `<div style="margin-top: 12px; font-weight: 600; font-size: 12px; color: #aaa;">Latest Insight</div>`;
      const latest = data.insights[0];
      html += `<div class="insight">
        <div style="font-weight: 600;">${latest.type === 'commitment' ? '🤝' : latest.type === 'avoidance' ? '👀' : '💡'} ${(latest.title||'').slice(0, 80)}</div>
        <div style="font-size: 11px; color: #aaa; margin-top: 2px;">${(latest.description||'').slice(0, 100)}</div>
      </div>`;
    }

    el.innerHTML = html;
  } catch {
    el.innerHTML = `<div class="err">
      <div style="font-size: 24px; margin-bottom: 8px;">⚠️</div>
      <div>DayBrain server not running</div>
      <div style="font-size: 11px; color: #888; margin-top: 8px;">Start with: npx daybrain</div>
      <div style="font-size: 10px; color: #666; margin-top: 4px;">API: ${apiUrl}</div>
    </div>`;
  }
}

document.getElementById('open-sidebar').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'toggle-sidebar' });
    window.close();
  }
});

document.getElementById('toggle-settings-btn').addEventListener('click', () => {
  document.getElementById('settings').classList.toggle('visible');
});

// Recording toggle
(async () => {
  const result = await chrome.storage.local.get(['daybrain_paused']);
  updatePauseButton(result.daybrain_paused);
})();

document.getElementById('toggle-recording').addEventListener('click', async () => {
  const result = await chrome.storage.local.get(['daybrain_paused']);
  const paused = !result.daybrain_paused;
  await chrome.storage.local.set({ daybrain_paused: paused });
  updatePauseButton(paused);
  chrome.runtime.sendMessage({ action: 'toggle-recording', paused });
});

function updatePauseButton(paused) {
  const btn = document.getElementById('toggle-recording');
  if (paused) {
    btn.textContent = '▶ Record';
    btn.style.borderColor = '#4caf50';
    btn.style.color = '#4caf50';
  } else {
    btn.textContent = '⏸ Pause';
    btn.style.borderColor = '#e74c3c';
    btn.style.color = '#e74c3c';
  }
}

document.getElementById('save-sync').addEventListener('click', async () => {
  const url = document.getElementById('sync-url').value.trim();
  if (url) {
    await chrome.storage.sync.set({ daybrain_api_url: url });
    showToast('Sync URL saved');
  } else {
    await chrome.storage.sync.remove('daybrain_api_url');
    showToast('Reset to localhost');
  }
  load();
});

// Load saved URL on popup open
(async () => {
  const saved = await chrome.storage.sync.get(['daybrain_api_url']);
  if (saved.daybrain_api_url) {
    document.getElementById('sync-url').value = saved.daybrain_api_url;
  }
  load();
})();

function showToast(msg) {
  const toast = document.createElement('div');
  toast.textContent = msg;
  Object.assign(toast.style, {
    position: 'fixed', bottom: '10px', left: '50%', transform: 'translateX(-50%)',
    background: '#333', color: 'white', padding: '6px 14px', borderRadius: '6px',
    fontSize: '12px', zIndex: '9999',
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1500);
}
