#!/usr/bin/env node
'use strict';

/**
 * Auto-authenticate Juggler MCP.
 *
 * Opens browser to localhost:3003, grabs token from localStorage once
 * user is logged in, saves to ~/.juggler-mcp-token.
 *
 * Usage:
 *   node juggler-mcp-auth.js
 *
 * If already logged in, token is grabbed immediately.
 * If not, a browser window opens — login there, then press Enter in terminal.
 */

// Playwright lives in juggler-frontend/node_modules, not here
const { chromium } = require('../../juggler-frontend/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const TOKEN_PATH = path.join(process.env.HOME || process.env.USERPROFILE || '', '.juggler-mcp-token');
const JUGGLER_URL = 'http://localhost:3002';

async function grabToken() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(JUGGLER_URL);
  console.log(`Opened ${JUGGLER_URL}`);

  // Try to grab token immediately (if already logged in)
  let token = await page.evaluate(() => localStorage.getItem('token'));

  if (token && token !== 'null') {
    console.log('Token found! Saving...');
    fs.writeFileSync(TOKEN_PATH, token.trim());
    console.log(`Token saved to ${TOKEN_PATH}`);
    await browser.close();
    console.log('Done. Run /mcp to reconnect.');
    return;
  }

  console.log('Not logged in. Please login in the browser window, then press Enter here.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.once('line', resolve));
  rl.close();

  token = await page.evaluate(() => localStorage.getItem('token'));
  if (token && token !== 'null') {
    fs.writeFileSync(TOKEN_PATH, token.trim());
    console.log(`Token saved to ${TOKEN_PATH}`);
  } else {
    console.log('No token found. Login may have failed or token is stored differently.');
  }

  await browser.close();
}

grabToken().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
