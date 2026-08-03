# DayBrain

**Private local memory for any AI assistant.**

Give Claude, Cursor, ChatGPT, OpenCode, and any MCP client persistent context about your workday — without sending your data anywhere.

[![npm](https://img.shields.io/npm/v/daybrain)](https://www.npmjs.com/package/daybrain)
[![tests](https://img.shields.io/badge/tests-21%2F21-brightgreen)](#tests)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

## The problem

AI assistants know everything about the internet. They know nothing about you.
You spend 30 seconds re-telling Claude what you've been working on — every conversation, every day.

## What DayBrain does

DayBrain runs on your machine as a background process. It watches what you work on,
stores it in a local SQLite database, extracts useful insights, and exposes everything
through the Model Context Protocol (MCP). Any AI tool that speaks MCP can query it.

No cloud. No accounts. No new chat app.

```
npx daybrain
```

## Architecture

```
┌──────────────┐     ┌────────────────┐     ┌──────────────────┐
│  Activity    │────▶│                │────▶│  Any MCP client  │
│  sources     │     │   DayBrain     │     │  Claude, Cursor,  │
│              │     │                │     │  OpenCode, etc.   │
├──────────────┤     ├────────────────┤     └──────────────────┘
│ CGWindow API │     │  SQLite DB     │
│ Chrome ext.  │     │  Insight engine│     ┌──────────────────┐
│ ActivityWatch│     │  Scheduler     │────▶│  Telegram/Slack   │
│ Screenpipe   │     │  MCP server    │     │  (push insights)  │
└──────────────┘     └────────────────┘     └──────────────────┘
```

## Features

- **11 MCP tools** — AI can query activity, commitments, patterns, baselines, and project context
- **Native window tracking** — macOS CGWindow API, zero permissions required
- **Chrome extension** — records browsing activity, one-click copy context anywhere
- **Commitment detection** — 9 regex patterns catch promises from window titles ("I'll send the demo by Friday")
- **Context switching analysis** — how often you jump between apps, which apps interrupt your flow
- **Baseline comparison** — compares today vs 7-day average, flags anomalies
- **Focus block detection** — identifies periods of sustained work on a single app
- **Project context detection** — groups activity by project keywords found in window titles
- **Insight scheduling** — hourly insight loop with overlap guard, no duplicated runs
- **Linear + GitHub integration** — create tasks from detected commitments
- **Cross-device sync** — push/pull endpoints for sharing context across your machines
- **100% local** — SQLite at `~/.daybrain/data/daybrain.db`, nothing leaves your device

## MCP tools

The full list of tools any AI client can call:

| Tool | Description | Required params |
|------|-------------|----------------|
| `get_activity_summary` | Today's activity breakdown with top apps and total time | `period` (today/week/month) |
| `get_raw_events` | Recent window/browser events with timestamps | `limit` |
| `get_insights` | Detected commitments, patterns, and anomalies | `limit`, `min_confidence` |
| `get_daily_summary` | Aggregated stats for a specific date | `date` (YYYY-MM-DD) |
| `get_baseline` | Current vs historical averages, flags anomalies | — |
| `get_context` | Full workday context for injection into AI chat | `period`, `include_raw` |
| `create_linear_task` | Create a Linear issue from a detected commitment | `title`, `description?` |
| `create_github_issue` | Create a GitHub issue from a detected commitment | `title`, `body?`, `repo` |
| `search_activity` | Full-text search across window titles | `query`, `limit` |
| `get_project_context` | Activity grouped by detected project keywords | `keywords` |
| `get_server_status` | Health check + data directory info | — |

## Quick start

```bash
npx daybrain              # start server (MCP + HTTP on :19840)
```

### Connect to any AI

```json
{
  "mcpServers": {
    "daybrain": {
      "command": "npx",
      "args": ["-y", "daybrain"]
    }
  }
}
```

Then ask: *"What did I work on today?"*

### Chrome extension

1. Open `chrome://extensions` → enable Developer mode
2. Load unpacked → select `/extension` folder
3. Click the DayBrain icon → toggle recording → browse normally
4. Click "Copy context" → paste into any AI chat

## Activity sources

| Source | Platform | What it captures | Setup |
|--------|----------|-----------------|-------|
| **CGWindow API** | macOS | Active window titles and app names | Zero — built in |
| **Chrome extension** | All | Browsing activity, URLs, page titles | Load unpacked |
| **ActivityWatch** | All | Apps, window titles, AFK detection | Install aw-watcher-afk + aw-watcher-window |
| **Screenpipe** (optional) | macOS/Linux | Screen OCR + audio transcription | Install Screenpipe, set `SCREENPIPE_ENABLED=true` |

## What it detects

| Pattern | Example match | Confidence |
|---------|--------------|------------|
| Commitments | "I will send the report by Friday" | 80-90% |
| Deadlines | "due by EOD", "needs to ship tomorrow" | 75% |
| Follow-ups | "let me follow up on that", "I'll check" | 70% |
| Promises | "I promise to fix", "I will deploy" | 85% |
| Avoidance | Frequent brief visits to social/distraction apps | 70% |
| Context switches | 87 app switches in one hour | 75% |
| Focus blocks | 30+ consecutive minutes in one app | 80% |

## Tests

```bash
npm test
```

```
21 passed, 0 failed
```

Covers: config loading, database CRUD, deduplication, insight engine (commitments,
avoidance, app categorization, project detection, focus blocks, summarization,
empty-input safety, large-input performance), scheduler overlap guard, security
(config permissions 0600, path traversal blocked, immutable config clones),
error handler registration.

## Tech stack

- **Runtime:** Node.js (TypeScript, compiled to CommonJS)
- **Database:** SQLite via `better-sqlite3` (synchronous, no network)
- **Protocol:** MCP (Model Context Protocol) via `@modelcontextprotocol/sdk`
- **Window tracking:** macOS CGWindow API via Python `pyobjc`
- **Browser:** Chrome Extension Manifest V3
- **Testing:** Custom assertion runner (`tsx test.ts`)

## License

MIT
