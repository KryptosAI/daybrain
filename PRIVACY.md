# DayBrain Privacy Policy

**Last updated: July 8, 2026**

## Summary

DayBrain is a local-first application. All data stays on your device. We have no servers, no accounts, no analytics, and no way to access your data. This privacy policy explains what data the DayBrain Chrome extension and server process handle, and what happens to it.

## What Data Is Collected

### Web History (browsing activity)

The DayBrain Chrome extension records the **title** and **URL** of the browser tab you are actively viewing, along with the **timestamp** and **duration** of each visit. This data is used to build your daily activity summary and detect commitments, focus patterns, and context-switching behavior.

This data:
- Never leaves your device
- Is stored in a local SQLite database at `~/.daybrain/data/`
- Is only accessible by the DayBrain server process running on your machine
- Is only shared with AI assistants (Claude, ChatGPT, Cursor) when you explicitly click "Inject Context" or call an MCP tool

### What Is NOT Collected

- **Personally identifiable information** — No name, email, address, or identification
- **Health information** — No medical or health-related data
- **Financial information** — No payment data, credit cards, or transactions
- **Authentication information** — No passwords, credentials, or security tokens
- **Personal communications** — Message content from chat applications is not captured. Window titles may incidentally contain message previews if displayed by the chat application; DayBrain does not scrape or read message bodies.
- **Location** — No GPS, IP geolocation, or device location
- **User activity** — No keystroke logging, click tracking, mouse movement, or scroll monitoring
- **Website content** — No page body content, images, videos, or DOM scraping. Only page titles and URLs are recorded.

## Data Storage

All data is stored locally in SQLite format at:
```
~/.daybrain/data/daybrain.db
```

You can delete all stored data at any time by removing this file.

## Data Sharing

- **No data is sent to DayBrain servers** — we do not operate any servers.
- **No data is sold or transferred to third parties.**
- **No data is used for advertising, creditworthiness, or lending.**
- **With AI assistants:** When you explicitly click "Inject Context" or use any MCP tool, a text summary of your activity is shared with the AI assistant you are interacting with. You control when and what context is shared.
- **Cross-device sync (optional):** You may configure a sync URL to your own DayBrain server on another device on your local network. Data is transmitted only to that device, over your local network.

## Your Control

- All data is stored locally and is fully under your control
- Delete data at any time by removing `~/.daybrain/data/daybrain.db`
- Configure which AI chat sites the extension is active on
- Choose whether to use the optional cross-device sync feature
- The extension can be disabled or uninstalled at any time

## Changes

This policy may be updated. Changes will be reflected in the GitHub repository.

## Contact

For privacy questions, open an issue at:
https://github.com/daybrainhq/daybrain
