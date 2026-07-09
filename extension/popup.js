const API = 'http://127.0.0.1:19840';

async function load() {
  const el = document.getElementById('content');
  const actions = document.getElementById('actions');

  try {
    const res = await fetch(`${API}/summary`);
    const data = await res.json();

    if (!data.active_time) {
      el.innerHTML = '<div class="empty">No activity yet</div>';
      actions.style.display = 'none';
      return;
    }

    const top3 = (data.top_apps || []).slice(0, 3);
    const insights = (data.insights || []).slice(0, 3);

    let h = '';

    h += `<div class="stats">
      <div class="stat"><div class="v">${data.active_time}m</div><div class="l">active</div></div>
      <div class="stat"><div class="v">${data.switch_count}</div><div class="l">switches</div></div>
      <div class="stat"><div class="v">${insights.length}</div><div class="l">caught</div></div>
    </div>`;

    if (top3.length) {
      h += '<div class="section">Top apps</div>';
      top3.forEach(a => h += `<div class="app"><span>${esc(a.app)}</span><span>${a.minutes}m</span></div>`);
    }

    if (insights.length) {
      h += '<div class="section">Detected</div>';
      insights.forEach(i => {
        h += `<div class="ins">
          <div class="t">${esc(i.title||'').slice(0,55)}<span class="pill">${i.confidence}%</span></div>
          <div class="d">${esc(i.description||'').slice(0,70)}</div>
        </div>`;
      });
    }

    el.innerHTML = h;
    actions.style.display = 'block';
  } catch {
    el.innerHTML = '<div class="empty">Server not running</div>';
    actions.style.display = 'none';
  }
}

function esc(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

// Recording toggle
const toggle = document.getElementById('rec-toggle');
const stateEl = document.getElementById('rec-state');

chrome.storage.local.get(['daybrain_paused'], (r) => {
  toggle.checked = !r.daybrain_paused;
  updateState();
});

toggle.addEventListener('change', async () => {
  const paused = !toggle.checked;
  await chrome.storage.local.set({ daybrain_paused: paused });
  chrome.runtime.sendMessage({ action: 'toggle-recording', paused });
  updateState();
});

function updateState() {
  stateEl.textContent = toggle.checked ? 'Recording' : 'Paused';
  stateEl.style.color = toggle.checked ? '#202124' : '#5f6368';
}

// Copy context
document.getElementById('copy-btn').addEventListener('click', async () => {
  try {
    const res = await fetch(`${API}/context`);
    const data = await res.json();
    if (data.text) {
      await navigator.clipboard.writeText(data.text);
      toast('Copied');
    }
  } catch { toast('Server not running'); }
});

document.getElementById('refresh-btn').addEventListener('click', load);

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 1500);
}

load();
