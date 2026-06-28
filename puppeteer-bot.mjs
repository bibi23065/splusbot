import puppeteer from 'puppeteer';
import { createInterface } from 'readline';
import https from 'https';

const BOT_TOKEN = '8960541207:AAEyAriLq0tWOMZjFEMSL6plhoywCql5TRg';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

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

async function sendTg(chatId, text) {
  const maxLen = 4000;
  if (text.length <= maxLen) {
    await tg('sendMessage', { chat_id: chatId, text });
  } else {
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
      await tg('sendMessage', { chat_id: chatId, text: c });
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

async function main() {
  console.log('=== Soroush+ Bot (Local) ===\n');

  const chatIdStr = await ask('Enter your Telegram chat ID: ');
  const chatId = Number(chatIdStr.trim());
  if (!chatId) { console.log('Invalid chat ID'); rl.close(); return; }

  await sendTg(chatId, 'Launching browser for Soroush+ login...');

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();
  await page.goto('https://web.splus.ir/', { waitUntil: 'networkidle2', timeout: 60000 });

  console.log('\nLog in to Soroush+ in the browser window.');
  console.log('Enter phone number and SMS code when prompted.\n');

  await ask('Press Enter AFTER you see your chat list: ');

  console.log('Extracting unread chats from browser...');

  const chatList = await page.evaluate(() => {
    const results = [];
    const items = document.querySelectorAll('[class*="ChatList"] [class*="ListItem"], [class*="chat-list"] [class*="item"], [data-chat-id]');
    items.forEach(item => {
      const badge = item.querySelector('[class*="badge"], [class*="Badge"], [class*="unread"], [class*="counter"]');
      if (badge) {
        const count = parseInt(badge.textContent?.trim() || '0', 10);
        if (count > 0) {
          const title = item.querySelector('[class*="title"], [class*="name"], [class*="Title"], [class*="Name"]');
          results.push({
            chat: title?.textContent?.trim() || 'Unknown',
            unread: count,
            chatId: item.getAttribute('data-chat-id') || '',
          });
        }
      }
    });
    return results;
  });

  if (chatList.length === 0) {
    await sendTg(chatId, 'No unread chats found via DOM scraping. Trying alternate selectors...');

    const altChatList = await page.evaluate(() => {
      const results = [];
      const allItems = document.querySelectorAll('li, [role="listitem"]');
      allItems.forEach(item => {
        const badge = item.querySelector('[class*="badge"], [class*="Badge"], [class*="counter"]');
        if (badge) {
          const count = parseInt(badge.textContent?.trim() || '0', 10);
          if (count > 0) {
            const titleEl = item.querySelector('h3, h4, [class*="title"], [class*="name"]');
            results.push({
              chat: titleEl?.textContent?.trim() || item.textContent?.substring(0, 40)?.trim() || 'Unknown',
              unread: count,
            });
          }
        }
      });
      return results;
    });

    if (altChatList.length > 0) {
      let msg = `Found ${altChatList.length} chats with unread messages:\n\n`;
      altChatList.forEach(c => { msg += `${c.chat} (${c.unread} unread)\n`; });
      await sendTg(chatId, msg);
    } else {
      await sendTg(chatId, 'Could not find unread chats via DOM. The page structure may have changed.');
    }
  } else {
    let msg = `Found ${chatList.length} chats with unread messages:\n\n`;
    chatList.forEach(c => { msg += `${c.chat} (${c.unread} unread)\n`; });
    await sendTg(chatId, msg);
  }

  console.log('\nDone! Browser stays open for 5 minutes.');
  await ask('Press Enter to close browser: ');

  await browser.close();
  rl.close();
}

main().catch(e => { console.error('Error:', e.message); rl.close(); process.exit(1); });
