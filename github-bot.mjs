import puppeteer from 'puppeteer';
import https from 'https';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const SESSION_JSON = process.env.SPLUS_SESSION || '';
const WORKER_URL = process.env.WORKER_URL || '';

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
  const chunks = [];
  let rem = text;
  while (rem.length > 4000) {
    let split = rem.lastIndexOf('\n\n', 4000);
    if (split <= 0) split = rem.lastIndexOf('\n', 4000);
    if (split <= 0) split = 4000;
    chunks.push(rem.slice(0, split));
    rem = rem.slice(split).replace(/^\n+/, '');
  }
  if (rem) chunks.push(rem);
  for (const c of chunks) {
    await tg('sendMessage', { chat_id: Number(CHAT_ID), text: c });
    await new Promise(r => setTimeout(r, 500));
  }
}

async function postToWorker(data) {
  try {
    const resp = await fetch(`${WORKER_URL}/webhook/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.error(`Worker webhook failed: ${resp.status} ${err}`);
    } else {
      console.log('Results posted to worker successfully');
    }
  } catch (e) {
    console.error(`Worker webhook error: ${e.message}`);
  }
}

async function main() {
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

  // Click "All" tab to show all chats
  await page.evaluate(() => {
    const tabs = document.querySelectorAll('.Tab');
    for (const tab of tabs) {
      if (tab.textContent?.includes('همه') || tab.textContent?.includes('All')) {
        tab.click();
        break;
      }
    }
  });
  await new Promise(r => setTimeout(r, 2000));

  // Scroll chat list multiple times to load all items
  for (let i = 0; i < 15; i++) {
    await page.evaluate(() => {
      const list = document.querySelector('.chat-list');
      if (list) list.scrollTop = list.scrollHeight;
    });
    await new Promise(r => setTimeout(r, 1500));
  }

  // Wait for final stable count
  let prevCount = 0;
  let stableRounds = 0;
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const count = await page.evaluate(() => document.querySelectorAll('.chat-list .ListItem').length);
    console.log(`Chat items loaded: ${count}`);
    if (count === prevCount && count > 0) {
      stableRounds++;
      if (stableRounds >= 3) break;
    } else {
      stableRounds = 0;
    }
    prevCount = count;
    await page.evaluate(() => {
      const list = document.querySelector('.chat-list');
      if (list) list.scrollTop = list.scrollHeight;
    });
  }

  if (page.url().includes('auth') || page.url().includes('login')) {
    await sendTg('Soroush+ session expired. Re-login needed.');
    await browser.close();
    return;
  }

  const unreadChats = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('.chat-list .ListItem').forEach((item) => {
      const title = item.querySelector('.title')?.textContent?.trim() || 'Unknown';
      const preview = item.querySelector('.last-message')?.textContent?.trim() || '';

      let unreadCount = 0;

      // Find leaf span elements containing only a number
      item.querySelectorAll('span').forEach(span => {
        if (span.children.length > 0) return;
        const text = span.textContent?.trim();
        if (!text || !/^\d+$/.test(text)) return;
        const num = parseInt(text, 10);
        if (num > 0 && num < 10000) {
          // Make sure it's not part of a date or time
          const parent = span.parentElement;
          const parentText = parent?.textContent || '';
          if (!parentText.match(/\d{1,2}:\d{2}/) && !parentText.match(/\d{1,2}\/\d{1,2}/)) {
            unreadCount = Math.max(unreadCount, num);
          }
        }
      });

      // Fallback: trailing number in the item's full text
      if (unreadCount === 0) {
        const match = item.innerText.match(/(\d+)\s*$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > 0 && num < 10000) unreadCount = num;
        }
      }

      if (unreadCount <= 0) return;
      results.push({ title, unreadCount, preview: preview.slice(0, 250) });
    });
    return results;
  });

  await browser.close();

  if (unreadChats.length === 0) {
    if (WORKER_URL && CHAT_ID) {
      await postToWorker({ chatId: Number(CHAT_ID), chats: [], timestamp: Date.now() });
    } else {
      await sendTg('No unread messages.');
    }
    return;
  }

  if (WORKER_URL && CHAT_ID) {
    await postToWorker({ chatId: Number(CHAT_ID), chats: unreadChats, timestamp: Date.now() });
  } else {
    let msg = `Soroush+ Unread (${unreadChats.length} chats):\n\n`;
    for (const chat of unreadChats) {
      msg += `${chat.title} (${chat.unreadCount} unread)\n`;
      if (chat.preview) msg += `  > ${chat.preview}\n`;
      msg += '\n';
    }
    console.log(msg);
    await sendTg(msg);
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
