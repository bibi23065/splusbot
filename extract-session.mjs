// extract-session.mjs
// Targeted extraction for Soroush+ GramJs session
// Run: node extract-session.mjs

import puppeteer from 'puppeteer';
import { createInterface } from 'readline';
import { writeFileSync } from 'fs';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

async function main() {
  console.log('=== Extract Soroush+ Session ===\n');

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();
  await page.goto('https://web.splus.ir/', { waitUntil: 'networkidle2', timeout: 60000 });

  console.log('Log in to Soroush+ in the browser window.');
  await ask('Press Enter AFTER you see your chat list: ');

  console.log('\nExtracting session data...');

  const session = await page.evaluate(async () => {
    const result = {
      account1: null,
      dc2_auth_key: null,
      dc6_auth_key: null,
      dc8_auth_key: null,
      server_salt_raw: null,
      indexedDB_session: null,
      all_indexedDB: {},
    };

    // 1. Parse account1 (the main session object)
    const account1Raw = localStorage.getItem('account1');
    if (account1Raw) {
      try { result.account1 = JSON.parse(account1Raw); } catch { result.account1 = account1Raw; }
    }

    // 2. Get individual auth keys
    const dc2 = localStorage.getItem('dc2_auth_key');
    if (dc2) {
      try { result.dc2_auth_key = JSON.parse(dc2); } catch { result.dc2_auth_key = dc2; }
    }
    const dc6 = localStorage.getItem('dc6_auth_key');
    if (dc6) {
      try { result.dc6_auth_key = JSON.parse(dc6); } catch { result.dc6_auth_key = dc6; }
    }
    const dc8 = localStorage.getItem('dc8_auth_key');
    if (dc8) {
      try { result.dc8_auth_key = JSON.parse(dc8); } catch { result.dc8_auth_key = dc8; }
    }

    // 3. Get server_salt raw
    const saltRaw = localStorage.getItem('server_salt');
    if (saltRaw) result.server_salt_raw = saltRaw;

    // 4. Search IndexedDB for session state (sessionId, serverSalt, seqNo)
    const dbs = await indexedDB.databases();

    for (const dbInfo of dbs) {
      const data = await new Promise((resolve) => {
        const req = indexedDB.open(dbInfo.name, dbInfo.version);
        req.onerror = () => resolve({});
        req.onsuccess = () => {
          const db = req.result;
          const names = Array.from(db.objectStoreNames);
          const out = {};
          let pending = names.length;
          if (!pending) { db.close(); resolve(out); return; }

          for (const store of names) {
            const tx = db.transaction(store, 'readonly');
            const s = tx.objectStore(store);
            const getK = s.getAllKeys();
            const getV = s.getAll();

            Promise.all([
              new Promise(r => { getK.onsuccess = () => r(getK.result); getK.onerror = () => r([]); }),
              new Promise(r => { getV.onsuccess = () => r(getV.result); getV.onerror = () => r([]); }),
            ]).then(([keys, vals]) => {
              out[store] = {};
              for (let i = 0; i < keys.length; i++) {
                try {
                  const s2 = JSON.stringify(vals[i]);
                  if (s2.length < 200000) out[store][String(keys[i])] = vals[i];
                  else out[store][String(keys[i])] = `[${s2.length} bytes]`;
                } catch { out[store][String(keys[i])] = '[unserializable]'; }
              }
              if (--pending === 0) { db.close(); resolve(out); }
            });
          }
        };
      });

      result.all_indexedDB[dbInfo.name] = data;

      // Look for GramJs session data specifically
      for (const [storeName, entries] of Object.entries(data)) {
        for (const [key, val] of Object.entries(entries)) {
          if (val && typeof val === 'object') {
            const valStr = JSON.stringify(val);
            if (valStr.includes('sessionId') || valStr.includes('serverSalt') ||
                valStr.includes('authKey') || valStr.includes('seqNo') ||
                valStr.includes('dcId')) {
              result.indexedDB_session = val;
            }
          }
        }
      }
    }

    return session;
  });

  writeFileSync('splus_session.json', JSON.stringify(session, null, 2));

  // Print summary
  console.log('\n--- Extraction Summary ---');
  console.log(`account1: ${session.account1 ? 'FOUND' : 'missing'}`);
  if (session.account1) {
    console.log(`  dcId: ${session.account1.dcId}`);
    console.log(`  userId: ${session.account1.userId}`);
    console.log(`  firstName: ${session.account1.firstName}`);
    console.log(`  phone: ${session.account1.phone}`);
  }
  console.log(`dc2_auth_key: ${session.dc2_auth_key ? `${String(session.dc2_auth_key).length} chars` : 'missing'}`);
  console.log(`dc6_auth_key: ${session.dc6_auth_key ? `${String(session.dc6_auth_key).length} chars` : 'missing'}`);
  console.log(`dc8_auth_key: ${session.dc8_auth_key ? `${String(session.dc8_auth_key).length} chars` : 'missing'}`);
  console.log(`server_salt_raw: ${session.server_salt_raw ? session.server_salt_raw.slice(0, 50) : 'missing'}`);
  console.log(`IndexedDB session (with sessionId/serverSalt): ${session.indexedDB_session ? 'FOUND' : 'NOT FOUND'}`);

  const idbDbs = Object.keys(session.all_indexedDB);
  const idbEntries = idbDbs.reduce((sum, db) => {
    return sum + Object.values(session.all_indexedDB[db]).reduce((s, store) => s + Object.keys(store).length, 0);
  }, 0);
  console.log(`IndexedDB: ${idbDbs.length} databases, ${idbEntries} entries`);
  for (const db of idbDbs) {
    const stores = Object.keys(session.all_indexedDB[db]);
    console.log(`  ${db}: [${stores.join(', ')}]`);
  }

  console.log(`\nSaved to splus_session.json (${JSON.stringify(session).length} bytes)`);
  console.log('\nPaste the contents of splus_session.json into the Telegram bot.');

  await browser.close();
  rl.close();
}

main().catch(e => {
  console.error('Error:', e.message);
  rl.close();
  process.exit(1);
});
