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

async function getMessagesFromChat(page) {
  // Wait for chat to load
  await new Promise(r => setTimeout(r, 4000));

  // Extract messages using innerText of the entire page after chat opens
  // This catches text rendered in any way (canvas, virtual DOM, etc.)
  return await page.evaluate(() => {
    const msgs = [];
    // Get all text from the right side of the screen (chat area)
    const allElements = document.querySelectorAll('*');
    const seenTexts = new Set();

    for (const el of allElements) {
      // Only consider elements in the right portion of the screen
      const rect = el.getBoundingClientRect();
      if (rect.left < 350) continue; // Skip left panel (chat list)

      const text = el.textContent?.trim();
      if (!text || text.length < 2 || text.length > 500) continue;
      if (seenTexts.has(text)) continue;

      const cls = el.className?.toString?.() || '';
      // Skip UI chrome
      if (cls.match(/header|input|button|icon|avatar|tab|menu|search|status|spinner|loading/i)) continue;
      // Only leaf nodes or nodes with minimal children
      if (el.children.length > 3) continue;

      seenTexts.add(text);
      msgs.push(text.slice(0, 300));
    }

    return msgs.slice(-15);
  });
}

async function main() {
  console.log('Soroush+ GitHub Actions Bot');

  if (!SESSION_JSON) { console.log('No SPLUS_SESSION.'); return; }

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
      if (val === null || val === undefined) continue;
      localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
    }
  }, sessionData);

  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  console.log('Waiting for chat list...');
  await waitForChatList(page);

  if (page.url().includes('auth') || page.url().includes('login')) {
    await sendTg('Session expired. Re-login needed.');
    await browser.close();
    return;
  }

  const unreadChats = await getUnreadChats(page);
  if (unreadChats.length === 0) {
    await sendTg('No unread messages.');
    await browser.close();
    return;
  }

  console.log(`Found ${unreadChats.length} unread chats.`);

  const allResults = [];

  for (const chat of unreadChats) {
    console.log(`Opening: ${chat.title}`);
    try {
      const clicked = await page.evaluate((idx) => {
        const items = document.querySelectorAll('.chat-list .ListItem');
        if (items[idx]) { items[idx].click(); return true; }
        return false;
      }, chat.index);

      if (!clicked) continue;

      const messages = await getMessagesFromChat(page);
      allResults.push({ ...chat, messages });

      // Return to chat list
      await page.evaluate(() => {
        const tab = document.querySelector('.Tab--active');
        if (tab) tab.click();
      });
      await waitForChatList(page);
    } catch (e) {
      console.log(`Error: ${e.message}`);
      allResults.push({ ...chat, messages: [] });
    }
  }

  // Send results
  let msg = `Soroush+ Unread (${allResults.length} chats):\n\n`;
  for (const r of allResults) {
    msg += `**${r.title}** (${r.unreadCount})\n`;
    if (r.messages.length > 0) {
      r.messages.forEach(m => { msg += `  ${m}\n`; });
    } else {
      msg += `  ${r.preview}\n`;
    }
    msg += '\n';
  }

  console.log(msg);
  await sendTg(msg);
  await browser.close();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
