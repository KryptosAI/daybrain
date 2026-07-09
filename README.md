# DayBrain

**Private local memory for your AI.** Your AI knows everything about the internet. It knows nothing about you. DayBrain closes that gap — locally.

## How it works

DayBrain runs on your machine and quietly remembers what you work on. Any AI tool (Claude, Cursor, ChatGPT) can ask it for context.

```
npx daybrain
```

That's it. One command.

## Features

- **11 MCP tools** — Claude/Cursor can query your activity, commitments, and context automatically
- **Chrome extension** — records browsing, detects commitments, one-click copy to paste anywhere
- **Local SQLite** — all data stays on your machine, no cloud, no accounts
- **Commitment detection** — catches "I'll send the demo by Friday" from your window titles
- **Context switching analysis** — how often you jump between apps
- **Baseline comparison** — "you usually spend 3h in Cursor, today only 1h"
- **Linear + GitHub integration** — create tasks from detected commitments
- **Cross-device sync** — your laptop and desktop share the same memory

## Quick start

```bash
npx daybrain                 # start the server
daybrain onboard             # guided setup (optional)
```

### Connect Claude

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

Then ask Claude: *"What did I work on today?"*

### Chrome extension

1. Open `chrome://extensions`
2. Enable Developer mode
3. Load unpacked → select the `extension/` folder
4. Click the 🧠 icon in your toolbar → toggle ON → browse normally

## Requirements

- Node.js >= 18
- macOS (native watcher) or ActivityWatch (all platforms)

## What it detects

| Pattern | Example | Confidence |
|---------|---------|------------|
| Commitments | "I will send the demo by Friday" | 80-90% |
| Deadlines | "by EOD", "by tomorrow" | 75% |
| Avoidance | Frequent brief visits to Twitter | 70% |
| Context switches | 87 switches in one hour | 75% |

## License

MIT
