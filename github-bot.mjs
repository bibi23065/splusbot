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

async function waitForChatList(page) {
  await page.waitForFunction(() => document.querySelectorAll('.chat-list .ListItem').length > 0, { timeout: 30000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
}

async function getUnreadChats(page) {
  return await page.evaluate(() => {
    const results = [];
    const items = document.querySelectorAll('.chat-list .ListItem');
    items.forEach((item, index) => {
      const badge = item.querySelector('.badge, [class*="unread"], [class*="counter"], [class*="Badge"]');
      if (!badge) return;
      const count = parseInt(badge.textContent?.trim() || '0', 10);
      if (count <= 0) return;
      const titleEl = item.querySelector('.title');
      const title = titleEl?.textContent?.trim() || 'Unknown';
      const lastMsg = item.querySelector('.last-message');
      const preview = lastMsg?.textContent?.trim() || '';
      results.push({ index, title, unreadCount: count, preview: preview.slice(0, 200) });
    });
    return results;
  });
}

async function extractChatMessages(page) {
  await new Promise(r => setTimeout(r, 4000));

  return await page.evaluate(() => {
    const msgs = [];

    // Find the right panel (chat view) - anything after x=350
    const allEls = document.querySelectorAll('*');
    const seen = new Set();

    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      // Only elements in the right portion (chat area)
      if (rect.left < 400 || rect.width < 50) continue;

      const text = el.textContent?.trim();
      if (!text || text.length < 2 || text.length > 400) continue;
      if (seen.has(text)) continue;

      const cls = el.className?.toString?.() || '';
      // Skip chat list items and UI chrome
      if (cls.match(/ListItem|Chat|tab|header|input|button|icon|avatar|spinner|menu|search|badge|folder/i)) continue;
      // Only leaf-ish elements
      if (el.children.length > 2) continue;

      seen.add(text);
      msgs.push(text.slice(0, 300));
    }

    return msgs.slice(-15);
  });
}

async function main() {
  console.log('Soroush+ Bot');

  if (!SESSION_JSON) { console.log('No session.'); return; }

  let sessionData;
  try { sessionData = JSON.parse(SESSION_JSON); } catch { sessionData = {}; }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();

  await page.goto('https://web.splus.ir/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate((data) => {
    for (const [key, val] of Object.entries(data)) {
      if (val != null) localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
    }
  }, sessionData);
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await waitForChatList(page);

  if (page.url().includes('auth') || page.url().includes('login')) {
    await sendTg('Session expired.');
    await browser.close();
    return;
  }

  // Take initial screenshot
  await page.screenshot({ path: '/tmp/splus-before.png' });

  const unreadChats = await getUnreadChats(page);
  if (unreadChats.length === 0) {
    await sendTg('No unread messages.');
    await browser.close();
    return;
  }

  console.log(`${unreadChats.length} unread chats.`);

  let msg = `Soroush+ Unread (${unreadChats.length} chats):\n\n`;

  for (const chat of unreadChats) {
    console.log(`Opening: ${chat.title}`);
    try {
      // Click using dispatchEvent for reliability
      await page.evaluate((idx) => {
        const item = document.querySelectorAll('.chat-list .ListItem')[idx];
        if (item) {
          item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
      }, chat.index);

      await new Promise(r => setTimeout(r, 3000));
      await page.screenshot({ path: `/tmp/splus-chat-${chat.index}.png` });

      const messages = await extractChatMessages(page);

      msg += `**${chat.title}** (${chat.unreadCount})\n`;
      if (messages.length > 0) {
        messages.forEach(m => { msg += `  ${m}\n`; });
      } else {
        msg += `  ${chat.preview}\n`;
      }
      msg += '\n';

      // Navigate back
      await page.evaluate(() => {
        document.querySelector('.Tab--active')?.click();
      });
      await waitForChatList(page);
    } catch (e) {
      msg += `**${chat.title}** (${chat.unreadCount})\n  ${chat.preview}\n\n`;
    }
  }

  console.log(msg);
  await sendTg(msg);
  await browser.close();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
