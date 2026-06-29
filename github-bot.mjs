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
      // Click the chat item using puppeteer's click method with force
      const items = await page.$$('.chat-list .ListItem');
      if (items[chat.index]) {
        await items[chat.index].click({ force: true });
      }

      // Wait for chat view to appear
      await page.waitForFunction(() => {
        // Check if URL hash changed or if right panel content changed
        return window.location.hash.length > 1;
      }, { timeout: 5000 }).catch(() => {});

      await new Promise(r => setTimeout(r, 3000));

      // Get the current hash (chat ID)
      const hash = await page.evaluate(() => window.location.hash);

      // Extract all visible text from the page, filtering to right panel
      const pageText = await page.evaluate(() => {
        const rightPanel = document.querySelector('.middle-column, [class*="MiddleColumn"]');
        if (!rightPanel) return '';
        return rightPanel.innerText || '';
      });

      const lines = pageText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

      msg += `**${chat.title}** (${chat.unreadCount}) [${hash}]\n`;
      if (lines.length > 0) {
        lines.slice(-8).forEach(l => { msg += `  ${l}\n`; });
      } else {
        msg += `  ${chat.preview}\n`;
      }
      msg += '\n';

      // Return to chat list
      await page.evaluate(() => { window.location.hash = ''; });
      await waitForChatList(page);
    } catch (e) {
      console.log(`Error: ${e.message}`);
      msg += `**${chat.title}** (${chat.unreadCount})\n  ${chat.preview}\n\n`;
    }
  }

  console.log(msg);
  await sendTg(msg);
  await browser.close();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
