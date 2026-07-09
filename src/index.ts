#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { loadConfig, getConfig, getDataDir, getConfigPath, OpenContextConfig } from './config';
import { getDb, getRawEvents, getInsights, getDailySummary, getRecentDailySummaries, insertRawEvents, insertInsights, markInsightPushed, closeDb } from './db';
import { createAWClient, AWEvent, ActivityWatchClient } from './aw';
import { createScreenpipeClient } from './screenpipe';
import { createInsightEngine, InsightEngine } from './insights';
import { pushInsightToAll, pushSummary } from './transport';
import { startScheduler, stopScheduler, runInsightLoop } from './scheduler';
import { startNativeWatcher, stopNativeWatcher, getWatcherStatus } from './watcher';
import { startHttpServer, stopHttpServer } from './http';

const SERVER_NAME = 'daybrain';
const SERVER_VERSION = '0.3.0';

interface ToolHandler {
  (args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text?: string; [key: string]: unknown }> }>;
}

function buildTools(): Tool[] {
  return [
    {
      name: 'get_activity_summary',
      description: 'Get a summary of your digital activity. Shows what apps you used, for how long, categorized by type. Ask "What did I do today?" or "How productive was I?" to use this.',
      inputSchema: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Date to summarize (YYYY-MM-DD). Defaults to today.',
          },
          period: {
            type: 'string',
            description: 'Alternative: time period string. E.g. "today", "yesterday", "last 7 days". Overrides date.',
          },
          include_hourly: {
            type: 'boolean',
            description: 'Include hourly breakdown of activity.',
          },
        },
      },
    },
    {
      name: 'get_context_switching',
      description: 'Analyze how often you switch between different apps and identify distraction patterns. Ask "How much did I context switch today?"',
      inputSchema: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Date to analyze (YYYY-MM-DD). Defaults to today.',
          },
          period: {
            type: 'string',
            description: 'Alternative: time period string.',
          },
        },
      },
    },
    {
      name: 'get_insights',
      description: 'Extract insights from your activity: commitments you made, things you might be avoiding, focus patterns, and unusual behavior. Ask "What am I avoiding?" or "What promises did I make?"',
      inputSchema: {
        type: 'object',
        properties: {
          type_filter: {
            type: 'string',
            description: 'Filter by insight type: commitment, avoidance, pattern, context_switch, focus, deadline',
          },
          min_confidence: {
            type: 'number',
            description: 'Minimum confidence threshold (0.0-1.0). Default 0.4.',
          },
          date: {
            type: 'string',
            description: 'Date to analyze (YYYY-MM-DD). Defaults to today.',
          },
          limit: {
            type: 'number',
            description: 'Maximum insights to return (default 20).',
          },
        },
      },
    },
    {
      name: 'get_project_context',
      description: 'Get activity related to a specific project. Finds all windows and apps connected to a project keyword. Ask "Summarize my work on project X."',
      inputSchema: {
        type: 'object',
        properties: {
          project_keyword: {
            type: 'string',
            description: 'Keyword or project name to search for in window titles.',
          },
          date: {
            type: 'string',
            description: 'Date to analyze (YYYY-MM-DD). Defaults to today.',
          },
        },
        required: ['project_keyword'],
      },
    },
    {
      name: 'get_raw_events',
      description: 'Get raw activity events from the local database. Useful for custom analysis or debugging.',
      inputSchema: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Date to query (YYYY-MM-DD). Defaults to today.',
          },
          source: {
            type: 'string',
            description: 'Filter by source: activitywatch or screenpipe.',
          },
          app_filter: {
            type: 'string',
            description: 'Filter events by app name (partial match).',
          },
          limit: {
            type: 'number',
            description: 'Maximum events to return (default 500, max 5000).',
          },
          offset: {
            type: 'number',
            description: 'Offset for pagination.',
          },
        },
      },
    },
    {
      name: 'run_insight_loop',
      description: 'Manually trigger the insight extraction loop. Pulls fresh data from ActivityWatch, extracts insights, and stores them.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'push_insight',
      description: 'Push a specific insight or summary to configured transports (Slack, Telegram, webhook).',
      inputSchema: {
        type: 'object',
        properties: {
          insight_id: {
            type: 'number',
            description: 'ID of the insight to push. If omitted, pushes the latest daily summary.',
          },
          targets: {
            type: 'array',
            items: { type: 'string' },
            description: 'Transport targets: slack, telegram, webhook. If omitted, uses all configured transports.',
          },
        },
      },
    },
    {
      name: 'health_check',
      description: 'Check the status of OpenContext and all connected data sources (ActivityWatch, Screenpipe).',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_configuration',
      description: 'View current OpenContext configuration.',
      inputSchema: {
        type: 'object',
        properties: {
          section: {
            type: 'string',
            description: 'Config section to view: activitywatch, screenpipe, transports, insights, or all.',
          },
        },
      },
    },
    {
      name: 'create_linear_task',
      description: 'Create a Linear issue from a detected commitment or insight. Requires a Linear API key in config.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title (e.g., "Send demo to Sarah by Friday")' },
          description: { type: 'string', description: 'Optional task description' },
          team_id: { type: 'string', description: 'Linear team ID (e.g., "ENG")' },
        },
        required: ['title'],
      },
    },
    {
      name: 'create_github_issue',
      description: 'Create a GitHub issue from a detected commitment or insight. Requires a GitHub token and repo in config.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Issue title' },
          body: { type: 'string', description: 'Optional issue body' },
          repo: { type: 'string', description: 'Repository (e.g., "owner/repo"). Defaults to configured repo.' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Labels to apply' },
        },
        required: ['title'],
      },
    },
  ];
}

function getDateRange(args: Record<string, unknown>): { start: string; end: string } {
  let date: string;
  if (args.period) {
    date = String(args.period);
  } else if (args.date) {
    date = String(args.date);
  } else {
    date = 'today';
  }

  const start: Date = new Date();
  const end: Date = new Date();

  if (date === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (date === 'yesterday') {
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() - 1);
    end.setHours(23, 59, 59, 999);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, d] = date.split('-').map(Number);
    start.setFullYear(y, m - 1, d);
    start.setHours(0, 0, 0, 0);
    end.setFullYear(y, m - 1, d);
    end.setHours(23, 59, 59, 999);
  } else if (/^\d{4}-\d{2}-\d{2},\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [startStr, endStr] = date.split(',');
    start.setTime(new Date(startStr).getTime());
    start.setHours(0, 0, 0, 0);
    end.setTime(new Date(endStr).getTime());
    end.setHours(23, 59, 59, 999);
  } else if (/^last\s+(\d+)\s+days?$/i.test(date)) {
    const match = date.match(/^last\s+(\d+)\s+days?$/i);
    const days = parseInt(match![1], 10);
    start.setDate(start.getDate() - days);
    start.setHours(0, 0, 0, 0);
  } else if (date === 'this week') {
    const dayOfWeek = start.getDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    start.setDate(start.getDate() - diffToMonday);
    start.setHours(0, 0, 0, 0);
  } else if (date === 'last week') {
    const dayOfWeek = start.getDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    start.setDate(start.getDate() - diffToMonday - 7);
    start.setHours(0, 0, 0, 0);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

async function fetchEvents(args: Record<string, unknown>): Promise<{
  events: AWEvent[];
  periodStart: string;
  periodEnd: string;
  fromCache: boolean;
}> {
  const { start, end } = getDateRange(args);

  const cachedEvents = getRawEvents({
    periodStart: start,
    periodEnd: end,
    limit: 10000,
  });

  const isToday = new Date(start).toDateString() === new Date().toDateString();
  const cacheAge = cachedEvents.length > 0
    ? Date.now() - new Date(cachedEvents[cachedEvents.length - 1].timestamp).getTime()
    : Infinity;
  const isStale = isToday && (cachedEvents.length === 0 || cacheAge > 15 * 60 * 1000);

  if (cachedEvents.length > 0 && !isStale) {
    return {
      events: cachedEvents.map(e => ({
        timestamp: e.timestamp,
        duration: e.duration,
        data: { app: e.app, title: e.title, url: e.url },
      })),
      periodStart: start,
      periodEnd: end,
      fromCache: true,
    };
  }

    const aw = createAWClient();
  try {
    const windowEvents = await aw.getWindowEventsByRange(start, end);

    const rawEvts = windowEvents.map((evt: AWEvent) => ({
      source: 'activitywatch' as const,
      bucket_id: 'aw-watcher-window',
      timestamp: evt.timestamp,
      duration: evt.duration,
      app: String(evt.data?.app || ''),
      title: String(evt.data?.title || ''),
      url: String(evt.data?.url || ''),
      raw_data: JSON.stringify(evt.data),
    }));
    if (rawEvts.length > 0) {
      try { insertRawEvents(rawEvts); } catch {}
    }

    return {
      events: windowEvents,
      periodStart: start,
      periodEnd: end,
      fromCache: false,
    };
  } catch (err) {
    console.error('[daybrain] Failed to fetch AW events:', err instanceof Error ? err.message : String(err));
    return {
      events: [],
      periodStart: start,
      periodEnd: end,
      fromCache: false,
    };
  }
}

const toolHandlers: Record<string, ToolHandler> = {
  async get_activity_summary(args) {
    const { events, periodStart, periodEnd, fromCache } = await fetchEvents(args);

    if (events.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No activity data found for this period. Make sure ActivityWatch is running (https://activitywatch.net).',
        }],
      };
    }

    const engine = createInsightEngine();
    const { appSummaries, totalActiveTime, uniqueApps, hourlyBreakdown } = engine.analyzeWindowEvents(events);
    const summary = engine.generateDailySummary(events);
    const focusBlocks = engine.detectFocusBlocks(events);

    let result = summary;
    result += `\nData source: ${fromCache ? 'local cache' : 'fresh from ActivityWatch'}`;

    if (args.include_hourly && hourlyBreakdown.length > 0) {
      result += `\n\nHourly Breakdown:\n`;
      for (const h of hourlyBreakdown) {
        const timeLabel = h.hour.slice(11, 16);
        result += `  ${timeLabel}  ${h.topApp.padEnd(20)} ${h.activeMinutes}min active  ${h.switchCount} switches\n`;
      }
    }

    if (focusBlocks.length > 0) {
      result += `\n\nFocus Blocks (>10 min uninterrupted):\n`;
      for (const b of focusBlocks.slice(0, 5)) {
        result += `  ${b.app} — ${b.durationMinutes} minutes\n`;
      }
    }

    return {
      content: [{ type: 'text', text: result }],
    };
  },

  async get_context_switching(args) {
    const { events, fromCache } = await fetchEvents(args);

    if (events.length === 0) {
      return {
        content: [{ type: 'text', text: 'No activity data found. Make sure ActivityWatch is running.' }],
      };
    }

    const engine = createInsightEngine();
    const { contextSwitches, hourlyBreakdown, totalActiveTime } = engine.analyzeWindowEvents(events);

    let result = `Context Switching Report\n`;
    result += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    result += `Data source: ${fromCache ? 'local cache' : 'fresh from AW'}\n\n`;

    const totalSwitches = contextSwitches.reduce((s, c) => s + c.count, 0);
    const activeHours = totalActiveTime / 3600;
    const switchesPerHour = activeHours > 0 ? Math.round(totalSwitches / activeHours) : 0;

    result += `Total switches: ${totalSwitches}\n`;
    result += `Switches per active hour: ${switchesPerHour}\n`;
    result += `Verdict: ${switchesPerHour > 30 ? 'High fragmentation — consider batching tasks' : switchesPerHour > 15 ? 'Moderate switching — room for improvement' : 'Good focus levels'}\n\n`;

    result += `Top App Transitions:\n`;
    for (const sw of contextSwitches.slice(0, 15)) {
      result += `  ${sw.fromApp} → ${sw.toApp}: ${sw.count}x\n`;
    }

    result += `\nHourly Switching:\n`;
    for (const h of hourlyBreakdown) {
      const timeLabel = h.hour.slice(11, 16);
      const indicator = h.switchCount > 25 ? '🔴' : h.switchCount > 15 ? '🟡' : '🟢';
      result += `  ${timeLabel} ${indicator} ${h.switchCount} switches (${h.activeMinutes}min active, primary: ${h.topApp})\n`;
    }

    const switchingInsights = engine.detectContextSwitchingProblems(events);
    if (switchingInsights.length > 0) {
      result += `\nDetected Issues:\n`;
      for (const insight of switchingInsights) {
        result += `  ⚠ ${insight.title}\n`;
        result += `    ${insight.description}\n`;
        result += `    → ${insight.action_text}\n\n`;
      }
    }

    return {
      content: [{ type: 'text', text: result }],
    };
  },

  async get_insights(args) {
    const storedInsights = getInsights({
      type: args.type_filter ? String(args.type_filter) : undefined,
      minConfidence: args.min_confidence ? Number(args.min_confidence) : undefined,
      limit: args.limit ? Number(args.limit) : 20,
    });

    if (storedInsights.length === 0) {
      const { events } = await fetchEvents(args);

      if (events.length === 0) {
        return {
          content: [{ type: 'text', text: 'No activity data and no stored insights found. Make sure ActivityWatch is running and the insight loop has run (use `run_insight_loop` tool).' }],
        };
      }

      const engine = createInsightEngine();
      const analysis = engine.runFullAnalysis(events);

      if (analysis.insights.length > 0) {
        insertInsights(analysis.insights.map(i => ({
          type: i.type,
          period_start: i.period_start,
          period_end: i.period_end,
          title: i.title,
          description: i.description,
          confidence: i.confidence,
          evidence: i.evidence,
          action_text: i.action_text,
        })));
      }

      if (analysis.insights.length === 0) {
        return {
          content: [{ type: 'text', text: 'No significant insights detected in this period. Your activity patterns look normal.' }],
        };
      }

      let result = `Extracted Insights (fresh analysis)\n`;
      result += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      for (const insight of analysis.insights) {
        result += `${insightEmoji(insight.type)} ${insight.title} [${Math.round(insight.confidence * 100)}%]\n`;
        result += `   ${insight.description}\n`;
        if (insight.action_text) {
          result += `   → ${insight.action_text}\n`;
        }
        result += `\n`;
      }

      return {
        content: [{ type: 'text', text: result }],
      };
    }

    let result = `Stored Insights\n`;
    result += `━━━━━━━━━━━━━━\n\n`;

    for (const insight of storedInsights) {
      result += `${insightEmoji(insight.type)} ${insight.title} [${Math.round(insight.confidence * 100)}%]\n`;
      result += `   ${insight.description}\n`;
      if (insight.action_text) {
        result += `   → ${insight.action_text}\n`;
      }
      if (insight.pushed_to) {
        result += `   📤 Pushed to: ${insight.pushed_to}\n`;
      }
      result += `\n`;
    }

    return {
      content: [{ type: 'text', text: result }],
    };
  },

  async get_project_context(args) {
    const keyword = String(args.project_keyword || '');
    if (!keyword) {
      throw new McpError(ErrorCode.InvalidParams, 'project_keyword is required');
    }

    const { events, fromCache } = await fetchEvents(args);

    if (events.length === 0) {
      return {
        content: [{ type: 'text', text: 'No activity data found. Make sure ActivityWatch is running.' }],
      };
    }

    const engine = createInsightEngine();
    const projects = engine.detectProjectContext(events, [keyword]);

    if (projects.length === 0 || projects[0].eventCount === 0) {
      return {
        content: [{ type: 'text', text: `No activity found related to "${keyword}". Try a different keyword.` }],
      };
    }

    const p = projects[0];
    const totalMinutes = Math.round(p.totalDuration / 6) / 10;
    const totalHours = Math.round(p.totalDuration / 360) / 10;

    let result = `Project Context: "${p.project}"\n`;
    result += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    result += `Total time: ${totalHours >= 1 ? `${totalHours} hours` : `${totalMinutes} minutes`}\n`;
    result += `Events found: ${p.eventCount}\n`;
    result += `Related apps: ${p.relatedApps.join(', ')}\n`;
    result += `Data source: ${fromCache ? 'local cache' : 'fresh from AW'}\n\n`;

    if (p.relevantEvents.length > 0) {
      result += `Recent activity:\n`;
      for (const evt of p.relevantEvents.slice(0, 10)) {
        const time = new Date(evt.timestamp).toLocaleTimeString();
        result += `  [${time}] ${evt.app}: ${evt.title}\n`;
      }
    }

    return {
      content: [{ type: 'text', text: result }],
    };
  },

  async get_raw_events(args) {
    const limit = Math.min(args.limit ? Number(args.limit) : 500, 5000);
    const offset = args.offset ? Number(args.offset) : 0;
    const { start, end } = getDateRange(args);

    const events = getRawEvents({
      periodStart: start,
      periodEnd: end,
      source: args.source ? String(args.source) : undefined,
      app: args.app_filter ? String(args.app_filter) : undefined,
      limit,
      offset,
    });

    if (events.length === 0) {
      return {
        content: [{ type: 'text', text: 'No raw events found for this query. Make sure ActivityWatch is running.' }],
      };
    }

    let result = `Raw Events (${events.length} results)\n`;
    result += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const evt of events.slice(0, 50)) {
      const time = new Date(evt.timestamp).toLocaleTimeString();
      const dur = Math.round(evt.duration);
      result += `[${time}] ${evt.app} | ${evt.title.slice(0, 80)} | ${dur}s\n`;
    }

    if (events.length > 50) {
      result += `\n... and ${events.length - 50} more events. Use offset parameter to paginate.`;
    }

    return {
      content: [{ type: 'text', text: result }],
    };
  },

  async run_insight_loop(_args) {
    try {
      const result = await runInsightLoop();
      let text = `Insight loop completed.\n`;
      text += `━━━━━━━━━━━━━━━━━━━━━━\n`;
      text += `Events stored: ${result.eventsStored}\n`;
      text += `Insights generated: ${result.insightsGenerated}\n`;

      if (result.errors.length > 0) {
        text += `\nErrors:\n`;
        for (const err of result.errors) {
          text += `  - ${err}\n`;
        }
      }

      if (result.insightsGenerated > 0) {
        text += `\nUse get_insights to see the generated insights.`;
      }

      return {
        content: [{ type: 'text', text }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Insight loop failed: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  },

  async push_insight(args) {
    const config = loadConfig();
    let targets: string[] = [];

    if (args.targets && Array.isArray(args.targets)) {
      targets = args.targets.map(t => String(t));
    } else {
      if (config.transports.slack.webhookUrl) targets.push('slack');
      if (config.transports.telegram.botToken && config.transports.telegram.chatId) targets.push('telegram');
      if (config.transports.webhook.url) targets.push('webhook');
    }

    if (targets.length === 0) {
      return {
        content: [{ type: 'text', text: 'No transport targets configured. Use get_configuration to set up Slack, Telegram, or webhook.' }],
      };
    }

    if (args.insight_id) {
      const insight = getInsights({ includePushed: true, limit: 100 })
        .find(i => i.id === Number(args.insight_id));

      if (!insight) {
        return {
          content: [{ type: 'text', text: `Insight #${args.insight_id} not found.` }],
        };
      }

      const results = await pushInsightToAll(insight.title, insight.description, insight.action_text, targets);
      for (const r of results) {
        if (r.ok) markInsightPushed(insight.id, r.target);
      }

      let text = `Push results:\n`;
      for (const r of results) {
        text += `  ${r.target}: ${r.ok ? 'sent' : 'failed — ' + r.error}\n`;
      }

      return { content: [{ type: 'text', text }] };
    }

    const today = new Date().toISOString().slice(0, 10);
    const summary = getDailySummary(today);

    if (!summary) {
      return {
        content: [{ type: 'text', text: 'No daily summary available. Run insight_loop first.' }],
      };
    }

    const results = await pushSummary(summary.raw_summary, targets);
    let text = `Push results:\n`;
    for (const r of results) {
      text += `  ${r.target}: ${r.ok ? 'sent' : 'failed — ' + r.error}\n`;
    }

    return { content: [{ type: 'text', text }] };
  },

  async health_check(_args) {
    const config = loadConfig();
    const db = getDb();
    let text = `OpenContext Health Check\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `Version: ${SERVER_VERSION}\n`;
    text += `Config: ${getConfigPath()}\n`;
    text += `Data dir: ${getDataDir()}\n`;
    text += `Database: connected (WAL mode)\n\n`;

    text += `ActivityWatch:\n`;
    if (config.activitywatch.enabled) {
      const aw = createAWClient();
      const health = await aw.healthCheck();
      text += `  Status: ${health.ok ? 'connected' : 'unreachable'}\n`;
      if (health.version) text += `  Version: ${health.version}\n`;
      if (health.error) text += `  Error: ${health.error}\n`;

      if (health.ok) {
        const bucketsResult = await aw.getBuckets();
        if (bucketsResult.ok) {
          const bucketIds = Object.keys(bucketsResult.buckets);
          text += `  Buckets found: ${bucketIds.length}\n`;
          for (const id of bucketIds.slice(0, 10)) {
            text += `    - ${id} (${bucketsResult.buckets[id]})\n`;
          }
        } else {
          text += `  Buckets: error — ${bucketsResult.error}\n`;
        }
      } else {
        const watcherStatus = getWatcherStatus();
        if (watcherStatus.running) {
          text += `  Fallback: native watcher active (${watcherStatus.backend}, permissions: ${watcherStatus.permissions})\n`;
        } else {
          text += `  Fallback: native watcher not running. Install ActivityWatch or run: pip3 install pyobjc-framework-Quartz\n`;
        }
      }
    } else {
      text += `  Disabled in config\n`;
    }

    text += `\nScreenpipe:\n`;
    if (config.screenpipe.enabled) {
      const sp = createScreenpipeClient();
      const health = await sp.healthCheck();
      text += `  Status: ${health.ok ? 'connected' : 'unreachable'}\n`;
      if (health.error) text += `  Error: ${health.error}\n`;
    } else {
      text += `  Disabled in config\n`;
    }

    text += `\nTransports:\n`;
    text += `  Slack: ${config.transports.slack.webhookUrl ? 'configured' : 'not configured'}\n`;
    text += `  Telegram: ${config.transports.telegram.botToken && config.transports.telegram.chatId ? 'configured' : 'not configured'}\n`;
    text += `  Webhook: ${config.transports.webhook.url ? 'configured' : 'not configured'}\n`;

    text += `\nData:\n`;
    const today = new Date().toISOString().slice(0, 10);
    const summary = getDailySummary(today);
    if (summary) {
      text += `  Today's active time: ${Math.round(summary.total_active_time / 6) / 10} minutes\n`;
      text += `  Today's insights: ${summary.insight_count}\n`;
    } else {
      text += `  No data for today yet\n`;
    }

    const totalEvents = (db.prepare('SELECT COUNT(*) as count FROM raw_events').get() as { count: number }).count;
    const totalInsights = (db.prepare('SELECT COUNT(*) as count FROM insights').get() as { count: number }).count;
    text += `  Total events stored: ${totalEvents}\n`;
    text += `  Total insights: ${totalInsights}\n`;

    return {
      content: [{ type: 'text', text }],
    };
  },

  async get_configuration(args) {
    const config = loadConfig();
    const section = args.section ? String(args.section) : 'all';

    let text = `OpenContext Configuration\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `Config file: ${getConfigPath()}\n\n`;

    const printSection = (name: string, data: Record<string, unknown>) => {
      text += `${name}:\n`;
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'object' && value !== null) {
          text += `  ${key}:\n`;
          for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            const displayVal = typeof v === 'string' && v.length > 0 ? (v.length > 40 ? (v as string).slice(0, 37) + '...' : v) : v;
            text += `    ${k}: ${displayVal}\n`;
          }
        } else {
          text += `  ${key}: ${value}\n`;
        }
      }
      text += `\n`;
    };

    if (section === 'all' || section === 'activitywatch') printSection('ActivityWatch', config.activitywatch as unknown as Record<string, unknown>);
    if (section === 'all' || section === 'screenpipe') printSection('Screenpipe', config.screenpipe as unknown as Record<string, unknown>);
    if (section === 'all' || section === 'insights') printSection('Insights', config.insights as unknown as Record<string, unknown>);
    if (section === 'all' || section === 'transports') {
      text += `Transports:\n`;
      text += `  slack.webhookUrl: ${config.transports.slack.webhookUrl ? '***configured***' : 'not set'}\n`;
      text += `  telegram.botToken: ${config.transports.telegram.botToken ? '***configured***' : 'not set'}\n`;
      text += `  telegram.chatId: ${config.transports.telegram.chatId || 'not set'}\n`;
      text += `  webhook.url: ${config.transports.webhook.url || 'not set'}\n\n`;
    }

    text += `To change configuration, edit: ${getConfigPath()}`;

    return {
      content: [{ type: 'text', text }],
    };
  },

  async create_linear_task(args) {
    const title = String(args.title || '');
    if (!title) throw new McpError(ErrorCode.InvalidParams, 'title is required');

    const config = loadConfig();
    const apiKey = process.env.LINEAR_API_KEY || '';
    if (!apiKey) {
      return { content: [{ type: 'text', text: 'Linear API key not set. Export LINEA_API_KEY or add it to ~/.daybrain/config.json under "integrations.linear.apiKey".' }] };
    }

    try {
      const res = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
        body: JSON.stringify({
          query: `mutation CreateIssue($title: String!, $description: String, $teamId: String) {
            issueCreate(input: { title: $title, description: $description, teamId: $teamId }) {
              success
              issue { id title url }
            }
          }`,
          variables: {
            title,
            description: String(args.description || 'Created by DayBrain from detected commitment.'),
            teamId: args.team_id || undefined,
          },
        }),
      });
      const json = await res.json() as any;
      const issue = json?.data?.issueCreate?.issue;
      if (issue) {
        return { content: [{ type: 'text', text: `Created Linear issue: ${issue.title}\n${issue.url}` }] };
      }
      return { content: [{ type: 'text', text: `Linear API error: ${JSON.stringify(json.errors || json)}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Linear API call failed: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  },

  async create_github_issue(args) {
    const title = String(args.title || '');
    if (!title) throw new McpError(ErrorCode.InvalidParams, 'title is required');

    const config = loadConfig();
    const token = process.env.GITHUB_TOKEN || '';
    const repo = String(args.repo || config.transports.webhook.headers?.['x-github-repo'] || '');
    if (!token) {
      return { content: [{ type: 'text', text: 'GitHub token not set. Export GITHUB_TOKEN or create a personal access token at https://github.com/settings/tokens.' }] };
    }
    if (!repo) {
      return { content: [{ type: 'text', text: 'Repository not specified. Pass "repo" argument or set default in config.' }] };
    }

    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github+json' },
        body: JSON.stringify({
          title,
          body: String(args.body || 'Created by DayBrain from detected commitment.'),
          labels: Array.isArray(args.labels) ? args.labels : [],
        }),
      });
      const json = await res.json() as any;
      if (json.html_url) {
        return { content: [{ type: 'text', text: `Created GitHub issue: ${json.title}\n${json.html_url}` }] };
      }
      return { content: [{ type: 'text', text: `GitHub API error: ${JSON.stringify(json)}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `GitHub API call failed: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  },
};

function insightEmoji(type: string): string {
  switch (type) {
    case 'commitment': return '🤝';
    case 'avoidance': return '👀';
    case 'context_switch': return '🔄';
    case 'focus': return '🎯';
    case 'deadline': return '⏰';
    case 'pattern': return '📊';
    case 'summary': return '📋';
    default: return '💡';
  }
}

async function main(): Promise<void> {
  const config = loadConfig();

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  const tools = buildTools();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const handler = toolHandlers[name];
    if (!handler) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    try {
      return await handler(args ?? {});
    } catch (err) {
      if (err instanceof McpError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[daybrain] Tool error (${name}):`, message);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();

  server.onerror = (err) => {
    console.error('[daybrain] Server error:', err instanceof Error ? err.message : String(err));
  };

  process.on('SIGINT', () => {
    stopScheduler();
    stopNativeWatcher();
    stopHttpServer();
    closeDb();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    stopScheduler();
    stopNativeWatcher();
    stopHttpServer();
    closeDb();
    process.exit(0);
  });

  process.on('uncaughtException', (err) => {
    console.error('[daybrain] Uncaught exception:', err instanceof Error ? err.message : String(err));
    stopScheduler();
    stopNativeWatcher();
    stopHttpServer();
    try { closeDb(); } catch {}
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[daybrain] Unhandled rejection:', reason instanceof Error ? reason.message : String(reason));
  });

  await server.connect(transport);

  console.error(`[daybrain] v${SERVER_VERSION} started`);
  console.error(`[daybrain] Data dir: ${getDataDir()}`);
  console.error(`[daybrain] Config: ${getConfigPath()}`);
  console.error(`[daybrain] ${tools.length} tools registered`);

  if (config.activitywatch.enabled) {
    const aw = createAWClient();
    const awHealth = await aw.healthCheck();
    if (awHealth.ok) {
      console.error(`[daybrain] ActivityWatch connected (v${awHealth.version})`);
    } else {
      console.error(`[daybrain] ActivityWatch not found, starting native watcher...`);
      const watcherResult = await startNativeWatcher();
      if (watcherResult.ok) {
        console.error(`[daybrain] Native watcher active (${watcherResult.backend})`);
      } else {
        console.error(`[daybrain] No activity source available: ${watcherResult.error}`);
        console.error(`[daybrain] Install ActivityWatch (https://activitywatch.net) or run: pip3 install pyobjc-framework-Quartz`);
      }
    }
    startScheduler();
  }

  try { startHttpServer(); } catch (err) {
    console.error(`[daybrain] HTTP server failed to start:`, err instanceof Error ? err.message : String(err));
  }
  console.error(`[daybrain] Browser extension API on http://127.0.0.1:${19840}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[daybrain] Fatal error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

export { main, buildTools, toolHandlers };
