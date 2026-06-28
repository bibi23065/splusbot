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
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      data[key] = localStorage.getItem(key);
    }
    return data;
  });

  writeFileSync('session.json', JSON.stringify(storage));
  console.log('\nsession.json saved!');
  console.log('Upload this file as a GitHub secret called SPLUS_SESSION');
  console.log('\nSteps:');
  console.log('1. Go to your GitHub repo -> Settings -> Secrets -> Actions');
  console.log('2. Click "New repository secret"');
  console.log('3. Name: SPLUS_SESSION');
  console.log('4. Value: paste the contents of session.json');
  console.log('5. Done! The workflow will run automatically every 5 minutes.');

  await browser.close();
  rl.close();
}

main().catch(e => { console.error('Error:', e.message); rl.close(); process.exit(1); });
