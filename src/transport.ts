import { getConfig } from './config';

interface TransportResult {
  ok: boolean;
  target: string;
  error?: string;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

export async function pushToSlack(message: string): Promise<TransportResult> {
  const config = getConfig().transports.slack;
  if (!config.webhookUrl) {
    return { ok: false, target: 'slack', error: 'Slack webhook URL not configured' };
  }

  try {
    const res = await fetchWithRetry(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return { ok: false, target: 'slack', error: `HTTP ${res.status}: ${await res.text()}` };
    }

    return { ok: true, target: 'slack' };
  } catch (err) {
    return { ok: false, target: 'slack', error: String(err) };
  }
}

export async function pushToTelegram(message: string): Promise<TransportResult> {
  const config = getConfig().transports.telegram;
  if (!config.botToken || !config.chatId) {
    return { ok: false, target: 'telegram', error: 'Telegram bot token or chat ID not configured' };
  }

  try {
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, target: 'telegram', error: `HTTP ${res.status}: ${body}` };
    }

    return { ok: true, target: 'telegram' };
  } catch (err) {
    return { ok: false, target: 'telegram', error: String(err) };
  }
}

export async function pushToWebhook(message: string): Promise<TransportResult> {
  const config = getConfig().transports.webhook;
  if (!config.url) {
    return { ok: false, target: 'webhook', error: 'Webhook URL not configured' };
  }

  try {
    const res = await fetchWithRetry(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body: JSON.stringify({
        text: message,
        timestamp: new Date().toISOString(),
        source: 'opencontext',
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return { ok: false, target: 'webhook', error: `HTTP ${res.status}` };
    }

    return { ok: true, target: 'webhook' };
  } catch (err) {
    return { ok: false, target: 'webhook', error: String(err) };
  }
}

export async function pushInsightToAll(
  title: string,
  description: string,
  actionText: string,
  targets: string[]
): Promise<TransportResult[]> {
  const message = formatInsightMessage(title, description, actionText);
  const results: TransportResult[] = [];

  for (const target of targets) {
    switch (target) {
      case 'slack':
        results.push(await pushToSlack(message));
        break;
      case 'telegram':
        results.push(await pushToTelegram(message));
        break;
      case 'webhook':
        results.push(await pushToWebhook(message));
        break;
      default:
        results.push({ ok: false, target, error: `Unknown transport: ${target}` });
    }
  }

  return results;
}

function formatInsightMessage(title: string, description: string, actionText: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let msg = `<b>🔍 ${esc(title)}</b>\n\n`;
  msg += `${esc(description)}\n`;
  if (actionText) {
    msg += `\n<b>💡 Suggestion:</b> ${esc(actionText)}`;
  }
  msg += `\n\n<code>via OpenContext</code>`;
  return msg;
}

export async function pushSummary(summary: string, targets: string[]): Promise<TransportResult[]> {
  const results: TransportResult[] = [];

  for (const target of targets) {
    switch (target) {
      case 'slack':
        results.push(await pushToSlack(summary));
        break;
      case 'telegram':
        results.push(await pushToTelegram(summary));
        break;
      case 'webhook':
        results.push(await pushToWebhook(summary));
        break;
      default:
        results.push({ ok: false, target, error: `Unknown transport: ${target}` });
    }
  }

  return results;
}
