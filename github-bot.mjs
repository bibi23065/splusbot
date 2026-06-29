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
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--lang=fa-IR', '--timezone=Asia/Tehran',
      ],
      defaultViewport: { width: 1280, height: 800 },
    });

    const page = await browser.newPage();

    // Force Iran timezone
    const client = await page.createCDPSession();
    await client.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Tehran' });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'fa-IR,fa;q=0.9' });

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
      function extractPreview(lastMsg) {
        if (!lastMsg) return { type: '💬 Text', preview: '' };
        const text = lastMsg.textContent?.trim() || '';
        const inner = lastMsg.innerHTML || '';

        function hasClass(patterns) {
          return patterns.some(p => inner.toLowerCase().includes(p.toLowerCase()));
        }

        function hasPersian(keywords) {
          return keywords.some(k => text.includes(k));
        }

        function extractCaption() {
          const clone = lastMsg.cloneNode(true);
          clone.querySelectorAll('video, audio, img, svg, canvas, iframe, [class*="player"], [class*="Player"]').forEach(el => el.remove());
          return clone.textContent?.trim() || '';
        }

        function toEnglishDigits(str) {
          return str.replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
        }

        function extractDuration() {
          const normalized = toEnglishDigits(text);
          const dur = normalized.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
          return dur ? dur[1] : null;
        }

        function extractFileSize() {
          const normalized = toEnglishDigits(text);
          let size = normalized.match(/(\d+\.?\d*\s*(?:KB|MB|GB|B|TB)\b)/i);
          if (size) return size[1];
          size = normalized.match(/(\d+\.?\d*\s*(?:کیلوبایت|مگابایت|گیگابایت|بایت|تراوبایت)\b)/i);
          if (size) return size[1];
          const sizeEl = lastMsg.querySelector('[class*="size"], [class*="Size"], [class*="fileInfo"], [class*="file-info"], [class*="meta"]');
          if (sizeEl) {
            const elText = toEnglishDigits(sizeEl.textContent?.trim() || '');
            size = elText.match(/(\d+\.?\d*\s*(?:KB|MB|GB|B|TB|کیلوبایت|مگابایت|گیگابایت|بایت|تراوبایت)\b)/i);
            if (size) return size[1];
          }
          return null;
        }

        function fileHasSize() {
          const normalized = toEnglishDigits(text);
          return /\d+\.?\d*\s*(KB|MB|GB|B|TB|کیلوبایت|مگابایت|گیگابایت|بایت|تراوبایت)\b/i.test(normalized);
        }
        function fileHasExt() {
          return /\.\w{1,10}(\s|$)/.test(text) && /\.(pdf|zip|docx?|xlsx?|pptx?|rar|7z|txt|csv|apk|exe|json|xml|yaml|yml|md|py|js|ts|html|css|log|sql|sh|bat|c|cpp|h|java|rb|php|swift|kt|rs|go)\b/i.test(text);
        }

        // 1. Poll
        if (hasClass(['poll', 'vote', 'quiz', 'Poll', 'Vote']) || hasPersian(['نظرسنجی'])) {
          return { type: '📊 Poll', preview: text || '[Poll]' };
        }

        // 2. Location
        if (hasClass(['location', 'map', 'geo', 'coordinate', 'Location', 'Map']) || lastMsg.querySelector('iframe[src*="map"], a[href*="maps"], a[href*="geo:"]') || hasPersian(['موقعیت', 'مکان', 'نقشه'])) {
          return { type: '📍 Location', preview: text || '[Location shared]' };
        }

        // 3. Contact
        if (hasClass(['contact', 'vcard', 'phone-card', 'Contact', 'VCard']) || hasPersian(['مخاطب', 'اشتراک‌گذاری مخاطب'])) {
          return { type: '👤 Contact', preview: text || '[Contact card]' };
        }

        // 4. Voice Message
        if (lastMsg.querySelector('audio') || hasClass(['voice-message', 'voicemessage', 'voice-note', 'voicenote', 'voice_message', 'VoiceMessage', 'VoiceNote']) || hasPersian(['پیام صوتی'])) {
          const dur = extractDuration();
          const cap = extractCaption();
          const info = dur ? `Duration: ${dur}` : '[Voice message]';
          return { type: '🎙️ Voice Message', preview: cap ? `${info}\n${cap}` : info };
        }

        // 5. Audio/Music
        if (hasClass(['music', 'song', 'track', 'Music', 'Song']) || lastMsg.querySelector('[class*="audio"], [class*="Audio"]') || fileHasExt() && /\.(mp3|wav|ogg|flac|m4a)\b/i.test(text) || hasPersian(['فایل صوتی', 'آهنگ', 'موسیقی'])) {
          return { type: '🎵 Audio', preview: extractCaption() || text || '[Audio]' };
        }

        // 6. Video
        if (lastMsg.querySelector('video') || hasClass(['video-player', 'videoplayer', 'video-preview', 'videoPreview', 'video-note', 'videonote', 'round-video']) || hasPersian(['ویدیو', 'فیلم', 'پیام ویدیویی'])) {
          return { type: '🎥 Video', preview: extractCaption() || text || '[Video]' };
        }

        // 7. File/Document
        if (lastMsg.querySelector('[class*="file"], [class*="File"], [class*="document"], [class*="Document"], [class*="download"], [class*="Download"], [class*="attachment"], [class*="Attachment"]') || fileHasExt() || fileHasSize() || hasPersian(['فایل', 'سند', 'ضمیمه'])) {
          const size = extractFileSize();
          const cap = extractCaption();
          const info = size ? `Size: ${size}` : '[File]';
          return { type: '📄 File', preview: cap ? `${info}\n${cap}` : info };
        }

        // 8. Sticker/GIF
        if (lastMsg.querySelector('[class*="sticker"], [class*="Sticker"], [class*="gif"], [class*="Gif"], [class*="animated"], canvas') || hasClass(['sticker', 'Sticker', 'gif', 'Gif']) || hasPersian(['استیکر'])) {
          return { type: '✨ Sticker', preview: '[Sticker/GIF]' };
        }

        // 9. Image
        if (lastMsg.querySelector('img') || hasPersian(['عکس', 'تصویر'])) {
          return { type: '📷 Image', preview: extractCaption() || text || '[Image]' };
        }

        // 10. Text fallback
        return { type: '💬 Text', preview: text };
      }

      const results = [];
      document.querySelectorAll('.chat-list .ListItem').forEach((item) => {
        const title = item.querySelector('.title')?.textContent?.trim() || 'Unknown';
        const lastMsg = item.querySelector('.last-message');
        const { type: msgType, preview: rawPreview } = extractPreview(lastMsg);
        const preview = rawPreview.slice(0, 500);

        // Extract timestamp from chat item
        let time = '';
        // Try multiple selectors for the time element
        const selectors = ['.time', '.DateTime', '[class*="time"]', '[class*="Time"]', '[class*="date"]', '[class*="Date"]'];
        for (const sel of selectors) {
          const el = item.querySelector(sel);
          if (el) {
            const t = el.textContent?.trim();
            if (t && t.length < 20) { time = t; break; }
          }
        }
        // Fallback: find time pattern like "14:30" or "دیروز" or date patterns
        if (!time) {
          const spans = item.querySelectorAll('span');
          for (const span of spans) {
            const t = span.textContent?.trim();
            if (t && /^\d{1,2}:\d{2}$/.test(t)) { time = t; break; }
            if (t && /^دیروز$/.test(t)) { time = t; break; }
            if (t && /^\d{1,2}[\/\-]\d{1,2}$/.test(t)) { time = t; break; }
          }
        }
        // Last fallback: scan full item text
        if (!time) {
          const fullText = item.innerText || '';
          const timeMatch = fullText.match(/(\d{1,2}:\d{2})/);
          if (timeMatch) time = timeMatch[1];
        }

        let unreadCount = 0;

        const badgeSelectors = [
          '[class*="badge"]', '[class*="Badge"]',
          '[class*="unread"]', '[class*="Unread"]',
          '[class*="counter"]', '[class*="Counter"]',
          '[class*="unreadCount"]', '[class*="unread-count"]',
        ];
        for (const sel of badgeSelectors) {
          const badge = item.querySelector(sel);
          if (badge) {
            const t = badge.textContent?.trim();
            const m = t?.match(/(\d+)/);
            if (m) {
              const n = parseInt(m[1], 10);
              if (n > 0 && n < 10000) { unreadCount = n; break; }
            }
          }
        }

        if (unreadCount === 0) {
          item.querySelectorAll('span').forEach(span => {
            if (span.children.length > 0) return;
            const t = span.textContent?.trim();
            if (!t || !/^\d+$/.test(t)) return;
            const num = parseInt(t, 10);
            if (num > 0 && num < 10000) {
              const parent = span.parentElement;
              const parentText = parent?.textContent || '';
              if (!parentText.match(/\d{1,2}:\d{2}/) && !parentText.match(/\d{1,2}\/\d{1,2}/)) {
                const grandparent = parent?.parentElement;
                const siblings = grandparent ? Array.from(grandparent.children) : [];
                let combined = '';
                for (const sib of siblings) {
                  const sibText = sib.textContent?.trim() || '';
                  if (/^\d+$/.test(sibText)) combined += sibText;
                }
                if (combined.length > 1) {
                  const combinedNum = parseInt(combined, 10);
                  if (combinedNum > 0 && combinedNum < 10000) {
                    unreadCount = Math.max(unreadCount, combinedNum);
                    return;
                  }
                }
                unreadCount = Math.max(unreadCount, num);
              }
            }
          });
        }

        if (unreadCount === 0) {
          const match = item.innerText.match(/(\d+)\s*$/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > 0 && num < 10000) unreadCount = num;
          }
        }

        if (unreadCount <= 0) return;
        results.push({ title, unreadCount, msgType, preview, time });
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
