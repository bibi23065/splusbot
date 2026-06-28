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
    return document.querySelectorAll('.chat-list .ListItem').length > 0;
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

async function getMessagesFromChat(page, cdp) {
  // Set up WebSocket frame interception via CDP
  const messages = [];

  // Use page.evaluate to extract messages from the app's internal state
  // Soroush stores messages in a global store or React state
  const result = await page.evaluate(() => {
    const msgs = [];

    // Strategy 1: Access app's internal message store
    // Soroush is built on GramJs/MTProto — messages are stored in app state
    try {
      // Check window.__STORE__ or similar global state
      if (window.__STORE__) {
        const state = window.__STORE__.getState?.();
        if (state?.messages) {
          for (const [, msg] of Object.entries(state.messages)) {
            if (msg?.message) msgs.push(msg.message);
          }
        }
      }
    } catch {}

    // Strategy 2: Access React fiber tree
    try {
      const root = document.querySelector('#root') || document.querySelector('#app');
      if (root?._reactRootContainer || root?.__reactFiber$) {
        // Found React root — traverse fiber for message data
      }
    } catch {}

    // Strategy 3: Extract from DOM with broader selectors
    const chatArea = document.querySelector('.middle-column, [class*="MiddleColumn"], [class*="chat-content"]');
    if (chatArea) {
      // Get ALL text nodes that look like messages
      const walker = document.createTreeWalker(chatArea, NodeFilter.SHOW_TEXT, null);
      let node;
      while (node = walker.nextNode()) {
        const text = node.textContent?.trim();
        if (text && text.length > 2 && text.length < 500) {
          // Check parent isn't a UI element
          const parent = node.parentElement;
          if (parent) {
            const tag = parent.tagName;
            const cls = parent.className?.toString?.() || '';
            // Skip headers, inputs, buttons, etc.
            if (!cls.match(/header|input|button|icon|avatar|tab|menu|search|status/i)) {
              msgs.push(text);
            }
          }
        }
      }
    }

    // Strategy 4: Get innerText of right panel and split by newlines
    if (msgs.length === 0 && chatArea) {
      const fullText = chatArea.innerText;
      if (fullText) {
        fullText.split('\n').forEach(line => {
          const trimmed = line.trim();
          if (trimmed.length > 2 && trimmed.length < 500) {
            msgs.push(trimmed);
          }
        });
      }
    }

    // Deduplicate and return last 15
    return [...new Set(msgs)].slice(-15);
  });

  return result;
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
      const clicked = await page.evaluate((chatIndex) => {
        const items = document.querySelectorAll('.chat-list .ListItem');
        if (items[chatIndex]) {
          items[chatIndex].click();
          return true;
        }
        return false;
      }, chat.index);

      if (!clicked) {
        console.log(`Could not click chat index ${chat.index}`);
        continue;
      }

      // Wait for messages to load
      await new Promise(r => setTimeout(r, 4000));

      const messages = await getMessagesFromChat(page);
      allResults.push({ title: chat.title, unreadCount: chat.unreadCount, preview: chat.preview, messages });

      // Navigate back to chat list
      await page.evaluate(() => {
        // Click first chat folder tab to go back
        const tab = document.querySelector('.Tab--active, .chat-list');
        if (tab) tab.click();
      });
      await waitForChatList(page);

    } catch (e) {
      console.log(`Error opening ${chat.title}: ${e.message}`);
      allResults.push({ title: chat.title, unreadCount: chat.unreadCount, preview: chat.preview, messages: [] });
    }
  }

  // Format and send
  if (allResults.length === 0) {
    await sendTg('No unread messages found.');
  } else {
    let msg = `Soroush+ Unread Messages:\n\n`;
    for (const r of allResults) {
      msg += `**${r.title}** (${r.unreadCount} unread)\n`;
      if (r.messages && r.messages.length > 0) {
        r.messages.forEach(m => { msg += `  ${m}\n`; });
      } else if (r.preview) {
        msg += `  Last: ${r.preview}\n`;
      }
      msg += '\n';
    }
    console.log(msg);
    await sendTg(msg);
  }

  await browser.close();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
