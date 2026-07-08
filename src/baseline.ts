import { getRecentDailySummaries, StoredDailySummary } from './db';
import { AWEvent } from './aw';

export interface BaselineComparison {
  today: {
    totalMinutes: number;
    topApps: { app: string; minutes: number }[];
    switchCount: number;
    insightCount: number;
  };
  average: {
    totalMinutes: number;
    days: number;
    topApps: { app: string; minutes: number }[];
    switchCount: number;
    insightCount: number;
  };
  anomalies: BaselineAnomaly[];
}

export interface BaselineAnomaly {
  type: 'time_drop' | 'time_spike' | 'app_change' | 'switch_spike' | 'new_app' | 'missing_app';
  description: string;
  detail: string;
  severity: 'low' | 'medium' | 'high';
}

export function generateBaseline(
  todayEvents: AWEvent[],
  insightEngine: any,
  days: number = 7
): BaselineComparison {
  const todayResult = insightEngine.analyzeWindowEvents(todayEvents);
  const summaries = getRecentDailySummaries(days);

  const todayTotalMinutes = Math.round(todayResult.totalActiveTime / 60);
  const todayApps = todayResult.appSummaries.slice(0, 10).map((a: any) => ({
    app: a.app,
    minutes: Math.round(a.totalDuration / 60),
  }));
  const todaySwitches = todayResult.contextSwitches.reduce((s: number, c: any) => s + c.count, 0);

  const historicalSummaries = summaries.filter(
    (s: StoredDailySummary) => s.total_active_time > 0
  );

  if (historicalSummaries.length === 0) {
    return {
      today: {
        totalMinutes: todayTotalMinutes,
        topApps: todayApps,
        switchCount: todaySwitches,
        insightCount: 0,
      },
      average: { totalMinutes: 0, days: 0, topApps: [], switchCount: 0, insightCount: 0 },
      anomalies: [],
    };
  }

  const avgMinutes = Math.round(
    historicalSummaries.reduce((s: number, d: StoredDailySummary) => s + d.total_active_time, 0) /
      60 /
      historicalSummaries.length
  );
  const avgSwitches = Math.round(
    historicalSummaries.reduce((s: number, d: StoredDailySummary) => s + d.switch_count, 0) /
      historicalSummaries.length
  );

  // Aggregate app usage across historical days
  const historicalApps: Map<string, { totalMinutes: number; days: number }> = new Map();
  for (const summary of historicalSummaries) {
    const apps = JSON.parse(summary.top_apps || '[]') as { app: string; minutes: number }[];
    for (const app of apps) {
      const existing = historicalApps.get(app.app) || { totalMinutes: 0, days: 0 };
      existing.totalMinutes += app.minutes;
      existing.days += 1;
      historicalApps.set(app.app, existing);
    }
  }

  const avgTopApps = Array.from(historicalApps.entries())
    .map(([app, data]) => ({
      app,
      minutes: Math.round(data.totalMinutes / historicalSummaries.length),
    }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 10);

  const anomalies: BaselineAnomaly[] = [];

  // Total time anomaly
  const timeRatio = avgMinutes > 0 ? todayTotalMinutes / avgMinutes : 1;
  if (timeRatio < 0.5) {
    anomalies.push({
      type: 'time_drop',
      description: `Significantly less active than usual`,
      detail: `${todayTotalMinutes} min today vs ${avgMinutes} min average over ${historicalSummaries.length} days.`,
      severity: todayTotalMinutes < avgMinutes * 0.25 ? 'high' : 'medium',
    });
  } else if (timeRatio > 1.5) {
    anomalies.push({
      type: 'time_spike',
      description: `Unusually high activity today`,
      detail: `${todayTotalMinutes} min today vs ${avgMinutes} min average.`,
      severity: 'low',
    });
  }

  // Switch anomaly
  if (avgSwitches > 0 && todaySwitches > avgSwitches * 1.5) {
    anomalies.push({
      type: 'switch_spike',
      description: `Context switching is ${Math.round((todaySwitches / avgSwitches - 1) * 100)}% above your average`,
      detail: `${todaySwitches} switches today vs ${avgSwitches} avg. Consider time-blocking.`,
      severity: todaySwitches > avgSwitches * 2 ? 'high' : 'medium',
    });
  }

  // App anomalies
  for (const todayApp of todayApps) {
    const avgApp = avgTopApps.find(a => a.app === todayApp.app);
    if (!avgApp && todayApp.minutes > 15) {
      anomalies.push({
        type: 'new_app',
        description: `Spent ${todayApp.minutes} min in ${todayApp.app} — not in your usual rotation`,
        detail: `New app detected in today's workflow.`,
        severity: 'low',
      });
    } else if (avgApp) {
      const ratio = todayApp.minutes / (avgApp.minutes || 1);
      if (ratio > 2) {
        anomalies.push({
          type: 'app_change',
          description: `${Math.round((ratio - 1) * 100)}% more time in ${todayApp.app} than usual`,
          detail: `${todayApp.minutes} min today vs ${avgApp.minutes} min avg.`,
          severity: ratio > 3 ? 'medium' : 'low',
        });
      } else if (ratio < 0.3 && avgApp.minutes > 10) {
        anomalies.push({
          type: 'missing_app',
          description: `Barely touched ${todayApp.app} today (${todayApp.minutes} min vs ${avgApp.minutes} min avg)`,
          detail: `Usually spend ${avgApp.minutes} min/day here.`,
          severity: 'medium',
        });
      }
    }
  }

  return {
    today: {
      totalMinutes: todayTotalMinutes,
      topApps: todayApps,
      switchCount: todaySwitches,
      insightCount: 0,
    },
    average: {
      totalMinutes: avgMinutes,
      days: historicalSummaries.length,
      topApps: avgTopApps,
      switchCount: avgSwitches,
      insightCount: Math.round(
        historicalSummaries.reduce((s: number, d: StoredDailySummary) => s + d.insight_count, 0) /
          historicalSummaries.length
      ),
    },
    anomalies: anomalies.sort((a, b) => {
      const sev = { high: 3, medium: 2, low: 1 };
      return (sev[b.severity] || 0) - (sev[a.severity] || 0);
    }),
  };
}
