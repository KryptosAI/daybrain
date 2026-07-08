const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(require('os').homedir(), '.daybrain', 'data', 'daybrain.db');
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');
if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');

let passed = 0;
let failed = 0;

function test(label: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.then(() => { passed++; console.log(`  ✓ ${label}`); })
        .catch(err => { failed++; console.log(`  ✗ ${label}: ${err.message}`); });
    } else {
      passed++;
      console.log(`  ✓ ${label}`);
    }
  } catch (err: any) {
    failed++;
    console.log(`  ✗ ${label}: ${err.message}`);
  }
}

console.log('=== OpenContext Test Suite ===\n');

const { getDb, insertRawEvents, insertInsights, getRawEvents, getInsights, upsertDailySummary, getDailySummary, closeDb } = require('./dist/db.js');
const { createInsightEngine } = require('./dist/insights.js');
const { loadConfig } = require('./dist/config.js');

test('config loads with defaults', () => {
  const cfg = loadConfig();
  assert(cfg.activitywatch.enabled === true);
  assert(cfg.insights.scheduleIntervalMinutes === 60);
  assert(cfg.dataDir.includes('.daybrain'));
});

test('database initializes with all tables', () => {
  const db = getDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t: any) => t.name);
  assert(tables.includes('raw_events'));
  assert(tables.includes('insights'));
  assert(tables.includes('daily_summaries'));
  assert(tables.includes('config'));
});

test('event deduplication works', () => {
  const events = [
    { source: 'activitywatch', bucket_id: 'test', timestamp: '2026-07-08T08:00:00Z', duration: 60, app: 'VS Code', title: 'test.ts', url: '', raw_data: '{}' },
    { source: 'activitywatch', bucket_id: 'test', timestamp: '2026-07-08T08:00:00Z', duration: 60, app: 'VS Code', title: 'test.ts', url: '', raw_data: '{}' },
    { source: 'activitywatch', bucket_id: 'test', timestamp: '2026-07-08T08:01:00Z', duration: 60, app: 'Slack', title: 'chat', url: '', raw_data: '{}' },
  ];
  const c1 = insertRawEvents(events);
  assert.strictEqual(c1, 2, 'first insert should insert 2 unique events');

  const c2 = insertRawEvents(events);
  assert.strictEqual(c2, 0, 'second insert should insert 0 (all duplicates)');
});

test('insight deduplication works', () => {
  const insights = [
    { type: 'commitment', period_start: '2026-07-08', period_end: '2026-07-08', title: 'Test insight A', description: 'desc', confidence: 0.8, evidence: '[]', action_text: 'act' },
    { type: 'commitment', period_start: '2026-07-08', period_end: '2026-07-08', title: 'Test insight A', description: 'desc', confidence: 0.8, evidence: '[]', action_text: 'act' },
    { type: 'avoidance', period_start: '2026-07-08', period_end: '2026-07-08', title: 'Test insight B', description: 'desc', confidence: 0.5, evidence: '[]', action_text: '' },
  ];
  const i1 = insertInsights(insights);
  assert.strictEqual(i1, 2, 'first insert should create 2 unique insights');

  const i2 = insertInsights(insights);
  assert.strictEqual(i2, 0, 'second insert should create 0 (all duplicates)');
});

test('daily summary upsert accumulates insight_count', () => {
  upsertDailySummary({
    date: '2026-07-08',
    total_active_time: 3600,
    top_apps: JSON.stringify([{ app: 'VS Code', minutes: 60 }]),
    switch_count: 10,
    insight_count: 5,
    raw_summary: 'test',
  });
  const s1 = getDailySummary('2026-07-08');
  assert(s1);
  assert.strictEqual(s1!.insight_count, 5);

  upsertDailySummary({
    date: '2026-07-08',
    total_active_time: 7200,
    top_apps: JSON.stringify([{ app: 'VS Code', minutes: 120 }]),
    switch_count: 20,
    insight_count: 3,
    raw_summary: 'updated',
  });
  const s2 = getDailySummary('2026-07-08');
  assert(s2);
  assert.strictEqual(s2!.insight_count, 8, 'insight_count should accumulate: 5 + 3 = 8');
  assert.strictEqual(s2!.total_active_time, 7200, 'total_active_time should be overwritten by latest (not accumulated)');
});

test('insight engine detects commitments', () => {
  const engine = createInsightEngine(0.4);
  const events = [
    { timestamp: '2026-07-08T08:00:00Z', duration: 120, data: { app: 'Slack', title: 'I will send the report by Friday - Sarah', url: '' } },
    { timestamp: '2026-07-08T08:02:00Z', duration: 300, data: { app: 'Slack', title: 'let me check that for you', url: '' } },
    { timestamp: '2026-07-08T08:03:00Z', duration: 60, data: { app: 'Slack', title: 'I promise to fix the billing bug today', url: '' } },
  ];
  const commitments = engine.extractCommitments(events);
  assert(commitments.length >= 2, `expected at least 2 commitments, got ${commitments.length}`);
  assert(commitments[0].type === 'commitment');
});

test('insight engine detects avoidance patterns', () => {
  const engine = createInsightEngine(0.4);
  const events = [];
  let ts = new Date('2026-07-08T08:00:00Z');
  for (let i = 0; i < 10; i++) {
    events.push({ timestamp: new Date(ts.getTime() + i * 60000).toISOString(), duration: 5, data: { app: 'Twitter', title: 'Home', url: '' } });
  }
  const avoidance = engine.detectAvoidance(events);
  assert(avoidance.length >= 1, `expected at least 1 avoidance insight, got ${avoidance.length}`);
  const tw = avoidance.find(i => i.title.includes('Twitter'));
  assert(tw, 'should detect frequent brief visits to Twitter');
});

test('insight engine categorizes apps correctly', () => {
  const engine = createInsightEngine();
  const events = [
    { timestamp: '2026-07-08T08:00:00Z', duration: 600, data: { app: 'VS Code', title: 'code.ts', url: '' } },
    { timestamp: '2026-07-08T08:10:00Z', duration: 300, data: { app: 'Slack', title: 'chat', url: '' } },
    { timestamp: '2026-07-08T08:15:00Z', duration: 200, data: { app: 'Google Chrome', title: 'news', url: '' } },
    { timestamp: '2026-07-08T08:18:00Z', duration: 100, data: { app: 'Spotify', title: 'music', url: '' } },
  ];
  const { appSummaries } = engine.analyzeWindowEvents(events);
  const vscode = appSummaries.find(a => a.app === 'VS Code');
  const slack = appSummaries.find(a => a.app === 'Slack');
  const chrome = appSummaries.find(a => a.app === 'Google Chrome');
  const spotify = appSummaries.find(a => a.app === 'Spotify');
  assert(vscode && vscode.category === 'productive');
  assert(slack && slack.category === 'communication');
  assert(chrome && chrome.category === 'browser');
  assert(spotify && spotify.category === 'other');
});

test('insight engine detects project context with explicit keywords', () => {
  const engine = createInsightEngine();
  const events = [
    { timestamp: '2026-07-08T08:00:00Z', duration: 300, data: { app: 'VS Code', title: 'billing-pipeline/src/main.ts - Cursor', url: '' } },
    { timestamp: '2026-07-08T08:05:00Z', duration: 200, data: { app: 'Terminal', title: 'billing-pipeline npm test', url: '' } },
    { timestamp: '2026-07-08T08:07:00Z', duration: 100, data: { app: 'Slack', title: '#eng - billing pipeline discussion', url: '' } },
    { timestamp: '2026-07-08T08:09:00Z', duration: 50, data: { app: 'Google Chrome', title: 'AWS Billing Docs', url: '' } },
  ];
  const projects = engine.detectProjectContext(events, ['billing']);
  assert(projects.length >= 1, `expected at least 1 project, got ${projects.length}`);
  assert(projects[0].project === 'billing');
  assert(projects[0].eventCount >= 3, `expected 3+ events for billing, got ${projects[0].eventCount}`);
});

test('insight engine detects focus blocks', () => {
  const engine = createInsightEngine();
  const events = [];
  let ts = new Date('2026-07-08T08:00:00Z');
  for (let i = 0; i < 30; i++) {
    events.push({ timestamp: new Date(ts.getTime() + i * 60000).toISOString(), duration: 55, data: { app: 'VS Code', title: 'src/main.ts', url: '' } });
  }
  const focusBlocks = engine.detectFocusBlocks(events);
  assert(focusBlocks.length >= 1, `expected at least 1 focus block, got ${focusBlocks.length}`);
  assert(focusBlocks[0].app === 'VS Code');
  assert(focusBlocks[0].durationMinutes >= 27, `expected >= 27 min focus, got ${focusBlocks[0].durationMinutes}`);
});

test('insight engine generates readable daily summary', () => {
  const engine = createInsightEngine();
  const events = [
    { timestamp: '2026-07-08T08:00:00Z', duration: 600, data: { app: 'VS Code', title: 'main.ts', url: '' } },
    { timestamp: '2026-07-08T08:10:00Z', duration: 300, data: { app: 'Slack', title: 'chat', url: '' } },
  ];
  const summary = engine.generateDailySummary(events);
  assert(summary.includes('Activity Summary'));
  assert(summary.includes('VS Code'));
  assert(summary.includes('Slack'));
});

test('runFullAnalysis produces non-empty results with valid data', () => {
  const engine = createInsightEngine(0.4);
  const events = [];
  let ts = new Date('2026-07-08T08:00:00Z');
  const apps = [
    { app: 'VS Code', title: 'src/index.ts - Cursor' },
    { app: 'Slack', title: 'I will send the demo by Friday' },
    { app: 'Google Chrome', title: 'StackOverflow' },
    { app: 'Twitter', title: 'Home' },
    { app: 'Twitter', title: 'Explore' },
    { app: 'Twitter', title: 'Notifications' },
    { app: 'Twitter', title: 'Messages' },
    { app: 'Twitter', title: 'Search' },
    { app: 'VS Code', title: 'src/config.ts - Cursor' },
    { app: 'Slack', title: 'let me follow up on that' },
    { app: 'Google Chrome', title: 'GitHub PR review' },
  ];
  apps.forEach((a, i) => {
    events.push({ timestamp: new Date(ts.getTime() + i * 120000).toISOString(), duration: 60 + Math.random() * 300, data: { app: a.app, title: a.title, url: '' } });
  });
  const result = engine.runFullAnalysis(events);
  assert(result.summary.length > 0);
  assert(result.appSummaries.length >= 3);
  assert(result.totalActiveTime > 0);
  const totalCommitments = result.insights.filter(i => i.type === 'commitment').length;
  assert(totalCommitments >= 1, `expected at least 1 commitment, got ${totalCommitments}`);
});

test('closeDb is exported and callable', () => {
  assert.strictEqual(typeof closeDb, 'function');
  closeDb();
  assert.ok(true, 'closeDb called without error');
});

// --- SECURITY & PRODUCTION TESTS ---

const { getConfigPath } = require('./dist/config.js');

test('config file has restricted permissions (0600)', () => {
  const cfgPath = getConfigPath();
  const stats = fs.statSync(cfgPath);
  const mode = (stats.mode & 0o777).toString(8);
  assert(['600', '400'].includes(mode), `config permissions should be 600, got ${mode}`);
});

test('dataDir path traversal is blocked', () => {
  const { loadConfig, getDataDir } = require('./dist/config.js');
  const cfg = loadConfig();
  const orig = cfg.dataDir;

  cfg.dataDir = '~/.opencontext/data/../../../../../tmp/evil';
  try {
    getDataDir();
    assert(false, 'should have thrown for traversal path');
  } catch (err: any) {
    assert(err.message.includes('home directory'), 'error should mention home directory');
  }

  cfg.dataDir = '/etc/passwd';
  try {
    getDataDir();
    assert(false, 'should have thrown for absolute path');
  } catch (err: any) {
    assert(err.message.includes('home directory'), 'error should mention home directory');
  }

  cfg.dataDir = orig;
});

test('getConfig returns immutable clone', () => {
  const { getConfig } = require('./dist/config.js');
  const cfg1 = getConfig();
  const cfg2 = getConfig();
  cfg1.activitywatch.enabled = !cfg1.activitywatch.enabled;
  const cfg3 = getConfig();
  assert.notStrictEqual(cfg1, cfg2, 'should return different objects');
  assert.notStrictEqual(cfg3.activitywatch.enabled, cfg1.activitywatch.enabled, 'mutation should not propagate');
});

test('undefined/null app names are filtered out', () => {
  const engine = createInsightEngine();
  const events = [
    { timestamp: '2026-07-08T08:00:00Z', duration: 60, data: { app: undefined, title: 'bad' } },
    { timestamp: '2026-07-08T08:00:30Z', duration: 60, data: { app: null, title: 'bad' } },
    { timestamp: '2026-07-08T08:01:00Z', duration: 60, data: { } },
    { timestamp: '2026-07-08T08:02:00Z', duration: 60, data: { app: 'VS Code', title: 'good' } },
  ];
  const { appSummaries } = engine.analyzeWindowEvents(events);
  const hasBad = appSummaries.some(a => a.app === 'Undefined' || a.app === 'undefined');
  assert(!hasBad, 'should not contain "undefined" app entry');
  assert.strictEqual(appSummaries.length, 1, 'only VS Code should appear');
  assert.strictEqual(appSummaries[0].app, 'VS Code');
});

test('scheduler has overlap guard', () => {
  const { startScheduler, stopScheduler } = require('./dist/scheduler.js');
  startScheduler(60);
  startScheduler(60); // double start should be no-op
  stopScheduler();
  assert.ok(true, 'double start/stop without crash');
});

test('MCP server registers uncaughtException handler', () => {
  const idxSource = fs.readFileSync(path.join(__dirname, 'dist', 'index.js'), 'utf-8');
  assert.ok(idxSource.includes('uncaughtException'), 'uncaughtException handler exists');
  assert.ok(idxSource.includes('unhandledRejection'), 'unhandledRejection handler exists');
});

test('insight engine handles empty events gracefully', () => {
  const engine = createInsightEngine();
  const result = engine.runFullAnalysis([]);
  assert.strictEqual(result.insights.length, 0);
  assert.strictEqual(result.appSummaries.length, 0);
  assert.strictEqual(result.totalActiveTime, 0);
  assert(result.summary.length > 0, 'should provide fallback message');
});

test('insight engine handles very large event arrays', () => {
  const engine = createInsightEngine();
  const events = [];
  let ts = new Date('2026-07-08T00:00:00Z');
  for (let i = 0; i < 1000; i++) {
    events.push({
      timestamp: new Date(ts.getTime() + i * 30000).toISOString(),
      duration: 10 + Math.random() * 120,
      data: { app: ['VS Code', 'Slack', 'Chrome', 'Terminal'][i % 4], title: `Event ${i}`, url: '' },
    });
  }
  const start = Date.now();
  const result = engine.runFullAnalysis(events);
  const elapsed = Date.now() - start;
  assert(result.appSummaries.length > 0, 'should produce summaries for large input');
  assert(elapsed < 5000, `large input should complete in <5s, took ${elapsed}ms`);
});

console.log(`\nRESULTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
