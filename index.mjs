import puppeteer from 'puppeteer';
import { createInterface } from 'readline';
import https from 'https';
import http from 'http';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8960541207:AAEyAriLq0tWOMZjFEMSL6plhoywCql5TRg';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

const rl = createInterface({ input: process.stdin, output: process.stdout });
function ask(q) {
  return new Promise(resolve => rl.question(q, resolve));
}

function tgApi(method, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM_BOT_TOKEN}/${method}`,
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

async function sendToTelegram(text) {
  if (!TELEGRAM_CHAT_ID) {
    console.log('\n--- Messages ---');
    console.log(text);
    console.log('--- End ---\n');
    return;
  }
  const chunks = [];
  let remaining = text;
  while (remaining.length > 4000) {
    let splitAt = remaining.lastIndexOf('\n\n', 4000);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf('\n', 4000);
    if (splitAt <= 0) splitAt = 4000;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n+/, '');
  }
  if (remaining) chunks.push(remaining);
  for (const chunk of chunks) {
    await tgApi('sendMessage', { chat_id: Number(TELEGRAM_CHAT_ID), text: chunk });
    await new Promise(r => setTimeout(r, 500));
  }
}

async function main() {
  console.log('=== Soroush+ Telegram Bot (Local) ===\n');

  if (!TELEGRAM_CHAT_ID) {
    const id = await ask('Enter your Telegram chat ID (or leave empty to print to console): ');
    if (id.trim()) process.env.TELEGRAM_CHAT_ID = id.trim();
  }

  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();
  console.log('Navigating to web.splus.ir...');
  await page.goto('https://web.splus.ir/', { waitUntil: 'networkidle2', timeout: 60000 });

  console.log('\n--- LOGIN FLOW ---');
  console.log('The browser will show the Soroush+ login page.\n');

  const phone = await ask('Enter your Soroush+ phone number (e.g. 0912xxxxxxx): ');
  console.log(`\nLooking for phone input field...`);

  await page.waitForSelector('input[type="tel"], input[placeholder*="تلفن"], input[name*="phone"]', { timeout: 30000 });
  const phoneInput = await page.$('input[type="tel"], input[placeholder*="telephone"], input[name*="phone"]');
  if (!phoneInput) {
    const allInputs = await page.$$('input');
    console.log(`Found ${allInputs.length} input fields. Trying first one...`);
  }

  const inputs = await page.$$('input');
  let targetInput = null;
  for (const inp of inputs) {
    const type = await inp.evaluate(el => el.type);
    if (type === 'tel' || type === 'text' || type === 'number') {
      targetInput = inp;
      break;
    }
  }
  if (!targetInput && inputs.length > 0) targetInput = inputs[0];

  if (targetInput) {
    await targetInput.click({ clickCount: 3 });
    await targetInput.type(phone.replace(/[^\d]/g, ''), { delay: 50 });
    console.log(`Entered phone: ${phone}`);
  } else {
    console.log('Could not find phone input. Please type it in the browser manually.');
    await ask('Press Enter after entering the phone number...');
  }

  console.log('Clicking send/next button...');
  const buttons = await page.$$('button');
  let clicked = false;
  for (const btn of buttons) {
    const text = await btn.evaluate(el => el.textContent || el.innerText || '');
    if (text.includes('ارسال') || text.includes('ادامه') || text.includes('next') || text.includes('send') || text.includes('تایید')) {
      await btn.click();
      clicked = true;
      console.log(`Clicked: "${text.trim()}"`);
      break;
    }
  }
  if (!clicked) {
    console.log('Could not find send button. Please click it manually in the browser.');
    await ask('Press Enter after clicking the send button...');
  }

  console.log('\nWaiting for SMS code...');
  const code = await ask('Enter the SMS verification code: ');

  console.log('Looking for code input field...');
  await new Promise(r => setTimeout(r, 2000));

  const codeInputs = await page.$$('input');
  let codeTarget = null;
  for (const inp of codeInputs) {
    const type = await inp.evaluate(el => el.type);
    const val = await inp.evaluate(el => el.value);
    if ((type === 'tel' || type === 'number' || type === 'text') && !val) {
      codeTarget = inp;
      break;
    }
  }
  if (!codeTarget && codeInputs.length > 0) codeTarget = codeInputs[codeInputs.length - 1];

  if (codeTarget) {
    await codeTarget.click({ clickCount: 3 });
    await codeTarget.type(code.trim(), { delay: 80 });
    console.log(`Entered code: ${code.trim()}`);
  } else {
    console.log('Could not find code input. Please type it manually.');
    await ask('Press Enter after entering the code...');
  }

  console.log('Submitting code...');
  clicked = false;
  const buttons2 = await page.$$('button');
  for (const btn of buttons2) {
    const text = await btn.evaluate(el => el.textContent || el.innerText || '');
    if (text.includes('تایید') || text.includes('ورود') || text.includes('ورود') || text.includes('verify') || text.includes('confirm') || text.includes('login')) {
      await btn.click();
      clicked = true;
      console.log(`Clicked: "${text.trim()}"`);
      break;
    }
  }
  if (!clicked) {
    console.log('Please click the verify/login button manually.');
    await ask('Press Enter after clicking the verify button...');
  }

  console.log('\nWaiting for login to complete...');
  console.log('(If 2FA password is required, enter it in the browser)');

  try {
    await page.waitForFunction(() => {
      const el = document.querySelector('[class*="ChatList"], [class*="chat-list"], [class*="sidebar"], [data-chat-id]');
      return !!el;
    }, { timeout: 120000 });
    console.log('Login successful! Chat list detected.');
  } catch {
    console.log('Timed out waiting for chat list. Continuing anyway...');
  }

  await new Promise(r => setTimeout(r, 3000));

  console.log('\n--- FETCHING MESSAGES ---');
  console.log('Extracting unread messages from the page...\n');

  const messages = await page.evaluate(() => {
    const results = [];

    const chatItems = document.querySelectorAll('[class*="ChatList"] [class*="ListItem"], [class*="chat-list"] [class*="item"], [data-chat-id]');
    if (chatItems.length > 0) {
      chatItems.forEach(item => {
        const badge = item.querySelector('[class*="badge"], [class*="Badge"], [class*="unread"], [class*="counter"]');
        if (badge) {
          const count = parseInt(badge.textContent?.trim() || '0', 10);
          if (count > 0) {
            const title = item.querySelector('[class*="title"], [class*="name"], [class*="Title"], [class*="Name"]');
            const subtitle = item.querySelector('[class*="subtitle"], [class*="message"], [class*="text"], [class*="Message"]');
            const time = item.querySelector('[class*="time"], [class*="date"], [class*="Time"]');
            results.push({
              chat: title?.textContent?.trim() || 'Unknown',
              lastMessage: subtitle?.textContent?.trim() || '',
              time: time?.textContent?.trim() || '',
              unread: count,
              chatId: item.getAttribute('data-chat-id') || '',
            });
          }
        }
      });
    }

    if (results.length === 0) {
      const allItems = document.querySelectorAll('[class*="ListItem"], [class*="list-item"], li');
      allItems.forEach(item => {
        const text = item.textContent || '';
        const badgeMatch = text.match(/(\d+)/);
        if (badgeMatch && parseInt(badgeMatch[1]) > 0 && parseInt(badgeMatch[1]) < 100) {
          results.push({
            chat: text.substring(0, 50).trim(),
            lastMessage: text.substring(0, 100).trim(),
            time: '',
            unread: parseInt(badgeMatch[1]),
            chatId: '',
          });
        }
      });
    }

    return results;
  });

  if (messages.length === 0) {
    console.log('No unread messages found via DOM scraping.');
    console.log('Attempting to access GramJs client from page context...\n');

    const gramMessages = await page.evaluate(async () => {
      try {
        const state = JSON.parse(localStorage.getItem('sp-global-state') || '{}');
        const authState = state.authState;
        if (!authState || authState !== 'authorizationStateReady') {
          return { error: 'Not authenticated', state: authState };
        }

        const results = [];
        const chatList = document.querySelectorAll('[class*="Chat"] [class*="peer"], [class*="chat"] [class*="title"]');
        chatList.forEach(el => {
          results.push({ text: el.textContent?.trim() || '', tag: el.tagName });
        });

        return { items: results, state: authState };
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('GramJs state:', JSON.stringify(gramMessages, null, 2));
  }

  let output = '';

  if (messages.length > 0) {
    output += `Soroush+ Unread Messages (${messages.length} chats)\n\n`;
    messages.forEach(m => {
      output += `Chat: ${m.chat}\n`;
      if (m.unread) output += `Unread: ${m.unread}\n`;
      if (m.time) output += `Time: ${m.time}\n`;
      if (m.lastMessage) output += `Last: ${m.lastMessage}\n`;
      output += '---\n\n';
    });
  } else {
    output = 'No unread messages found in Soroush+.';
  }

  console.log(output);
  await sendToTelegram(output);

  console.log('\nBrowser will stay open for 5 minutes. You can close it manually.');
  console.log('Press Enter to close immediately.');
  const timeout = setTimeout(async () => {
    await browser.close();
    rl.close();
    process.exit(0);
  }, 300000);

  await ask('');
  clearTimeout(timeout);
  await browser.close();
  rl.close();
}

main().catch(e => {
  console.error('Fatal error:', e);
  rl.close();
  process.exit(1);
});
