import Database from 'better-sqlite3';
import path from 'path';
import { getDataDir } from './config';

let db: Database.Database | null = null;

export interface RawEvent {
  source: 'activitywatch' | 'screenpipe' | 'native';
  bucket_id: string;
  timestamp: string;
  duration: number;
  app: string;
  title: string;
  url: string;
  raw_data: string;
}

export interface StoredRawEvent extends RawEvent {
  id: number;
  created_at: string;
}

export interface Insight {
  type: 'commitment' | 'avoidance' | 'pattern' | 'summary' | 'context_switch' | 'focus' | 'deadline';
  period_start: string;
  period_end: string;
  title: string;
  description: string;
  confidence: number;
  evidence: string;
  action_text: string;
  status?: string;
}

export interface StoredInsight extends Insight {
  id: number;
  status: string;
  created_at: string;
  pushed_to: string | null;
  pushed_at: string | null;
}

export interface DailySummary {
  date: string;
  total_active_time: number;
  top_apps: string;
  switch_count: number;
  insight_count: number;
  raw_summary: string;
}

export interface StoredDailySummary extends DailySummary {
  id: number;
  created_at: string;
}

export function getDb(): Database.Database {
  if (db) return db;

  const dataDir = getDataDir();
  const dbPath = path.join(dataDir, 'opencontext.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  initializeSchema(db);
  return db;
}

function initializeSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS raw_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      bucket_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      duration REAL NOT NULL DEFAULT 0,
      app TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      raw_data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_events_dedup
      ON raw_events(timestamp, source, bucket_id, app, title);

    CREATE INDEX IF NOT EXISTS idx_raw_events_timestamp ON raw_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_raw_events_app ON raw_events(app);
    CREATE INDEX IF NOT EXISTS idx_raw_events_source ON raw_events(source);

    CREATE TABLE IF NOT EXISTS insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0.5,
      evidence TEXT NOT NULL DEFAULT '[]',
      action_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      pushed_to TEXT,
      pushed_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_insights_dedup
      ON insights(type, title, period_start);

    CREATE INDEX IF NOT EXISTS idx_insights_type ON insights(type);
    CREATE INDEX IF NOT EXISTS idx_insights_period ON insights(period_start, period_end);
    CREATE INDEX IF NOT EXISTS idx_insights_created ON insights(created_at);
    CREATE INDEX IF NOT EXISTS idx_insights_status ON insights(status);

    CREATE TABLE IF NOT EXISTS daily_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      total_active_time REAL NOT NULL DEFAULT 0,
      top_apps TEXT NOT NULL DEFAULT '[]',
      switch_count INTEGER NOT NULL DEFAULT 0,
      insight_count INTEGER NOT NULL DEFAULT 0,
      raw_summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function insertRawEvents(events: RawEvent[]): number {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO raw_events (source, bucket_id, timestamp, duration, app, title, url, raw_data)
    VALUES (@source, @bucket_id, @timestamp, @duration, @app, @title, @url, @raw_data)
  `);

  const insertMany = database.transaction((evts: RawEvent[]) => {
    let count = 0;
    for (const evt of evts) {
      try {
        stmt.run(evt);
        count++;
      } catch {
        // duplicate event, skip silently
      }
    }
    return count;
  });

  return insertMany(events);
}

export function getRawEvents(options: {
  periodStart?: string;
  periodEnd?: string;
  source?: string;
  app?: string;
  limit?: number;
  offset?: number;
}): StoredRawEvent[] {
  const database = getDb();
  const conditions: string[] = [];
  const values: (string | number)[] = [];

  if (options.periodStart) {
    conditions.push('timestamp >= ?');
    values.push(options.periodStart);
  }
  if (options.periodEnd) {
    conditions.push('timestamp <= ?');
    values.push(options.periodEnd);
  }
  if (options.source) {
    conditions.push('source = ?');
    values.push(options.source);
  }
  if (options.app) {
    conditions.push('app LIKE ?');
    values.push(`%${options.app}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(options.limit || 1000, 5000);
  const offset = options.offset || 0;

  return database
    .prepare(`SELECT * FROM raw_events ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
    .all(...values, limit, offset) as StoredRawEvent[];
}

export function insertInsight(insight: Insight): StoredInsight | null {
  const database = getDb();
  try {
    const result = database
      .prepare(
        `INSERT INTO insights (type, period_start, period_end, title, description, confidence, evidence, action_text)
         VALUES (@type, @period_start, @period_end, @title, @description, @confidence, @evidence, @action_text)`
      )
      .run(insight);

    return database
      .prepare('SELECT * FROM insights WHERE id = ?')
      .get(result.lastInsertRowid) as StoredInsight;
  } catch {
    return null; // duplicate insight
  }
}

export function insertInsights(insights: Insight[]): number {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO insights (type, period_start, period_end, title, description, confidence, evidence, action_text)
    VALUES (@type, @period_start, @period_end, @title, @description, @confidence, @evidence, @action_text)
  `);

  const insertMany = database.transaction((items: Insight[]) => {
    let count = 0;
    for (const item of items) {
      try {
        stmt.run(item);
        count++;
      } catch {
        // duplicate insight, skip silently
      }
    }
    return count;
  });

  return insertMany(insights);
}

export function getInsights(options: {
  type?: string;
  periodStart?: string;
  periodEnd?: string;
  minConfidence?: number;
  limit?: number;
  includePushed?: boolean;
}): StoredInsight[] {
  const database = getDb();
  const conditions: string[] = [];
  const values: (string | number)[] = [];

  if (options.type) {
    conditions.push('type = ?');
    values.push(options.type);
  }
  if (options.periodStart) {
    conditions.push('period_start >= ?');
    values.push(options.periodStart);
  }
  if (options.periodEnd) {
    conditions.push('period_end <= ?');
    values.push(options.periodEnd);
  }
  if (options.minConfidence) {
    conditions.push('confidence >= ?');
    values.push(options.minConfidence);
  }
  if (!options.includePushed) {
    conditions.push('pushed_to IS NULL');
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit || 50;

  return database
    .prepare(`SELECT * FROM insights ${where} ORDER BY confidence DESC, created_at DESC LIMIT ?`)
    .all(...values, limit) as StoredInsight[];
}

export function updateInsightStatus(id: number, status: string): void {
  const database = getDb();
  database
    .prepare("UPDATE insights SET status = ? WHERE id = ?")
    .run(status, id);
}

export function markInsightPushed(id: number, target: string): void {
  const database = getDb();
  const insight = database.prepare('SELECT * FROM insights WHERE id = ?').get(id) as StoredInsight | undefined;
  if (!insight) return;

  const existing = insight.pushed_to ? insight.pushed_to.split(',').map((s: string) => s.trim()) : [];
  if (!existing.includes(target)) {
    existing.push(target);
  }

  database
    .prepare('UPDATE insights SET pushed_to = ?, pushed_at = datetime(\'now\') WHERE id = ?')
    .run(existing.join(','), id);
}

export function upsertDailySummary(summary: DailySummary): void {
  const database = getDb();
    database
    .prepare(
      `INSERT INTO daily_summaries (date, total_active_time, top_apps, switch_count, insight_count, raw_summary)
       VALUES (@date, @total_active_time, @top_apps, @switch_count, @insight_count, @raw_summary)
       ON CONFLICT(date) DO UPDATE SET
         total_active_time = excluded.total_active_time,
         top_apps = excluded.top_apps,
         switch_count = excluded.switch_count,
         insight_count = daily_summaries.insight_count + excluded.insight_count,
         raw_summary = excluded.raw_summary,
         created_at = datetime('now')`
    )
    .run(summary);
}

export function getDailySummary(date: string): StoredDailySummary | undefined {
  const database = getDb();
  return database
    .prepare('SELECT * FROM daily_summaries WHERE date = ?')
    .get(date) as StoredDailySummary | undefined;
}

export function getRecentDailySummaries(days: number): StoredDailySummary[] {
  const database = getDb();
  return database
    .prepare(
      `SELECT * FROM daily_summaries WHERE date >= date('now', ?) ORDER BY date DESC`
    )
    .all(`-${days} days`) as StoredDailySummary[];
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
