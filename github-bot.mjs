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

async function postToWorker(data) {
  if (!WORKER_URL) return;
  try {
    const resp = await fetch(`${WORKER_URL}/webhook/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!resp.ok) {
      console.error(`Worker webhook failed: ${resp.status}`);
    }
  } catch (e) {
    console.error(`Worker webhook error: ${e.message}`);
  }
}

async function sendErrorReport(chatId, errorMsg) {
  if (WORKER_URL && chatId) {
    await postToWorker({ chatId: Number(chatId), error: errorMsg, timestamp: Date.now() });
  } else if (BOT_TOKEN && chatId) {
    await tg('sendMessage', {
      chat_id: Number(chatId),
      text: `❌ *Script Error Report*\n\n\`${errorMsg}\``,
      parse_mode: 'MarkdownV2',
    });
  }
}

async function main() {
  if (!SESSION_JSON) {
    console.log('No session.');
    return;
  }

  let sessionData;
  try { sessionData = JSON.parse(SESSION_JSON); } catch { sessionData = {}; }

  let browser;
  try {
    browser = await puppeteer.launch({
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
    await new Promise(r => setTimeout(r, 1000));

    // Scroll chat list to load all items, stop when count stabilizes
    let prevCount = 0;
    let stableRounds = 0;
    for (let i = 0; i < 12; i++) {
      await page.evaluate(() => {
        const list = document.querySelector('.chat-list');
        if (list) list.scrollTop = list.scrollHeight;
      });
      await new Promise(r => setTimeout(r, 1000));
      const count = await page.evaluate(() => document.querySelectorAll('.chat-list .ListItem').length);
      console.log(`Chat items loaded: ${count}`);
      if (count === prevCount && count > 0) {
        stableRounds++;
        if (stableRounds >= 2) break;
      } else {
        stableRounds = 0;
      }
      prevCount = count;
    }

    if (page.url().includes('auth') || page.url().includes('login')) {
      const errorMsg = 'Soroush+ session expired. Re-login needed.';
      console.error(errorMsg);
      await sendErrorReport(CHAT_ID, errorMsg);
      await browser.close();
      return;
    }

    const unreadChats = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('.chat-list .ListItem').forEach((item) => {
        const title = item.querySelector('.title')?.textContent?.trim() || 'Unknown';
        const preview = item.querySelector('.last-message')?.textContent?.trim() || '';

        // Extract timestamp from chat item
        let time = '';
        const timeEl = item.querySelector('.time') || item.querySelector('[class*="time"]') || item.querySelector('[class*="date"]');
        if (timeEl) {
          time = timeEl.textContent?.trim() || '';
        }
        // Fallback: look for time patterns in the item text
        if (!time) {
          const fullText = item.innerText || '';
          const timeMatch = fullText.match(/(\d{1,2}:\d{2})/);
          if (timeMatch) time = timeMatch[1];
        }

        let unreadCount = 0;

        item.querySelectorAll('span').forEach(span => {
          if (span.children.length > 0) return;
          const text = span.textContent?.trim();
          if (!text || !/^\d+$/.test(text)) return;
          const num = parseInt(text, 10);
          if (num > 0 && num < 10000) {
            const parent = span.parentElement;
            const parentText = parent?.textContent || '';
            if (!parentText.match(/\d{1,2}:\d{2}/) && !parentText.match(/\d{1,2}\/\d{1,2}/)) {
              unreadCount = Math.max(unreadCount, num);
            }
          }
        });

        if (unreadCount === 0) {
          const match = item.innerText.match(/(\d+)\s*$/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > 0 && num < 10000) unreadCount = num;
          }
        }

        if (unreadCount <= 0) return;
        results.push({ title, unreadCount, preview: preview.slice(0, 500), time });
      });
      return results;
    });

    await browser.close();

    if (unreadChats.length === 0) {
      await postToWorker({ chatId: Number(CHAT_ID), chats: [], timestamp: Date.now() });
      return;
    }

    await postToWorker({ chatId: Number(CHAT_ID), chats: unreadChats, timestamp: Date.now() });
  } catch (e) {
    console.error('Script error:', e.message);
    await sendErrorReport(CHAT_ID, e.message);
    if (browser) await browser.close().catch(() => {});
    process.exit(1);
  }
}

main();
