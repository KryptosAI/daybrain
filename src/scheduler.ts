import { createAWClient } from './aw';
import { createScreenpipeClient } from './screenpipe';
import { createInsightEngine } from './insights';
import { insertRawEvents, insertInsights, upsertDailySummary, getInsights, getRawEvents as dbGetRawEvents, markInsightPushed, StoredRawEvent } from './db';
import { pushInsightToAll, pushSummary } from './transport';
import { loadConfig } from './config';

let intervalHandle: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;
let isLoopRunning = false;

export function startScheduler(intervalMinutes?: number): void {
  const config = loadConfig();
  const interval = intervalMinutes ?? config.activitywatch.pollIntervalMinutes ?? config.insights.scheduleIntervalMinutes;

  if (isRunning) return;
  isRunning = true;

  const intervalMs = interval * 60 * 1000;

  runInsightLoop().catch(err => {
    console.error('[daybrain] Initial insight loop failed:', err instanceof Error ? err.message : String(err));
  });

  scheduleNextRun(intervalMs);

  console.error(`[daybrain] Scheduler started, running every ${interval} minutes`);
}

function scheduleNextRun(delayMs: number): void {
  if (!isRunning) return;
  intervalHandle = setTimeout(async () => {
    if (isLoopRunning) {
      console.error('[daybrain] Scheduler skipped — previous loop still running');
      scheduleNextRun(delayMs);
      return;
    }
    isLoopRunning = true;
    try {
      await runInsightLoop();
    } catch (err) {
      console.error('[daybrain] Scheduled insight loop failed:', err instanceof Error ? err.message : String(err));
    } finally {
      isLoopRunning = false;
      scheduleNextRun(delayMs);
    }
  }, delayMs);
}

export function stopScheduler(): void {
  isRunning = false;
  if (intervalHandle) {
    clearTimeout(intervalHandle);
    intervalHandle = null;
  }
  console.error('[daybrain] Scheduler stopped');
}

export async function runInsightLoop(): Promise<{
  eventsStored: number;
  insightsGenerated: number;
  errors: string[];
}> {
  const config = loadConfig();
  const errors: string[] = [];
  let eventsStored = 0;
  let insightsGenerated = 0;

  try {
    if (config.activitywatch.enabled) {
      const aw = createAWClient();
      const health = await aw.healthCheck();

      if (health.ok) {
        const now = new Date();
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);

        try {
          const count = await aw.fetchAndStore(
            startOfDay.toISOString(),
            now.toISOString()
          );
          eventsStored += count;
        } catch (err) {
          errors.push(`AW fetch error: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        errors.push(`ActivityWatch not available: ${health.error}`);
      }
    }
  } catch (err) {
    errors.push(`AW error: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    if (config.screenpipe.enabled) {
      const sp = createScreenpipeClient();
      const health = await sp.healthCheck();

      if (health.ok) {
        try {
          const ocrResults = await sp.getRecentOCR(100);
          const audioResults = await sp.getRecentAudio(100);

          const rawEvents = [
            ...ocrResults.map(r => ({
              source: 'screenpipe' as const,
              bucket_id: 'screenpipe-ocr',
              timestamp: r.timestamp,
              duration: 0,
              app: r.content.app_name || '',
              title: r.content.window_name || '',
              url: r.content.browser_url || '',
              raw_data: JSON.stringify(r.content),
            })),
            ...audioResults.map(r => ({
              source: 'screenpipe' as const,
              bucket_id: 'screenpipe-audio',
              timestamp: r.timestamp,
              duration: 0,
              app: r.content.app_name || '',
              title: r.content.transcription || r.content.window_name || '',
              url: r.content.browser_url || '',
              raw_data: JSON.stringify(r.content),
            })),
          ];

          if (rawEvents.length > 0) {
            const count = insertRawEvents(rawEvents);
            eventsStored += count;
          }
        } catch (err) {
          errors.push(`Screenpipe fetch error: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        errors.push(`Screenpipe not available: ${health.error}`);
      }
    }
  } catch (err) {
    errors.push(`Screenpipe error: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const rawEvents = dbGetRawEvents({
      periodStart: startOfDay.toISOString(),
      periodEnd: now.toISOString(),
      limit: 10000,
    });

    if (rawEvents.length > 0) {
      const events = rawEvents.map((e: StoredRawEvent) => ({
        timestamp: e.timestamp,
        duration: e.duration,
        data: { app: e.app, title: e.title, url: e.url },
      }));

      const engine = createInsightEngine();
      const result = engine.runFullAnalysis(events);

      const insightRecords = result.insights.map(i => ({
        type: i.type,
        period_start: i.period_start,
        period_end: i.period_end,
        title: i.title,
        description: i.description,
        confidence: i.confidence,
        evidence: i.evidence,
        action_text: i.action_text,
      }));

      if (insightRecords.length > 0) {
        const stored = insertInsights(insightRecords);
        insightsGenerated += stored;
      }

      const todayStr = now.toISOString().slice(0, 10);
      upsertDailySummary({
        date: todayStr,
        total_active_time: result.totalActiveTime,
        top_apps: JSON.stringify(
          result.appSummaries.slice(0, 10).map(a => ({ app: a.app, minutes: Math.round(a.totalDuration / 60) }))
        ),
        switch_count: result.contextSwitches.reduce((s, c) => s + c.count, 0),
        insight_count: insightsGenerated,
        raw_summary: result.summary,
      });
    }
  } catch (err) {
    errors.push(`Insight extraction error: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    await pushNewInsights();
  } catch (err) {
    errors.push(`Push error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { eventsStored, insightsGenerated, errors };
}

async function pushNewInsights(): Promise<void> {
  const config = loadConfig();

  const activeTargets: string[] = [];
  if (config.transports.slack.webhookUrl) activeTargets.push('slack');
  if (config.transports.telegram.botToken && config.transports.telegram.chatId) activeTargets.push('telegram');
  if (config.transports.webhook.url) activeTargets.push('webhook');

  if (activeTargets.length === 0) return;

  const recent = getInsights({ includePushed: true, limit: 50 });

  for (const insight of recent) {
    const pushedTargets = insight.pushed_to
      ? insight.pushed_to.split(',').map((s: string) => s.trim())
      : [];
    const remaining = activeTargets.filter(t => !pushedTargets.includes(t));
    if (remaining.length === 0) continue;

    const results = await pushInsightToAll(
      insight.title,
      insight.description,
      insight.action_text,
      remaining
    );

    for (const result of results) {
      if (result.ok) {
        markInsightPushed(insight.id, result.target);
      }
    }
  }
}
