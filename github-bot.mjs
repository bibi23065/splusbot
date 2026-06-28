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
  await new Promise(r => setTimeout(r, 5000));
  return await page.evaluate(() => {
    const msgs = [];
    // Get ALL innerText from the page
    const bodyText = document.body.innerText;
    const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Find lines that look like messages (not UI elements)
    const uiPatterns = /^(همه|شخصی|گروه|کانال|جستجو|تنظیمات|حساب|تماس|ویترین|هوش|چت|پیام|گفتگو|بازگشت|ارسال|جست|منو|بستن|خانه|بیشتر|فیلتر|آرشیو|پین|سنجاق|حذف|بیصدا|گزارش|تغییر|مدیریت|ذخیره|forward|reply|copy|delete|pin|mute|report|archive)$/i;
    const numPattern = /^\d+$/;
    const datePattern = /^\d{1,2}:\d{2}$/;
    const dateFormat = /^\d{1,2}\/\d{1,2}$/;
    const persianDate = /^(دیروز|امروز|۱|۲|۳|۴|۵|۶|۷|۸|۹|۱۰|۱۱|۱۲|۱۳|۱۴|۱۵|۱۶|۱۷|۱۸|۱۹|۲۰|۲۱|۲۲|۲۳|۲۴|۲۵|۲۶|۲۷|۲۸|۲۹|۳۰|۳[۱۲])\s*(فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)/;

    for (const line of lines) {
      if (line.length < 3 || line.length > 400) continue;
      if (numPattern.test(line)) continue;
      if (datePattern.test(line)) continue;
      if (dateFormat.test(line)) continue;
      if (persianDate.test(line)) continue;
      if (uiPatterns.test(line)) continue;
      if (line.match(/^(من|تو|و|این|آن|که|را|از|با|بر|در|به|تا|و)\s*$/)) continue;

      msgs.push(line);
    }

    // Return unique lines, last 15
    return [...new Set(msgs)].slice(-15);
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
      await page.evaluate((idx) => {
        document.querySelectorAll('.chat-list .ListItem')[idx]?.click();
      }, chat.index);

      const messages = await getMessagesFromChat(page);

      msg += `**${chat.title}** (${chat.unreadCount})\n`;
      if (messages.length > 0) {
        messages.forEach(m => { msg += `  ${m}\n`; });
      } else {
        msg += `  ${chat.preview}\n`;
      }
      msg += '\n';

      // Return to chat list
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
