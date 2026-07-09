let API = 'http://127.0.0.1:19840';

const SITE_PATTERNS = [
  { host: 'linear.app', name: 'Linear' },
  { host: 'github.com', name: 'GitHub' },
  { host: 'gitlab.com', name: 'GitLab' },
  { host: 'notion.so', name: 'Notion' },
  { host: 'figma.com', name: 'Figma' },
  { host: 'slack.com', name: 'Slack' },
  { host: 'app.slack.com', name: 'Slack' },
  { host: 'discord.com', name: 'Discord' },
  { host: 'mail.google.com', name: 'Gmail' },
  { host: 'docs.google.com', name: 'Google Docs' },
  { host: 'sheets.google.com', name: 'Google Sheets' },
  { host: 'calendar.google.com', name: 'Google Calendar' },
  { host: 'meet.google.com', name: 'Google Meet' },
  { host: 'drive.google.com', name: 'Google Drive' },
  { host: 'stripe.com', name: 'Stripe' },
  { host: 'dashboard.stripe.com', name: 'Stripe Dashboard' },
  { host: 'chat.openai.com', name: 'ChatGPT' },
  { host: 'chatgpt.com', name: 'ChatGPT' },
  { host: 'claude.ai', name: 'Claude' },
  { host: 'gemini.google.com', name: 'Gemini' },
  { host: 'twitter.com', name: 'Twitter' },
  { host: 'x.com', name: 'Twitter' },
  { host: 'youtube.com', name: 'YouTube' },
  { host: 'reddit.com', name: 'Reddit' },
  { host: 'stackoverflow.com', name: 'StackOverflow' },
  { host: 'news.ycombinator.com', name: 'Hacker News' },
  { host: 'jira.atlassian.com', name: 'Jira' },
  { host: 'atlassian.net', name: 'Jira' },
  { host: 'spotify.com', name: 'Spotify' },
  { host: 'open.spotify.com', name: 'Spotify' },
  { host: 'cursor.com', name: 'Cursor' },
  { host: 'cursor.sh', name: 'Cursor' },
  { host: 'vscode.dev', name: 'VS Code' },
  { host: 'codesandbox.io', name: 'CodeSandbox' },
  { host: 'replit.com', name: 'Replit' },
  { host: 'netlify.com', name: 'Netlify' },
  { host: 'app.netlify.com', name: 'Netlify' },
  { host: 'vercel.com', name: 'Vercel' },
  { host: 'aws.amazon.com', name: 'AWS Console' },
  { host: 'console.aws.amazon.com', name: 'AWS Console' },
  { host: 'cloud.google.com', name: 'GCP Console' },
  { host: 'portal.azure.com', name: 'Azure' },
  { host: 'npmjs.com', name: 'npm' },
  { host: 'pypi.org', name: 'PyPI' },
  { host: 'crates.io', name: 'crates.io' },
];

function extractApp(url, title) {
  if (url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      for (const pattern of SITE_PATTERNS) {
        if (host === pattern.host || host.endsWith('.' + pattern.host)) {
          return pattern.name;
        }
      }
      const parts = host.split('.');
      if (parts.length >= 2) {
        const domain = parts[parts.length - 2];
        return domain.charAt(0).toUpperCase() + domain.slice(1);
      }
      return host;
    } catch {}
  }
  if (!title) return 'Unknown';
  const lower = title.toLowerCase();
  if (lower.includes('linear')) return 'Linear';
  if (lower.includes('slack')) return 'Slack';
  if (lower.includes('github')) return 'GitHub';
  if (lower.includes('notion')) return 'Notion';
  if (lower.includes('cursor')) return 'Cursor';
  return 'Unknown';
}

async function getApiUrl() {
  const result = await chrome.storage.sync.get(['daybrain_api_url']);
  API = result.daybrain_api_url || 'http://127.0.0.1:19840';
  return API;
}

// Initialize and listen for storage changes
getApiUrl();
chrome.storage.onChanged.addListener((changes) => {
  if (changes.daybrain_api_url) {
    API = changes.daybrain_api_url.newValue || 'http://127.0.0.1:19840';
  }
});

let isPaused = false;

chrome.storage.local.get(['daybrain_paused'], (result) => {
  isPaused = result.daybrain_paused || false;
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'toggle-recording') {
    isPaused = msg.paused;
  }
});

let tabTimers = {};

function now() {
  return new Date().toISOString();
}

async function postEvent(event) {
  try {
    await fetch(`${API}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  } catch {}
}

async function onTabChange(tabId, url, title) {
  if (isPaused) return;
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;
  if (!title) return;

  const prev = tabTimers[tabId];
  if (prev) {
    const duration = (Date.now() - prev.started) / 1000;
    if (duration >= 2) {
      await postEvent({
        app: extractApp(prev.url, prev.title),
        title: prev.title,
        url: prev.url,
        duration: Math.round(duration),
        timestamp: prev.timestamp,
      });
    }
  }

  tabTimers[tabId] = {
    url,
    title,
    started: Date.now(),
    timestamp: now(),
  };
}

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    onTabChange(activeInfo.tabId, tab.url, tab.title);
  } catch {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.title) {
    onTabChange(tabId, tab.url, tab.title);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const prev = tabTimers[tabId];
  if (prev) {
    const duration = (Date.now() - prev.started) / 1000;
    if (duration >= 2) {
      postEvent({
        app: extractApp(prev.url, prev.title),
        title: prev.title,
        url: prev.url,
        duration: Math.round(duration),
        timestamp: prev.timestamp,
      });
    }
    delete tabTimers[tabId];
  }
});

chrome.alarms.create('flush-timers', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'flush-timers') {
    if (isPaused) return;
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    for (const tab of tabs) {
      const prev = tabTimers[tab.id];
      if (prev && tab.url && tab.title) {
        const duration = (Date.now() - prev.started) / 1000;
        if (duration >= 5) {
          await postEvent({
            app: extractApp(tab.url, tab.title),
            title: tab.title,
            url: tab.url,
            duration: Math.round(duration),
            timestamp: prev.timestamp,
            ongoing: true,
          });
          tabTimers[tab.id] = {
            url: tab.url,
            title: tab.title,
            started: Date.now(),
            timestamp: now(),
          };
        }
      }
    }
  }
});
