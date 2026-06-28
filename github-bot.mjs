import puppeteer from 'puppeteer';
import https from 'https';
import { readFileSync } from 'fs';

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
    console.log('No SPLUS_SESSION secret found.');
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

  // Restore ALL localStorage values — stringify objects
  await page.evaluate((data) => {
    for (const [key, val] of Object.entries(data)) {
      if (val === null || val === undefined) continue;
      const strVal = typeof val === 'string' ? val : JSON.stringify(val);
      localStorage.setItem(key, strVal);
    }
  }, sessionData);

  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  const url = page.url();
  console.log(`Current URL: ${url}`);

  if (url.includes('auth') || url.includes('login')) {
    console.log('Session expired.');
    await sendTg('Soroush+ session expired. Send your session JSON to the bot again to re-login.');
    await browser.close();
    return;
  }

  // Take screenshot for debugging
  await page.screenshot({ path: '/tmp/splus-debug.png', fullPage: false });
  console.log('Screenshot saved to /tmp/splus-debug.png');

  // Dump page title and visible text for analysis
  const pageInfo = await page.evaluate(() => {
    return {
      title: document.title,
      bodyText: document.body?.innerText?.slice(0, 3000) || '',
      allClassNames: [...new Set([...document.querySelectorAll('*')].slice(0, 500).flatMap(el => [...el.classList]))].join(', '),
    };
  });
  console.log('Page title:', pageInfo.title);
  console.log('Body text preview:', pageInfo.bodyText.slice(0, 500));
  console.log('Class names:', pageInfo.allClassNames.slice(0, 1000));

  console.log('Checking for unread messages...');

  const chatList = await page.evaluate(() => {
    const results = [];
    // Try many selector strategies
    const strategies = [
      // Strategy 1: Look for elements with badge/counter containing numbers
      () => {
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
          const text = el.textContent?.trim() || '';
          if (/^\d+$/.test(text) && parseInt(text) > 0 && parseInt(text) < 1000) {
            const parent = el.closest('[class*="chat"], [class*="Chat"], [class*="item"], [class*="Item"], [class*="dialog"], [class*="Dialog"]');
            if (parent) {
              const titleEl = parent.querySelector('[class*="title"], [class*="name"], [class*="Title"], [class*="Name"], [class*="peer"]');
              results.push({
                chat: titleEl?.textContent?.trim() || parent.textContent?.trim()?.slice(0, 50) || 'Unknown',
                unread: parseInt(text),
              });
            }
          }
        }
      },
      // Strategy 2: Look for specific Soroush class patterns
      () => {
        document.querySelectorAll('[class*="Badge"], [class*="badge"], [class*="unread"], [class*="counter"], [class*="Counter"]').forEach(badge => {
          const count = parseInt(badge.textContent?.trim() || '0', 10);
          if (count > 0) {
            const parent = badge.closest('div, li, a');
            if (parent) {
              results.push({ chat: parent.textContent?.trim()?.slice(0, 50) || 'Unknown', unread: count });
            }
          }
        });
      },
    ];

    for (const strategy of strategies) {
      results.length = 0;
      strategy();
      if (results.length > 0) break;
    }

    return results;
  });

  if (chatList.length === 0) {
    await sendTg('No unread messages found.');
  } else {
    let msg = `Soroush+ Unread (${chatList.length} chats):\n\n`;
    chatList.forEach(c => { msg += `${c.chat} (${c.unread} unread)\n`; });
    console.log(msg);
    await sendTg(msg);
  }

  await browser.close();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
