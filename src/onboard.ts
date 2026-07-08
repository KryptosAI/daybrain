import * as readline from 'readline';
import { loadConfig, saveConfig, getConfigPath } from './config';

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve));
}

export async function runOnboarding(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const config = loadConfig();

  console.log('');
  console.log('🧠  DayBrain — First-Time Setup');
  console.log('════════════════════════════════');
  console.log('');
  console.log('DayBrain gives your AI assistants context about your workday.');
  console.log('Everything runs locally. Nothing leaves your machine.');
  console.log('');

  // Step 1: Data source
  console.log('📊  DATA SOURCE');
  console.log('  DayBrain can track your activity two ways:');
  console.log('  1. ActivityWatch (https://activitywatch.net) — richer data, all apps');
  console.log('  2. Built-in macOS watcher — zero permissions, browser + desktop apps');
  console.log('');
  const sourceChoice = await ask(rl, '  Use ActivityWatch if available? [Y/n] ');
  if (sourceChoice.toLowerCase() === 'n') {
    config.activitywatch.enabled = false;
    console.log('  ✓ Using built-in watcher (install: pip3 install pyobjc-framework-Quartz)');
  } else {
    console.log('  ✓ ActivityWatch enabled (make sure it\'s running: https://activitywatch.net)');
  }

  // Step 2: Slack
  console.log('');
  console.log('📤  NOTIFICATIONS');
  console.log('  DayBrain can push insights to Slack when it detects commitments.');
  const slackUrl = await ask(rl, '  Slack webhook URL? [skip] ');
  if (slackUrl && slackUrl.startsWith('https://hooks.slack.com/')) {
    config.transports.slack.webhookUrl = slackUrl;
    console.log('  ✓ Slack configured');
  } else {
    console.log('  • Skipped');
  }

  // Step 3: Telegram
  const telegramToken = await ask(rl, '  Telegram bot token? [skip] ');
  if (telegramToken && telegramToken.includes(':')) {
    config.transports.telegram.botToken = telegramToken;
    const chatId = await ask(rl, '  Telegram chat ID? ');
    config.transports.telegram.chatId = chatId;
    console.log('  ✓ Telegram configured');
  } else {
    console.log('  • Skipped');
  }

  // Step 4: AI setup
  console.log('');
  console.log('🤖  AI ASSISTANT SETUP');
  console.log('  Copy this config into your Claude/Cursor MCP settings:');
  console.log('');
  console.log('  {');
  console.log('    "mcpServers": {');
  console.log('      "daybrain": {');
  console.log('        "command": "npx",');
  console.log('        "args": ["-y", "daybrain"]');
  console.log('      }');
  console.log('    }');
  console.log('  }');
  console.log('');

  // Step 5: Chrome extension
  console.log('🧩  CHROME EXTENSION');
  console.log('  1. Open chrome://extensions');
  console.log('  2. Enable "Developer mode" (top right)');
  console.log('  3. Click "Load unpacked"');
  console.log('  4. Select the extension/ folder in the DayBrain install directory');
  console.log('');

  saveConfig(config);
  console.log(`✓ Configuration saved to ${getConfigPath()}`);
  console.log('');
  console.log('Run "daybrain" to start the server, then open Claude.ai or ChatGPT.');
  console.log('The brain button 🧠 will appear in the top-right corner.');
  console.log('');

  rl.close();
}

if (require.main === module) {
  runOnboarding().catch(console.error);
}
