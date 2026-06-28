import puppeteer from 'puppeteer';
import { createInterface } from 'readline';
import { writeFileSync } from 'fs';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

async function main() {
  console.log('=== Extract Soroush+ Session for GitHub Actions ===\n');

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();
  await page.goto('https://web.splus.ir/', { waitUntil: 'networkidle2', timeout: 60000 });

  console.log('Log in to Soroush+ in the browser.');
  await ask('Press Enter AFTER you see your chat list: ');

  const storage = await page.evaluate(() => {
    const data = {};
    const essentialKeys = [
      'GramJs:sessionId',
      'user_auth',
      'sp-global-state',
      'sp-passcode',
      'sp-dhash',
      'sp-multitab',
    ];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (essentialKeys.some(k => key.startsWith(k)) || key.startsWith('GramJs')) {
        const val = localStorage.getItem(key);
        if (val && val.length < 50000) data[key] = val;
      }
    }
    return data;
  });

  const size = JSON.stringify(storage).length;
  writeFileSync('session.json', JSON.stringify(storage));
  console.log(`\nsession.json saved! (${size} bytes, ${Object.keys(storage).length} keys)`);
  if (size > 60000) console.log('WARNING: File may be too large for GitHub (64KB limit).');
  console.log('\nPaste the contents of session.json as the SPLUS_SESSION secret:');
  console.log('https://github.com/bibi23065/splusbot/settings/secrets/actions');

  await browser.close();
  rl.close();
}

main().catch(e => { console.error('Error:', e.message); rl.close(); process.exit(1); });
