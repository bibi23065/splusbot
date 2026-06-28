import puppeteer from 'puppeteer';
import { createInterface } from 'readline';
import { writeFileSync } from 'fs';

const rl = createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(resolve => rl.question(q, resolve)); }

async function main() {
  console.log('=== Soroush+ Session Extractor ===\n');
  console.log('This will open web.splus.ir, you log in, then I extract the session.\n');

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();
  console.log('Opening web.splus.ir...');
  await page.goto('https://web.splus.ir/', { waitUntil: 'networkidle2', timeout: 60000 });

  console.log('\nPlease log in to Soroush+ in the browser window.');
  console.log('Enter your phone number and SMS code when prompted.\n');

  await ask('Press Enter here AFTER you have fully logged in and can see your chats: ');

  console.log('\nExtracting session data from browser...');

  const sessionData = await page.evaluate(() => {
    const result = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const val = localStorage.getItem(key);
      if (key && val) result[key] = val;
    }
    return result;
  });

  const gramSession = sessionData['GramJs:sessionId'] || '';
  const userAuth = sessionData['user_auth'] || '';

  const tokenObj = {
    sessionId: gramSession,
    userAuth: userAuth,
    allKeys: Object.keys(sessionData),
  };

  const tokenStr = JSON.stringify(tokenObj);

  console.log('\nSession extracted!');
  console.log(`Found ${Object.keys(sessionData).length} localStorage keys`);
  console.log(`GramJs sessionId: ${gramSession ? 'YES (' + gramSession.substring(0, 30) + '...)' : 'NOT FOUND'}`);
  console.log(`user_auth: ${userAuth ? 'YES' : 'NOT FOUND'}`);

  writeFileSync('splus_session.json', JSON.stringify(sessionData, null, 2));
  console.log('Full localStorage saved to splus_session.json');

  console.log(`\n${'='.repeat(60)}`);
  console.log('COPY THE LINE BELOW INTO TELEGRAM BOT:');
  console.log('='.repeat(60));
  console.log(tokenStr);
  console.log('='.repeat(60));

  await ask('\nPress Enter to close browser...');
  await browser.close();
  rl.close();
}

main().catch(e => { console.error('Error:', e.message); rl.close(); process.exit(1); });
