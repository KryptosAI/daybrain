#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

const distPath = path.join(__dirname, '..', 'dist', 'index.js');

if (!fs.existsSync(distPath)) {
  console.error('daybrain is not built. Run: npm run build');
  process.exit(1);
}

const { main } = require(distPath);

main().catch((err) => {
  console.error('[daybrain] Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
