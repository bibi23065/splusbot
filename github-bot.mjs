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
  await page.waitForFunction(() => {
    const items = document.querySelectorAll('.chat-list .ListItem, .chat-list li');
    return items.length > 0;
  }, { timeout: 30000 }).catch(() => {});
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
  await new Promise(r => setTimeout(r, 3000));
  return await page.evaluate(() => {
    const messages = [];
    // Broad search: find elements with text content inside the main chat area
    const chatArea = document.querySelector('.middle-column, [class*="MiddleColumn"]');
    if (!chatArea) return messages;

    // Look for any div/p with short text that looks like a message
    const candidates = chatArea.querySelectorAll('div, p, span');
    candidates.forEach(el => {
      const text = el.textContent?.trim();
      if (!text || text.length < 3 || text.length > 500) return;
      // Skip if parent already captured this text
      if (el.parentElement && messages.includes(el.parentElement.textContent?.trim())) return;
      // Skip UI elements
      const cls = el.className?.toString?.() || '';
      if (cls.match(/header|sidebar|input|button|icon|avatar|time|meta|tab|menu/i)) return;
      if (el.children.length > 0) return; // only leaf elements
      messages.push(text.slice(0, 300));
    });

    // Deduplicate and return last 10
    const unique = [...new Set(messages)];
    return unique.slice(-10);
  });
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

  await page.evaluate((data) => {
    for (const [key, val] of Object.entries(data)) {
      if (val === null || val === undefined) continue;
      const strVal = typeof val === 'string' ? val : JSON.stringify(val);
      localStorage.setItem(key, strVal);
    }
  }, sessionData);

  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });

  console.log('Waiting for chat list to load...');
  await waitForChatList(page);

  const url = page.url();
  if (url.includes('auth') || url.includes('login')) {
    console.log('Session expired.');
    await sendTg('Soroush+ session expired. Send your session JSON to the bot again.');
    await browser.close();
    return;
  }

  console.log('Finding unread chats...');
  const unreadChats = await getUnreadChats(page);

  if (unreadChats.length === 0) {
    console.log('No unread messages.');
    await sendTg('No unread messages.');
    await browser.close();
    return;
  }

  console.log(`Found ${unreadChats.length} chats with unread messages.`);

  const allResults = [];

  for (const chat of unreadChats) {
    console.log(`Opening chat: ${chat.title} (${chat.unreadCount} unread)`);

    try {
      // Click on the chat item by index
      const clicked = await page.evaluate((chatIndex) => {
        const items = document.querySelectorAll('.chat-list .ListItem');
        if (items[chatIndex]) {
          items[chatIndex].click();
          return true;
        }
        return false;
      }, chat.index);

      if (!clicked) {
        console.log(`Could not click chat index ${chat.index}: ${chat.title}`);
        continue;
      }

      const messages = await getMessagesFromChat(page);
      allResults.push({ title: chat.title, unreadCount: chat.unreadCount, preview: chat.preview, messages });

      // Go back to chat list by clicking the back button or first tab
      await page.evaluate(() => {
        const backBtn = document.querySelector('[class*="back"], [class*="Back"]');
        if (backBtn) backBtn.click();
      });
      await waitForChatList(page);

    } catch (e) {
      console.log(`Error opening ${chat.title}: ${e.message}`);
      allResults.push({ title: chat.title, unreadCount: chat.unreadCount, preview: chat.preview, messages: ['[Error reading messages]'] });
    }
  }

  // Format and send
  if (allResults.length === 0) {
    await sendTg('No unread messages found.');
  } else {
    let msg = `Soroush+ Unread Messages:\n\n`;
    for (const r of allResults) {
      msg += `**${r.title}** (${r.unreadCount} unread)\n`;
      if (r.preview) {
        msg += `Last: ${r.preview}\n`;
      }
      if (r.messages && r.messages.length > 0) {
        msg += `---\n`;
        r.messages.forEach(m => { msg += `${m}\n`; });
      }
      msg += '\n';
    }
    console.log(msg);
    await sendTg(msg);
  }

  await browser.close();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
