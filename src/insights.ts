import { AWEvent } from './aw';
import { Insight } from './db';
import { getConfig } from './config';

const COMMITMENT_PATTERNS = [
  { regex: /\b(will|gonna|going to)\s+(\w+(?:\s+\w+){0,4})\s+(by|before|on|tomorrow|next|soon|friday|monday|tuesday|wednesday|thursday|saturday|sunday)/i, weight: 0.8 },
  { regex: /\b(I'?ll|i will|let me|i need to)\s+(\w+(?:\s+\w+){0,4})/i, weight: 0.6 },
  { regex: /\b(promise|promised|committed|pledged)\b/i, weight: 0.9 },
  { regex: /\b(send|share|forward|deliver)\s+(\w+(?:\s+\w+){0,3})\s+(by|before|on|tomorrow|next|friday|monday|tuesday|wednesday|thursday)/i, weight: 0.85 },
  { regex: /\b(follow.?up|followup|get back|circle back|check back|touch base)\b/i, weight: 0.7 },
  { regex: /\b(remind me|remember to|don'?t forget|must not forget)\b/i, weight: 0.75 },
  { regex: /\b(action item|action: |to.?do:? |task:? |TODO:? )/i, weight: 0.85 },
  { regex: /\b(by\s+(?:end\s+of\s+)?(?:today|tomorrow|EOD|EOB|COB|this\s+week|next\s+week|friday|monday|tuesday|wednesday|thursday|saturday|sunday))\b/i, weight: 0.75 },
  { regex: /\b(due\s+(?:on|by|before)|deadline|must\s+(?:be\s+)?done)\b/i, weight: 0.8 },
];

const PRODUCTIVE_APPS = new Set([
  'code', 'vscode', 'visual studio code', 'vs code', 'cursor', 'intellij',
  'intellij idea', 'webstorm', 'pycharm', 'android studio', 'xcode',
  'sublime', 'atom', 'terminal', 'iterm', 'iterm2', 'warp', 'hyper',
  'alacritty', 'kitty', 'linear', 'jira', 'asana', 'notion', 'obsidian',
  'logseq', 'roam research', 'figma', 'sketch', 'excel', 'numbers',
  'pages', 'word', 'google docs',
]);

const COMMUNICATION_APPS = new Set([
  'slack', 'microsoft teams', 'discord', 'telegram', 'whatsapp',
  'signal', 'zoom', 'google meet', 'facetime', 'messages', 'mail',
  'outlook', 'gmail', 'superhuman', 'spark',
]);

const BROWSERS = new Set([
  'google chrome', 'chrome', 'firefox', 'safari', 'edge', 'brave',
  'arc', 'opera', 'vivaldi', 'chromium',
]);

const DEV_APPS = new Set([
  'code', 'vscode', 'visual studio code', 'vs code', 'cursor', 'intellij',
  'intellij idea', 'webstorm', 'pycharm', 'android studio', 'xcode',
  'sublime', 'atom', 'terminal', 'iterm', 'iterm2', 'warp', 'hyper',
  'alacritty', 'kitty',
]);

export interface AppSummary {
  app: string;
  totalDuration: number;
  percentage: number;
  eventCount: number;
  category: 'productive' | 'communication' | 'browser' | 'other';
}

export interface ContextSwitch {
  fromApp: string;
  toApp: string;
  count: number;
}

export interface HourlyActivity {
  hour: string;
  topApp: string;
  switchCount: number;
  activeMinutes: number;
}

export class InsightEngine {
  private minConfidence: number;

  constructor(minConfidence?: number) {
    this.minConfidence = minConfidence ?? getConfig().insights.minConfidence;
  }

  analyzeWindowEvents(events: AWEvent[]): {
    appSummaries: AppSummary[];
    contextSwitches: ContextSwitch[];
    hourlyBreakdown: HourlyActivity[];
    totalActiveTime: number;
    uniqueApps: number;
  } {
    if (events.length === 0) {
      return { appSummaries: [], contextSwitches: [], hourlyBreakdown: [], totalActiveTime: 0, uniqueApps: 0 };
    }

    const appDurations: Map<string, { duration: number; count: number }> = new Map();

    for (const evt of events) {
      const rawApp = evt.data?.app;
      if (!rawApp || typeof rawApp !== 'string' || rawApp === 'undefined') continue;
      const app = this.normalizeApp(rawApp);
      if (!app) continue;

      const existing = appDurations.get(app) || { duration: 0, count: 0 };
      existing.duration += evt.duration;
      existing.count += 1;
      appDurations.set(app, existing);
    }

    const totalActiveTime = Array.from(appDurations.values()).reduce((sum, v) => sum + v.duration, 0);
    const uniqueApps = appDurations.size;

    const appSummaries: AppSummary[] = Array.from(appDurations.entries())
      .map(([app, data]) => ({
        app,
        totalDuration: data.duration,
        percentage: totalActiveTime > 0 ? (data.duration / totalActiveTime) * 100 : 0,
        eventCount: data.count,
        category: this.categorizeApp(app),
      }))
      .sort((a, b) => b.totalDuration - a.totalDuration);

    const switchMap = new Map<string, number>();
    for (let i = 1; i < events.length; i++) {
      const fromApp = this.normalizeApp(String(events[i - 1].data?.app || ''));
      const toApp = this.normalizeApp(String(events[i].data?.app || ''));
      if (!fromApp || !toApp || fromApp === toApp) continue;

      const key = `${fromApp} → ${toApp}`;
      switchMap.set(key, (switchMap.get(key) || 0) + 1);
    }

    const contextSwitches: ContextSwitch[] = Array.from(switchMap.entries())
      .map(([key, count]) => {
        const [fromApp, toApp] = key.split(' → ');
        return { fromApp, toApp, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);

    const hourlyMap = new Map<string, { apps: Map<string, number>; switches: number; activeMs: number }>();
    for (let i = 0; i < events.length; i++) {
      const evt = events[i];
      const hour = new Date(evt.timestamp).toISOString().slice(0, 13) + ':00';
      const rawApp = evt.data?.app;
      if (!rawApp || typeof rawApp !== 'string' || rawApp === 'undefined') continue;
      const app = this.normalizeApp(rawApp);

      let h = hourlyMap.get(hour);
      if (!h) {
        h = { apps: new Map(), switches: 0, activeMs: 0 };
        hourlyMap.set(hour, h);
      }

      h.apps.set(app, (h.apps.get(app) || 0) + evt.duration);
      h.activeMs += evt.duration;

      if (i > 0) {
        const prevApp = this.normalizeApp(String(events[i - 1].data?.app || ''));
        if (prevApp && app && prevApp !== app) {
          const prevHour = new Date(events[i - 1].timestamp).toISOString().slice(0, 13) + ':00';
          if (prevHour === hour) {
            h.switches += 1;
          }
        }
      }
    }

    const hourlyBreakdown: HourlyActivity[] = Array.from(hourlyMap.entries())
      .map(([hour, data]) => {
        let topApp = 'unknown';
        let topDuration = 0;
        for (const [app, dur] of data.apps) {
          if (dur > topDuration) {
            topDuration = dur;
            topApp = app;
          }
        }
        return {
          hour,
          topApp,
          switchCount: data.switches,
          activeMinutes: Math.round(data.activeMs / 60 * 10) / 10,
        };
      })
      .sort((a, b) => a.hour.localeCompare(b.hour));

    return { appSummaries, contextSwitches, hourlyBreakdown, totalActiveTime, uniqueApps };
  }

  extractCommitments(events: AWEvent[]): Insight[] {
    const insights: Insight[] = [];
    const periodStart = events[0]?.timestamp || new Date(0).toISOString();
    const periodEnd = events[events.length - 1]?.timestamp || new Date().toISOString();

    const seenTitles = new Set<string>();

    for (const evt of events) {
      const title = String(evt.data?.title || '');
      const app = String(evt.data?.app || '');

      if (!title || title.length < 5 || title.length > 500) continue;
      if (seenTitles.has(title)) continue;
      seenTitles.add(title);

      for (const pattern of COMMITMENT_PATTERNS) {
        const match = title.match(pattern.regex);
        if (match && pattern.weight >= this.minConfidence) {
          const evidenceTitle = title.length > 200 ? title.slice(0, 197) + '...' : title;
          insights.push({
            type: 'commitment',
            period_start: periodStart,
            period_end: periodEnd,
            title: `Possible commitment: "${evidenceTitle}"`,
            description: `Detected commitment language in ${app}: "${match[0]}". This may need a follow-up or task creation.`,
            confidence: pattern.weight,
            evidence: JSON.stringify([{ timestamp: evt.timestamp, app, title: evidenceTitle, matched: match[0] }]),
            action_text: `Review this conversation and create a task if needed. Consider adding to Linear, Notion, or your preferred task manager.`,
          });
          break;
        }
      }
    }

    return insights;
  }

  detectAvoidance(events: AWEvent[]): Insight[] {
    const insights: Insight[] = [];
    if (events.length < 5) return insights;

    const appVisits = new Map<string, { visitCount: number; totalDuration: number; titles: Set<string> }>();

    for (const evt of events) {
      const rawApp = evt.data?.app;
      if (!rawApp || typeof rawApp !== 'string' || rawApp === 'undefined') continue;
      const app = this.normalizeApp(rawApp);

      let visit = appVisits.get(app);
      if (!visit) {
        visit = { visitCount: 0, totalDuration: 0, titles: new Set() };
        appVisits.set(app, visit);
      }
      visit.visitCount += 1;
      visit.totalDuration += evt.duration;
      const title = String(evt.data?.title || '');
      if (title) visit.titles.add(title.slice(0, 100));
    }

    for (const [app, visit] of appVisits) {
      if (visit.visitCount < 5) continue;

      const avgDurationPerVisit = visit.totalDuration / visit.visitCount;
      const isShortVisits = avgDurationPerVisit < 30;
      const isManyTitles = visit.titles.size >= 3;

      if (isShortVisits || isManyTitles) {
        const totalMinutes = Math.round(visit.totalDuration / 6) / 10;
        const periodStart = events[0]?.timestamp || new Date(0).toISOString();
        const periodEnd = events[events.length - 1]?.timestamp || new Date().toISOString();

        let description = '';
        if (isShortVisits && isManyTitles) {
          description = `You opened ${app} ${visit.visitCount} times today, averaging ${Math.round(avgDurationPerVisit)} seconds per visit across ${visit.titles.size} different contexts. Total time: ${totalMinutes} minutes. This pattern suggests context-switching or avoidance.`;
        } else if (isShortVisits) {
          description = `You opened ${app} ${visit.visitCount} times with very short engagement (avg ${Math.round(avgDurationPerVisit)}s). Total time: ${totalMinutes} minutes. This may indicate distraction or task avoidance.`;
        } else {
          description = `You switched between ${visit.titles.size} different contexts in ${app} across ${visit.visitCount} visits. Consider batching similar tasks.`;
        }

        const confidence = isShortVisits && isManyTitles ? 0.7 : isShortVisits ? 0.6 : 0.45;

        if (confidence >= this.minConfidence) {
          insights.push({
            type: 'avoidance',
            period_start: periodStart,
            period_end: periodEnd,
            title: `Frequent brief visits to ${app}`,
            description,
            confidence,
            evidence: JSON.stringify({
              app,
              visitCount: visit.visitCount,
              avgDurationPerVisit: Math.round(avgDurationPerVisit),
              totalDuration: visit.totalDuration,
              uniqueTitles: visit.titles.size,
            }),
            action_text: `Consider time-blocking ${app} usage or using focus mode to reduce context switching.`,
          });
        }
      }
    }

    return insights;
  }

  detectContextSwitchingProblems(events: AWEvent[]): Insight[] {
    const insights: Insight[] = [];
    if (events.length < 5) return insights;

    const { hourlyBreakdown, contextSwitches } = this.analyzeWindowEvents(events);

    const highSwitchHours = hourlyBreakdown.filter(h => h.switchCount > 20);
    for (const hour of highSwitchHours) {
      const periodStart = events[0]?.timestamp || new Date(0).toISOString();
      const periodEnd = events[events.length - 1]?.timestamp || new Date().toISOString();

      insights.push({
        type: 'context_switch',
        period_start: periodStart,
        period_end: periodEnd,
        title: `High context switching at ${hour.hour}`,
        description: `${hour.switchCount} app switches in one hour while primarily using ${hour.topApp}. Active for ${hour.activeMinutes} minutes. This level of switching typically reduces deep work quality.`,
        confidence: Math.min(0.5 + (hour.switchCount - 20) * 0.01, 0.9),
        evidence: JSON.stringify({ hour: hour.hour, switchCount: hour.switchCount, topApp: hour.topApp }),
        action_text: `Try using focus mode or pomodoro technique during this hour. Block distracting apps with tools like SelfControl or Cold Turkey.`,
      });
    }

    if (contextSwitches.length > 0) {
      const topSwitches = contextSwitches.slice(0, 5);
      const commDevSwitches = topSwitches.filter(
        s =>
          (COMMUNICATION_APPS.has(s.fromApp.toLowerCase()) && DEV_APPS.has(s.toApp.toLowerCase())) ||
          (DEV_APPS.has(s.fromApp.toLowerCase()) && COMMUNICATION_APPS.has(s.toApp.toLowerCase()))
      );

      if (commDevSwitches.length >= 2) {
        const apps = new Set<string>();
        commDevSwitches.forEach(s => {
          apps.add(s.fromApp);
          apps.add(s.toApp);
        });
        const periodStart = events[0]?.timestamp || new Date(0).toISOString();
        const periodEnd = events[events.length - 1]?.timestamp || new Date().toISOString();

        insights.push({
          type: 'context_switch',
          period_start: periodStart,
          period_end: periodEnd,
          title: `Frequent switching between dev tools and communication apps`,
          description: `You're switching frequently between ${Array.from(apps).join(', ')}. This is a classic deep-work killer.`,
          confidence: 0.75,
          evidence: JSON.stringify(commDevSwitches),
          action_text: `Batch communication to specific times. Check Slack/email only at designated intervals (e.g., every 2 hours).`,
        });
      }
    }

    return insights;
  }

  detectProjectContext(events: AWEvent[], projectKeywords?: string[]): {
    project: string;
    totalDuration: number;
    relatedApps: string[];
    eventCount: number;
    relevantEvents: { timestamp: string; app: string; title: string }[];
  }[] {
    if (!projectKeywords || projectKeywords.length === 0) {
      projectKeywords = this.extractProjectKeywords(events);
    }

    const projectMap = new Map<string, {
      duration: number;
      apps: Set<string>;
      count: number;
      events: { timestamp: string; app: string; title: string }[];
    }>();

    for (const evt of events) {
      const title = String(evt.data?.title || '').toLowerCase();
      const app = String(evt.data?.app || '');

      for (const keyword of projectKeywords) {
        if (title.includes(keyword.toLowerCase())) {
          let p = projectMap.get(keyword);
          if (!p) {
            p = { duration: 0, apps: new Set(), count: 0, events: [] };
            projectMap.set(keyword, p);
          }
          p.duration += evt.duration;
          p.apps.add(app);
          p.count += 1;
          if (p.events.length < 20) {
            p.events.push({
              timestamp: evt.timestamp,
              app,
              title: title.length > 100 ? title.slice(0, 97) + '...' : title,
            });
          }
          break;
        }
      }
    }

    return Array.from(projectMap.entries())
      .map(([project, data]) => ({
        project,
        totalDuration: data.duration,
        relatedApps: Array.from(data.apps),
        eventCount: data.count,
        relevantEvents: data.events,
      }))
      .sort((a, b) => b.totalDuration - a.totalDuration);
  }

  detectFocusBlocks(events: AWEvent[]): {
    app: string;
    startTime: string;
    endTime: string;
    durationMinutes: number;
  }[] {
    const blocks: { app: string; startTime: string; endTime: string; durationMinutes: number }[] = [];
    if (events.length < 2) return blocks;

    let currentBlock: { app: string; startTime: string; endTime: string; durationMs: number } | null = null;

    for (const evt of events) {
      const rawApp = evt.data?.app;
      if (!rawApp || typeof rawApp !== 'string' || rawApp === 'undefined') continue;
      const app = this.normalizeApp(rawApp);

      if (!currentBlock || currentBlock.app !== app) {
        if (
          currentBlock &&
          currentBlock.durationMs >= 10 * 60 * 1000 &&
          DEV_APPS.has(currentBlock.app.toLowerCase())
        ) {
          blocks.push({
            app: currentBlock.app,
            startTime: currentBlock.startTime,
            endTime: currentBlock.endTime,
            durationMinutes: Math.round(currentBlock.durationMs / 6000) / 10,
          });
        }
        currentBlock = {
          app,
          startTime: evt.timestamp,
          endTime: evt.timestamp,
          durationMs: evt.duration * 1000,
        };
      } else {
        currentBlock.durationMs += evt.duration * 1000;
        currentBlock.endTime = evt.timestamp;
      }
    }

    if (
      currentBlock &&
      currentBlock.durationMs >= 10 * 60 * 1000 &&
      DEV_APPS.has(currentBlock.app.toLowerCase())
    ) {
      blocks.push({
        app: currentBlock.app,
        startTime: currentBlock.startTime,
        endTime: currentBlock.endTime,
        durationMinutes: Math.round(currentBlock.durationMs / 6000) / 10,
      });
    }

    return blocks.sort((a, b) => b.durationMinutes - a.durationMinutes);
  }

  generateDailySummary(events: AWEvent[]): string {
    if (events.length === 0) {
      return 'No activity recorded today. Start ActivityWatch to begin tracking.';
    }

    const { appSummaries, totalActiveTime, uniqueApps } = this.analyzeWindowEvents(events);
    const totalHours = Math.round(totalActiveTime / 360) / 10;
    const totalMinutes = Math.round(totalActiveTime / 6) / 10;

    let summary = `Today's Activity Summary\n`;
    summary += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    summary += `Total active time: `;
    if (totalHours >= 1) {
      summary += `${totalHours} hours (${Math.round(totalMinutes)} minutes)`;
    } else {
      summary += `${Math.round(totalMinutes)} minutes`;
    }
    summary += `\n`;
    summary += `Unique applications: ${uniqueApps}\n\n`;

    summary += `Top Applications:\n`;
    for (let i = 0; i < Math.min(appSummaries.length, 10); i++) {
      const a = appSummaries[i];
      const mins = Math.round(a.totalDuration / 6) / 10;
      const bar = '█'.repeat(Math.round(a.percentage / 2));
      summary += `  ${a.app.padEnd(20)} ${String(mins).padStart(6)} min  ${bar} ${Math.round(a.percentage)}%\n`;
    }

    const byCategory = {
      productive: appSummaries.filter(a => a.category === 'productive').reduce((s, a) => s + a.totalDuration, 0),
      communication: appSummaries.filter(a => a.category === 'communication').reduce((s, a) => s + a.totalDuration, 0),
      browser: appSummaries.filter(a => a.category === 'browser').reduce((s, a) => s + a.totalDuration, 0),
      other: appSummaries.filter(a => a.category === 'other').reduce((s, a) => s + a.totalDuration, 0),
    };

    summary += `\nCategory Breakdown:\n`;
    for (const [cat, dur] of Object.entries(byCategory)) {
      const pct = totalActiveTime > 0 ? Math.round((dur / totalActiveTime) * 100) : 0;
      if (dur > 0) {
        summary += `  ${cat.padEnd(15)} ${pct}%\n`;
      }
    }

    const focusBlocks = this.detectFocusBlocks(events);
    if (focusBlocks.length > 0) {
      summary += `\nFocus Blocks:\n`;
      for (const block of focusBlocks.slice(0, 3)) {
        summary += `  ${block.app} — ${block.durationMinutes} min\n`;
      }
    }

    return summary;
  }

  runFullAnalysis(events: AWEvent[], projectKeywords?: string[]): {
    insights: Insight[];
    summary: string;
    appSummaries: AppSummary[];
    contextSwitches: ContextSwitch[];
    projects: ReturnType<InsightEngine['detectProjectContext']>;
    focusBlocks: ReturnType<InsightEngine['detectFocusBlocks']>;
    hourlyBreakdown: HourlyActivity[];
    totalActiveTime: number;
  } {
    const { appSummaries, contextSwitches, hourlyBreakdown, totalActiveTime } =
      this.analyzeWindowEvents(events);

    const commitments = this.extractCommitments(events);
    const avoidance = this.detectAvoidance(events);
    const switching = this.detectContextSwitchingProblems(events);
    const projects = this.detectProjectContext(events, projectKeywords);
    const focusBlocks = this.detectFocusBlocks(events);
    const summary = this.generateDailySummary(events);

    const allInsights = [...commitments, ...avoidance, ...switching];
    const maxInsights = getConfig().insights.maxInsightsPerRun;
    const filtered = allInsights
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxInsights);

    return {
      insights: filtered,
      summary,
      appSummaries,
      contextSwitches,
      projects,
      focusBlocks,
      hourlyBreakdown,
      totalActiveTime,
    };
  }

  private extractProjectKeywords(events: AWEvent[]): string[] {
    const titleWords = new Map<string, number>();

    for (const evt of events) {
      const title = String(evt.data?.title || '');
      const words = title
        .toLowerCase()
        .replace(/[^a-z0-9\s\-_.#]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !this.isCommonWord(w));

      for (const word of words) {
        titleWords.set(word, (titleWords.get(word) || 0) + 1);
      }
    }

    return Array.from(titleWords.entries())
      .filter(([, count]) => count >= 5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([word]) => word);
  }

  private normalizeApp(app: string): string {
    const cleaned = app.toLowerCase().trim();
    const withoutPath = cleaned.replace(/\.(exe|app)$/i, '').split(/[/\\]/).pop() || cleaned;

    if (withoutPath.includes('chrome')) return 'Google Chrome';
    if (withoutPath.includes('firefox')) return 'Firefox';
    if (withoutPath.includes('safari')) return 'Safari';
    if (withoutPath.includes('edge')) return 'Microsoft Edge';
    if (withoutPath.includes('slack')) return 'Slack';
    if (withoutPath.includes('discord')) return 'Discord';
    if (withoutPath.includes('terminal') || withoutPath.includes('iterm') || withoutPath.includes('warp') || withoutPath.includes('kitty'))
      return 'Terminal';
    if (withoutPath.includes('finder')) return 'Finder';
    if (withoutPath.includes('cursor')) return 'Cursor';
    if (withoutPath.includes('code') || withoutPath.includes('vscode')) return 'VS Code';
    if (withoutPath.includes('intellij') || withoutPath.includes('idea')) return 'IntelliJ';
    if (withoutPath.includes('linear')) return 'Linear';
    if (withoutPath.includes('notion')) return 'Notion';
    if (withoutPath.includes('obsidian')) return 'Obsidian';
    if (withoutPath.includes('figma')) return 'Figma';
    if (withoutPath.includes('spotify')) return 'Spotify';
    if (withoutPath.includes('zoom')) return 'Zoom';
    if (withoutPath.includes('outlook') || withoutPath.includes('mail')) return 'Mail';
    if (withoutPath.includes('teams')) return 'Microsoft Teams';
    if (withoutPath.includes('telegram')) return 'Telegram';
    if (withoutPath.includes('whatsapp')) return 'WhatsApp';

    return withoutPath.charAt(0).toUpperCase() + withoutPath.slice(1);
  }

  private categorizeApp(app: string): AppSummary['category'] {
    const lower = app.toLowerCase();
    if (PRODUCTIVE_APPS.has(lower) || DEV_APPS.has(lower)) return 'productive';
    if (COMMUNICATION_APPS.has(lower)) return 'communication';
    if (BROWSERS.has(lower)) return 'browser';
    return 'other';
  }

  private isCommonWord(word: string): boolean {
    const common = new Set([
      'this', 'that', 'with', 'from', 'have', 'been', 'were', 'they',
      'what', 'when', 'where', 'which', 'about', 'would', 'could', 'should',
      'there', 'their', 'your', 'like', 'just', 'some', 'also', 'than',
      'then', 'into', 'more', 'over', 'only', 'other', 'after', 'before',
      'between', 'still', 'being', 'very', 'really', 'much',
    ]);
    return common.has(word);
  }
}

export function createInsightEngine(minConfidence?: number): InsightEngine {
  return new InsightEngine(minConfidence);
}
