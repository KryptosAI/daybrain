const API = 'http://127.0.0.1:19840';

async function injectButton() {
  if (document.getElementById('daybrain-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'daybrain-btn';
  btn.title = 'Share your day with Claude';
  btn.type = 'button';
  btn.textContent = 'Context';
  Object.assign(btn.style, {
    background: 'transparent', border: 'none', cursor: 'pointer',
    fontSize: '13px', color: '#80868b', fontWeight: '500',
    padding: '4px 8px', borderRadius: '16px',
    transition: 'background .15s, color .15s',
  });
  btn.addEventListener('mouseenter', () => { btn.style.background = '#f1f3f4'; btn.style.color = '#202124'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; btn.style.color = '#80868b'; });
  btn.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    await inject();
  });

  const tryPlace = () => {
    const input = findInput();
    if (!input) return setTimeout(tryPlace, 500);

    const toolbar = input.closest('form') ||
                   input.closest('[class*="flex"]') ||
                   input.parentElement?.parentElement;

    if (toolbar) {
      const row = toolbar.querySelector('[class*="flex"]') || toolbar;
      const first = row.firstElementChild;
      if (first && first !== btn) first.before(btn);
    }
  };

  tryPlace();
}

async function inject() {
  const input = findInput();
  if (!input) return;

  btn = document.getElementById('daybrain-btn');
  if (btn) btn.textContent = '…';

  try {
    const res = await fetch(`${API}/context`);
    const data = await res.json();
    if (!data.text) {
      if (btn) btn.textContent = 'Context';
      return;
    }
    const existing = input.value || input.textContent || '';
    input.value = existing ? existing + '\n\n' + data.text : data.text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  } catch(e) {}

  if (btn) btn.textContent = 'Context';
}

function findInput() {
  return document.querySelector('[contenteditable].ProseMirror') ||
    document.querySelector('#prompt-textarea') ||
    document.querySelector('[contenteditable][role="textbox"]') ||
    Array.from(document.querySelectorAll('textarea')).find(t => t.offsetHeight > 40 && t.offsetWidth > 200);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { injectButton(); setTimeout(injectButton, 3000); });
} else {
  injectButton();
  setTimeout(injectButton, 3000);
}
