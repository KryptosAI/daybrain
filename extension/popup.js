const API = 'http://127.0.0.1:19840';

async function load() {
  const el = document.getElementById('content');
  const actions = document.getElementById('actions');

  try {
    const res = await fetch(`${API}/summary`);
    const data = await res.json();

    if (!data.active_time) {
      el.innerHTML = '<div class="empty">No activity yet today</div>';
      actions.style.display = 'none';
      return;
    }

    const top3 = (data.top_apps || []).slice(0, 4);
    const insights = (data.insights || []).slice(0, 3);

    let h = '';

    h += `<div class="card">
      <div class="nums">
        <div style="text-align:center"><div class="n">${data.active_time}m</div><div class="l">active</div></div>
        <div style="text-align:center"><div class="n">${data.switch_count}</div><div class="l">switches</div></div>
        <div style="text-align:center"><div class="n">${insights.length}</div><div class="l">caught</div></div>
      </div>
    </div>`;

    if (top3.length) {
      h += '<div class="section">TOP APPS</div>';
      top3.forEach(a => {
        h += `<div class="app-row"><span>${esc(a.app)}</span><span>${a.minutes}m</span></div>`;
      });
    }

    if (insights.length) {
      h += '<div class="section">THINGS YOU SAID</div>';
      insights.forEach(i => {
        h += `<div class="insight">
          <div class="t">${esc(i.title||'').slice(0,60)}<span class="pill">${i.confidence}%</span></div>
          <div class="d">${esc(i.description||'').slice(0,80)}</div>
        </div>`;
      });
    }

    el.innerHTML = h;
    actions.style.display = 'flex';
  } catch {
    el.innerHTML = '<div class="empty">Server not running<br><span style="font-size:10px">Start: npx daybrain</span></div>';
    actions.style.display = 'none';
  }
}

function esc(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

// Recording toggle
(async () => {
  const result = await chrome.storage.local.get(['daybrain_paused']);
  updatePauseUI(result.daybrain_paused);
})();

document.getElementById('pause-btn').addEventListener('click', async () => {
  const result = await chrome.storage.local.get(['daybrain_paused']);
  const paused = !result.daybrain_paused;
  await chrome.storage.local.set({ daybrain_paused: paused });
  updatePauseUI(paused);
  chrome.runtime.sendMessage({ action: 'toggle-recording', paused });
});

function updatePauseUI(paused) {
  const dot = document.getElementById('rec-dot');
  const label = document.getElementById('rec-label');
  const btn = document.getElementById('pause-btn');
  if (paused) {
    dot.style.background = '#dadce0';
    label.textContent = 'Paused';
    btn.textContent = 'Resume';
    btn.className = 'btn outline';
  } else {
    dot.style.background = '#34a853';
    label.textContent = 'Recording';
    btn.textContent = 'Pause';
    btn.className = 'btn danger';
  }
}

document.getElementById('refresh-btn').addEventListener('click', load);

load();
