import https from 'https';
import nacl from 'tweetnacl';

const TOKEN = process.argv[2];
const REPO = 'bibi23065/splusbot';
const KEY_ID = '3380204578043523366';
const PUBLIC_KEY_B64 = 'm08fHXADH5BH/pkLYF2Y/6Ols0PYJbBE4fUhqrPwNgQ=';

const secrets = {
  'TELEGRAM_BOT_TOKEN': '8960541207:AAEyAriLq0tWOMZjFEMSL6plhoywCql5TRg',
  'TELEGRAM_CHAT_ID': '628824680',
};

function encrypt(publicKeyB64, secretValue) {
  const publicKey = Uint8Array.from(atob(publicKeyB64), c => c.charCodeAt(0));
  const messageBytes = new TextEncoder().encode(secretValue);
  const nonce = nacl.randomBytes(24);
  const ephemeralKeyPair = nacl.box.keyPair();
  const encrypted = nacl.box(messageBytes, nonce, publicKey, ephemeralKeyPair.secretKey);
  const result = new Uint8Array(32 + 24 + encrypted.length);
  result.set(ephemeralKeyPair.publicKey, 0);
  result.set(nonce, 32);
  result.set(encrypted, 56);
  return btoa(String.fromCharCode(...result));
}

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `token ${TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'splusbot-setup',
      },
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(buf || '{}'));
        else reject(new Error(`${res.statusCode}: ${buf}`));
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  for (const [name, value] of Object.entries(secrets)) {
    try {
      const encrypted = encrypt(PUBLIC_KEY_B64, value);
      await api('PUT', `/repos/${REPO}/actions/secrets/${name}`, {
        encrypted_value: encrypted,
        key_id: KEY_ID,
      });
      console.log(`${name} = OK`);
    } catch (e) {
      console.log(`${name} = ${e.message}`);
    }
  }
}

main();
