import * as http from 'http';
import { getConfig } from './config';
import {
  getRawEvents,
  getInsights,
  getDailySummary,
  insertRawEvents,
  updateInsightStatus,
} from './db';
import { createInsightEngine } from './insights';
import { generateBaseline } from './baseline';

let httpServer: http.Server | null = null;

const EVENT_PORT = 19840;

export function startHttpServer(port?: number): void {
  if (httpServer) return;

  const listenPort = port || EVENT_PORT;

  httpServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const url = new URL(req.url || '/', `http://localhost:${listenPort}`);

      switch (url.pathname) {
        case '/health':
          return handleHealth(res);
        case '/events':
          return await handlePostEvents(req, res);
        case '/summary':
          return await handleGetSummary(url, res);
        case '/insights':
          return await handleGetInsights(url, res);
        case '/context':
          return await handleGetContext(res);
        case '/baseline':
          return await handleGetBaseline(res);
        case '/insight-status':
          return await handleUpdateInsightStatus(req, res);
        case '/sync/push':
          return await handleSyncPush(req, res);
        case '/sync/pull':
          return await handleSyncPull(req, res);
        default:
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'not found' }));
      }
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[daybrain] HTTP port ${listenPort} in use — another DayBrain is already running. Extension will use existing server.`);
      httpServer = null;
    } else {
      console.error(`[daybrain] HTTP server error:`, err.message);
    }
  });

  httpServer.listen(listenPort, '127.0.0.1', () => {
    console.error(`[daybrain] HTTP API on http://127.0.0.1:${listenPort} (for browser extension)`);
  });
}

export function stopHttpServer(): void {
  if (httpServer) {
    try { httpServer.close(); } catch {}
    httpServer = null;
  }
}

function handleHealth(res: http.ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', version: '0.3.0' }));
}

async function handlePostEvents(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readBody(req);
  try {
    const parsed = JSON.parse(body);

    if (Array.isArray(parsed)) {
      const events = parsed.map((e: any) => ({
        source: 'native' as const,
        bucket_id: 'browser-extension',
        timestamp: e.timestamp || new Date().toISOString(),
        duration: e.duration || 0,
        app: e.app || 'Chrome',
        title: e.title || '',
        url: e.url || '',
        raw_data: JSON.stringify(e),
      }));

      const count = insertRawEvents(events);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ stored: count }));
    } else if (parsed.url || parsed.title) {
      const count = insertRawEvents([{
        source: 'native' as const,
        bucket_id: 'browser-extension',
        timestamp: parsed.timestamp || new Date().toISOString(),
        duration: parsed.duration || 0,
        app: parsed.app || 'Chrome',
        title: parsed.title || '',
        url: parsed.url || '',
        raw_data: JSON.stringify(parsed),
      }]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ stored: count }));
    } else {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'missing url or title' }));
    }
  } catch {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'invalid JSON body' }));
  }
}

async function handleGetSummary(url: URL, res: http.ServerResponse): Promise<void> {
  const dateParam = url.searchParams.get('date');
  const now = new Date();
  let startOfDay: Date;
  let endOfDay: Date;

  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const [y, m, d] = dateParam.split('-').map(Number);
    startOfDay = new Date(y, m - 1, d, 0, 0, 0, 0);
    endOfDay = new Date(y, m - 1, d, 23, 59, 59, 999);
  } else {
    startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  }

  const dateStr = `${startOfDay.getFullYear()}-${String(startOfDay.getMonth()+1).padStart(2,'0')}-${String(startOfDay.getDate()).padStart(2,'0')}`;
  const summary = getDailySummary(dateStr);

    const events = getRawEvents({
      periodStart: startOfDay.toISOString(),
      periodEnd: endOfDay.toISOString(),
      limit: 5000,
    });

  if (!summary) {
    const engine = createInsightEngine();

    const events = getRawEvents({
      periodStart: startOfDay.toISOString(),
      periodEnd: endOfDay.toISOString(),
      limit: 5000,
    });

    if (events.length === 0) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        date: dateStr,
        active_time: 0,
        top_apps: [],
        insights: [],
        message: 'No activity recorded yet today.',
      }));
      return;
    }

    const mapped = events.map((e: any) => ({
      timestamp: e.timestamp,
      duration: e.duration,
      data: { app: e.app, title: e.title, url: e.url },
    }));

    const result = engine.runFullAnalysis(mapped);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      date: dateStr,
      active_time: Math.round(result.totalActiveTime / 6) / 10,
      top_apps: result.appSummaries.slice(0, 8).map((a: any) => ({
        app: a.app,
        minutes: Math.round(a.totalDuration / 6) / 10,
        percentage: Math.round(a.percentage),
      })),
      switch_count: result.contextSwitches.reduce((s: number, c: any) => s + c.count, 0),
      insights: result.insights.slice(0, 6).map((i: any, idx: number) => ({
        id: idx,
        type: i.type,
        title: i.title,
        description: i.description,
        confidence: Math.round(i.confidence * 100),
        action_text: i.action_text,
      })),
      raw_summary: result.summary,
    }));
    return;
  }

  const storedInsights = getInsights({
    periodStart: dateStr,
    periodEnd: dateStr + 'T23:59:59.999Z',
    limit: 10,
  });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    date: dateStr,
    active_time: Math.round(summary.total_active_time / 6) / 10,
    top_apps: JSON.parse(summary.top_apps || '[]'),
    switch_count: summary.switch_count,
    insights: storedInsights.map((i: any) => ({
      id: i.id,
      type: i.type,
      title: i.title,
      description: i.description,
      confidence: Math.round(i.confidence * 100),
      action_text: i.action_text,
      status: i.status,
    })),
    raw_summary: summary.raw_summary,
  }));
}

async function handleGetInsights(url: URL, res: http.ServerResponse): Promise<void> {
  const stored = getInsights({
    limit: 20,
    includePushed: true,
  });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    insights: stored.map((i: any) => ({
      id: i.id,
      type: i.type,
      title: i.title,
      description: i.description,
      confidence: Math.round(i.confidence * 100),
      action_text: i.action_text,
      created_at: i.created_at,
    })),
  }));
}

async function handleGetContext(res: http.ServerResponse): Promise<void> {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const summary = getDailySummary(dateStr);

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const storedInsights = getInsights({
    periodStart: dateStr,
    periodEnd: dateStr + 'T23:59:59.999Z',
    limit: 10,
  });

  let totalMinutes: number;
  let topApps: { app: string; minutes: number }[];
  let insightsList = storedInsights;

  if (summary) {
    totalMinutes = Math.round(summary.total_active_time / 60);
    topApps = JSON.parse(summary.top_apps || '[]');
  } else {
    const events = getRawEvents({
      periodStart: startOfDay.toISOString(),
      periodEnd: endOfDay.toISOString(),
      limit: 5000,
    });

    if (events.length > 0) {
      const engine = createInsightEngine();
      const mapped = events.map((e: any) => ({
        timestamp: e.timestamp,
        duration: e.duration,
        data: { app: e.app, title: e.title, url: e.url },
      }));
      const result = engine.runFullAnalysis(mapped);
      totalMinutes = Math.round(result.totalActiveTime / 60);
      topApps = result.appSummaries.slice(0, 6).map((a: any) => ({
        app: a.app,
        minutes: Math.round(a.totalDuration / 6) / 10,
      }));
      if (insightsList.length === 0) {
        insightsList = result.insights.map((i: any) => ({
          ...i,
          created_at: new Date().toISOString(),
        }));
      }
    } else {
      totalMinutes = 0;
      topApps = [];
    }
  }

  let text = `Here is my activity context for today:\n\n`;

  if (totalMinutes > 0) {
    text += `I've been active for ${totalMinutes} minutes across ${topApps.length} applications.\n\n`;
    text += `Top apps:\n`;
    for (const a of topApps.slice(0, 6)) {
      text += `- ${a.app}: ${a.minutes} min\n`;
    }
  } else {
    text += `No activity recorded yet today.\n`;
  }

  if (storedInsights.length > 0) {
    text += `\nDetected insights:\n`;
    for (const i of storedInsights.slice(0, 5)) {
      text += `- [${i.type}] ${i.title}\n  ${i.description}\n`;
    }
  }

  text += `\n(Generated by DayBrain — local AI memory engine)`;

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ text, total_minutes: totalMinutes, insights: storedInsights.length }));
}

async function handleGetBaseline(res: http.ServerResponse): Promise<void> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const events = getRawEvents({
    periodStart: startOfDay.toISOString(),
    periodEnd: endOfDay.toISOString(),
    limit: 10000,
  });

  if (events.length === 0) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ anomalies: [], message: 'No activity today yet.' }));
    return;
  }

  const mapped = events.map((e: any) => ({
    timestamp: e.timestamp,
    duration: e.duration,
    data: { app: e.app, title: e.title, url: e.url },
  }));

  const engine = createInsightEngine();
  const baseline = generateBaseline(mapped, engine);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(baseline));
}

async function handleUpdateInsightStatus(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readBody(req);
  try {
    const { id, status } = JSON.parse(body);
    if (!id || !status) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'id and status required' }));
      return;
    }
    updateInsightStatus(Number(id), String(status));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: String(err) }));
  }
}

async function handleSyncPush(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readBody(req);
  try {
    const parsed = JSON.parse(body);
    const deviceId = (req.headers['x-daybrain-device'] as string) || 'remote';
    const events = Array.isArray(parsed) ? parsed : [parsed];

    const rawEvents = events.map((e: any) => ({
      source: 'native' as const,
      bucket_id: `sync-${deviceId}`,
      timestamp: e.timestamp || new Date().toISOString(),
      duration: e.duration || 0,
      app: e.app || 'Unknown',
      title: e.title || '',
      url: e.url || '',
      raw_data: JSON.stringify({ ...e, deviceId }),
    }));

    const count = insertRawEvents(rawEvents);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ stored: count, device: deviceId }));
  } catch {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'invalid JSON body' }));
  }
}

async function handleSyncPull(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://localhost`);
  const since = url.searchParams.get('since') || new Date(Date.now() - 86400000).toISOString();
  const limit = Math.min(Number(url.searchParams.get('limit')) || 1000, 5000);

  const events = getRawEvents({
    periodStart: since,
    limit,
  });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ events, count: events.length, since }));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export { EVENT_PORT };
