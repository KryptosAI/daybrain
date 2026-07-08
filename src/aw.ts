import { getConfig } from './config';
import { insertRawEvents } from './db';

export interface AWEvent {
  timestamp: string;
  duration: number;
  data: Record<string, unknown>;
}

export interface AWQueryResult {
  [bucketId: string]: AWEvent[];
}

export class ActivityWatchClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || getConfig().activitywatch.baseUrl;
  }

  async healthCheck(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/0/info`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const json = await res.json() as { hostname?: string; version?: string };
      return { ok: true, version: json.version || 'unknown' };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async getBuckets(): Promise<{ ok: boolean; buckets: Record<string, string>; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/0/buckets`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { ok: false, buckets: {}, error: `HTTP ${res.status}` };
      const json = await res.json() as Record<string, { id: string; type: string }>;
      const buckets: Record<string, string> = {};
      for (const [key, val] of Object.entries(json)) {
        buckets[key] = val.type;
      }
      return { ok: true, buckets };
    } catch (err) {
      console.error('[daybrain] AW getBuckets failed:', err instanceof Error ? err.message : String(err));
      return { ok: false, buckets: {}, error: String(err) };
    }
  }

  async query(timeperiods: string[], queryLines: string[]): Promise<AWQueryResult> {
    try {
      const res = await fetch(`${this.baseUrl}/api/0/query/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeperiods, query: queryLines }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        throw new Error(`Query failed: HTTP ${res.status}`);
      }
      return await res.json() as AWQueryResult;
    } catch (err) {
      throw new Error(`ActivityWatch query failed: ${err}`);
    }
  }

  async getWindowEvents(period: string = 'today'): Promise<AWEvent[]> {
    const timeperiods = [period];
    const queryLines = [
      'window_events = query_bucket("aw-watcher-window_*");',
      `window_events = filter_period_intersect(window_events, "${period}");`,
      'window_events = sort_by_timestamp(window_events);',
      'RETURN = window_events;',
    ];

    const result = await this.query(timeperiods, queryLines);
    const allEvents: AWEvent[] = [];
    for (const events of Object.values(result)) {
      if (Array.isArray(events)) {
        allEvents.push(...events);
      }
    }
    return allEvents.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  async getBrowserEvents(period: string = 'today'): Promise<AWEvent[]> {
    const timeperiods = [period];
    const queryLines = [
      'browser_events = query_bucket("aw-watcher-web-*");',
      `browser_events = filter_period_intersect(browser_events, "${period}");`,
      'browser_events = sort_by_timestamp(browser_events);',
      'RETURN = browser_events;',
    ];

    const result = await this.query(timeperiods, queryLines);
    const allEvents: AWEvent[] = [];
    for (const events of Object.values(result)) {
      if (Array.isArray(events)) {
        allEvents.push(...events);
      }
    }
    return allEvents.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  async getAFKEvents(period: string = 'today'): Promise<AWEvent[]> {
    const timeperiods = [period];
    const queryLines = [
      'afk_events = query_bucket("aw-watcher-afk_*");',
      `afk_events = filter_period_intersect(afk_events, "${period}");`,
      'afk_events = sort_by_timestamp(afk_events);',
      'RETURN = afk_events;',
    ];

    const result = await this.query(timeperiods, queryLines);
    const allEvents: AWEvent[] = [];
    for (const events of Object.values(result)) {
      if (Array.isArray(events)) {
        allEvents.push(...events);
      }
    }
    return allEvents.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  async fetchAndStore(periodStart: string, periodEnd: string): Promise<number> {
    const windowEvents = await this.getWindowEventsByRange(periodStart, periodEnd);

    const rawEvents = windowEvents.map((evt: AWEvent) => ({
      source: 'activitywatch' as const,
      bucket_id: 'aw-watcher-window',
      timestamp: evt.timestamp,
      duration: evt.duration,
      app: String(evt.data?.app || ''),
      title: String(evt.data?.title || ''),
      url: String(evt.data?.url || ''),
      raw_data: JSON.stringify(evt.data),
    }));

    return insertRawEvents(rawEvents);
  }

  async getWindowEventsByRange(
    periodStart: string,
    periodEnd: string
  ): Promise<AWEvent[]> {
    const timeperiods = [`${periodStart}/${periodEnd}`];
    const queryLines = [
      'window_events = query_bucket("aw-watcher-window_*");',
      `window_events = filter_period_intersect(window_events, "${periodStart}/${periodEnd}");`,
      'window_events = sort_by_timestamp(window_events);',
      'RETURN = window_events;',
    ];

    const result = await this.query(timeperiods, queryLines);
    const allEvents: AWEvent[] = [];
    for (const events of Object.values(result)) {
      if (Array.isArray(events)) {
        allEvents.push(...events);
      }
    }
    return allEvents.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }
}

export function createAWClient(baseUrl?: string): ActivityWatchClient {
  return new ActivityWatchClient(baseUrl);
}
