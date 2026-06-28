import puppeteer from 'puppeteer';
import https from 'https';
import { readFileSync, existsSync } from 'fs';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const SESSION_JSON = process.env.SPLUS_SESSION || '';

function tg(method, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(buf); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sendTg(text) {
  if (!BOT_TOKEN || !CHAT_ID) { console.log(text); return; }
  const maxLen = 4000;
  const chunks = [];
  let rem = text;
  while (rem.length > maxLen) {
    let split = rem.lastIndexOf('\n\n', maxLen);
    if (split <= 0) split = rem.lastIndexOf('\n', maxLen);
    if (split <= 0) split = maxLen;
    chunks.push(rem.slice(0, split));
    rem = rem.slice(split).replace(/^\n+/, '');
  }
  if (rem) chunks.push(rem);
  for (const c of chunks) {
    await tg('sendMessage', { chat_id: Number(CHAT_ID), text: c });
    await new Promise(r => setTimeout(r, 500));
  }
}

async function main() {
  console.log('Soroush+ GitHub Actions Bot');

  if (!SESSION_JSON) {
    console.log('No SPLUS_SESSION secret found. Send your session JSON to the bot first.');
    return;
  }

  let sessionData;
  try { sessionData = JSON.parse(SESSION_JSON); } catch { sessionData = {}; }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();

  console.log('Restoring session...');
  await page.goto('https://web.splus.ir/', { waitUntil: 'networkidle2', timeout: 60000 });

  await page.evaluate((data) => {
    for (const [key, val] of Object.entries(data)) {
      if (typeof val === 'string') {
        localStorage.setItem(key, val);
      }
    }
  }, sessionData);

  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  console.log('Checking for unread messages...');

  const chatList = await page.evaluate(() => {
    const results = [];
    const selectors = [
      '[class*="ChatList"] [class*="ListItem"]',
      '[class*="chat-list"] [class*="item"]',
      '[data-chat-id]',
      'li[class*="chat"]',
    ];
    for (const sel of selectors) {
      const items = document.querySelectorAll(sel);
      if (items.length > 0) {
        items.forEach(item => {
          const badge = item.querySelector('[class*="badge"], [class*="Badge"], [class*="unread"], [class*="counter"]');
          if (badge) {
            const count = parseInt(badge.textContent?.trim() || '0', 10);
            if (count > 0) {
              const title = item.querySelector('[class*="title"], [class*="name"], [class*="Title"], [class*="Name"]');
              results.push({
                chat: title?.textContent?.trim() || 'Unknown',
                unread: count,
              });
            }
          }
        });
        break;
      }
    }
    return results;
  });

  if (chatList.length === 0) {
    console.log('No unread messages found.');
    const url = page.url();
    console.log(`Current URL: ${url}`);

    if (url.includes('auth') || url.includes('login')) {
      console.log('Session expired. Need to re-extract.');
      await sendTg('Soroush+ session expired. Send your session JSON to the bot again to re-login.');
    } else {
      await sendTg('No unread messages.');
    }
  } else {
    let msg = `Soroush+ Unread (${chatList.length} chats):\n\n`;
    chatList.forEach(c => { msg += `${c.chat} (${c.unread} unread)\n`; });
    console.log(msg);
    await sendTg(msg);
  }

  await browser.close();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
