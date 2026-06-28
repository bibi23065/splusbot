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
      // Check for unread indicators: badge, counter, unread class, or bold text
      const badge = item.querySelector('.badge, [class*="unread"], [class*="counter"], [class*="Badge"]');
      if (!badge) return;
      const count = parseInt(badge.textContent?.trim() || '0', 10);
      if (count <= 0) return;

      const titleEl = item.querySelector('.title');
      const title = titleEl?.textContent?.trim() || 'Unknown';
      results.push({ index, title, unreadCount: count });
    });
    return results;
  });
}

async function getMessagesFromChat(page) {
  await new Promise(r => setTimeout(r, 3000));
  return await page.evaluate(() => {
    const messages = [];
    // Soroush uses .bubble for message containers
    const bubbles = document.querySelectorAll('.bubble, [class*="Bubble"], [class*="message"]');
    if (bubbles.length > 0) {
      // Get last 5 messages (most recent)
      const recent = Array.from(bubbles).slice(-5);
      recent.forEach(bubble => {
        const textEl = bubble.querySelector('.text, .content, [class*="text"], [class*="content"]');
        const text = textEl?.textContent?.trim() || bubble.textContent?.trim();
        if (text && text.length > 0 && text.length < 2000) {
          messages.push(text.slice(0, 300));
        }
      });
    }
    // Fallback: grab text from right panel
    if (messages.length === 0) {
      const right = document.querySelector('.middle-column, [class*="MiddleColumn"], .chat-content');
      if (right) {
        const text = right.innerText?.trim();
        if (text) messages.push(text.slice(0, 500));
      }
    }
    return messages;
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

      if (!chatItem) {
        console.log(`Could not find chat: ${chat.title}`);
        continue;
      }

      const messages = await getMessagesFromChat(page);
      allResults.push({ title: chat.title, unreadCount: chat.unreadCount, messages });

      // Go back to chat list by clicking the back button or first tab
      await page.evaluate(() => {
        const backBtn = document.querySelector('[class*="back"], [class*="Back"]');
        if (backBtn) backBtn.click();
      });
      await waitForChatList(page);

    } catch (e) {
      console.log(`Error opening ${chat.title}: ${e.message}`);
      allResults.push({ title: chat.title, unreadCount: chat.unreadCount, messages: ['[Error reading messages]'] });
    }
  }

  // Format and send
  if (allResults.length === 0) {
    await sendTg('No unread messages found.');
  } else {
    let msg = `Soroush+ Unread Messages:\n\n`;
    for (const r of allResults) {
      msg += `--- ${r.title} (${r.unreadCount} unread) ---\n`;
      if (r.messages.length > 0) {
        r.messages.slice(-5).forEach(m => { msg += `${m}\n`; });
      } else {
        msg += '[No message content extracted]\n';
      }
      msg += '\n';
    }
    console.log(msg);
    await sendTg(msg);
  }

  await browser.close();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
