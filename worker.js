// SplusBot v4 — Single-file Cloudflare Worker
// Paste this into the Cloudflare Workers online editor

// ============================================================
// MTProto Core
// ============================================================

const IVE_ZERO = new Uint8Array(32);

function hexToBytes(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function concatBytes(...arrays) {
  const total = arrays.reduce((a, b) => a + b.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function readInt32BE(data, offset) {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

function writeInt32BE(value) {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function writeInt64BE(value) {
  return new Uint8Array(8).map((_, i) => Number((value >> BigInt(i * 8)) & BigInt(0xff)));
}

async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

async function aesEncryptIge(key, data) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt']);
  const blockCount = Math.ceil(data.length / 16);
  const padded = new Uint8Array(blockCount * 16);
  padded.set(data);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: IVE_ZERO.slice(0, 16) },
    cryptoKey,
    padded,
  ));
  return encrypted.slice(0, data.length);
}

async function aesDecryptIge(key, data) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['decrypt']);
  const blockCount = Math.ceil(data.length / 16);
  const padded = new Uint8Array(blockCount * 16);
  padded.set(data);
  const decrypted = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: IVE_ZERO.slice(0, 16) },
    cryptoKey,
    padded,
  ));
  return decrypted.slice(0, data.length);
}

function serializeString(str) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  const len = bytes.length;
  if (len < 254) {
    const pad = (4 - ((1 + len) % 4)) % 4;
    const buf = new Uint8Array(1 + len + pad);
    buf[0] = len;
    buf.set(bytes, 1);
    return buf;
  }
  const pad = (4 - (len % 4)) % 4;
  const buf = new Uint8Array(4 + len + pad);
  buf[0] = 254;
  buf[1] = len & 0xff;
  buf[2] = (len >> 8) & 0xff;
  buf[3] = (len >> 16) & 0xff;
  buf.set(bytes, 4);
  return buf;
}

function deserializeString(data, offset) {
  const first = data[offset];
  if (first < 254) {
    const len = first;
    const text = new TextDecoder().decode(data.subarray(offset + 1, offset + 1 + len));
    const total = 1 + len + ((4 - ((1 + len) % 4)) % 4);
    return { value: text, bytesRead: total };
  }
  const len = data[offset + 1] | (data[offset + 2] << 8) | (data[offset + 3] << 16);
  const text = new TextDecoder().decode(data.subarray(offset + 4, offset + 4 + len));
  const total = 4 + len + ((4 - (len % 4)) % 4);
  return { value: text, bytesRead: total };
}

function pad16(data) {
  const remainder = data.length % 16;
  if (remainder === 0) return data;
  const pad = 16 - remainder;
  const padded = new Uint8Array(data.length + pad);
  padded.set(data);
  for (let i = data.length; i < padded.length; i++) {
    padded[i] = Math.floor(Math.random() * 256);
  }
  return padded;
}

async function computeMsgKey(authKey, plaintext, isClient) {
  const x = isClient ? 0 : 8;
  const substr = authKey.subarray(88 + x, 88 + x + 32);
  const dataWithKey = concatBytes(substr, plaintext);
  const sha = await sha256(dataWithKey);
  return sha.subarray(8, 24);
}

async function computeAesKeyIve(authKey, msgKey, isClient) {
  const x = isClient ? 0 : 8;
  const sha256a = await sha256(concatBytes(msgKey, authKey.subarray(x, x + 36)));
  const sha256b = await sha256(concatBytes(authKey.subarray(40 + x, 40 + x + 36), msgKey));
  const key = concatBytes(
    sha256a.subarray(0, 8),
    sha256b.subarray(8, 24),
    sha256a.subarray(24, 32),
  );
  const ive = concatBytes(
    sha256b.subarray(0, 8),
    sha256a.subarray(8, 24),
    sha256b.subarray(24, 32),
  );
  return { key, ive };
}

const TL = {
  invokeWithLayer: 0xda9b0d0d,
  initConnection: 0xc1f51339,
  helpGetConfig: 0x4a35253f,
  messagesGetDialogs: 0x1f2b0698,
  messagesGetHistory: 0x452c0c64,
  messagesReadHistory: 0x0b086f7c,
  inputPeerEmpty: 0x7f3b18ea,
  inputPeerChat: 0x35a95c9f,
  inputPeerUser: 0xdde11d8c,
  inputPeerChannel: 0x8b7307cd,
  peerUser: 0x9db1bc6d,
  peerChat: 0xb8d1262b,
  peerChannel: 0xbddde532,
  dialog: 0xe4def5db,
  message: 0x452c0c64,
  messageService: 0x9e19a196,
  rpcResult: 0xf35c6d01,
  rpcError: 0xedab447b,
  gzipPacked: 0x3072cfa1,
  boolTrue: 0x997275b5,
  boolFalse: 0xbc799737,
  layer167: 167,
};

class MtprotoClient {
  constructor(session, config) {
    this.session = session;
    this.config = config || { endpoint: 'wss://im-server.splus.ir/apiws' };
    this.authKeyBytes = hexToBytes(session.authKey);
    this.authKeyIdBytes = new Uint8Array(8);
    this.msgSeqNo = session.seqNo || 0;
    this.pendingResolvers = new Map();
    this.ws = null;
    this.requestId = 0;
  }

// ============================================================
// WebSocket via cloudflare:sockets (sends Origin header)
// ============================================================

import { connect } from 'cloudflare:sockets';

function generateWsKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function maskPayload(payload) {
  const mask = new Uint8Array(4);
  crypto.getRandomValues(mask);
  const masked = new Uint8Array(payload.length);
  for (let i = 0; i < payload.length; i++) {
    masked[i] = payload[i] ^ mask[i % 4];
  }
  return { masked, mask };
}

function buildWsFrame(opcode, payload) {
  let headerLen = 2;
  if (payload.length >= 65536) headerLen = 10;
  else if (payload.length >= 126) headerLen = 4;

  const header = new Uint8Array(headerLen);
  header[0] = 0x80 | opcode;

  const mask = new Uint8Array(4);
  crypto.getRandomValues(mask);

  if (payload.length < 126) {
    header[1] = 0x80 | payload.length;
  } else if (payload.length < 65536) {
    header[1] = 0x80 | 126;
    header[2] = (payload.length >> 8) & 0xff;
    header[3] = payload.length & 0xff;
  } else {
    header[1] = 0x80 | 127;
    for (let i = 0; i < 8; i++) {
      header[2 + i] = (payload.length >> (56 - i * 8)) & 0xff;
    }
  }

  const fullFrame = new Uint8Array(headerLen + 4 + payload.length);
  fullFrame.set(header);
  fullFrame.set(mask, headerLen);
  for (let i = 0; i < payload.length; i++) {
    fullFrame[headerLen + 4 + i] = payload[i] ^ mask[i % 4];
  }
  return fullFrame;
}

async function connectWebSocket(url) {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const path = parsed.pathname || '/';
  const key = generateWsKey();

  const socket = connect({ hostname: host, port: 443, secureTransport: 'on' });

  const writer = socket.writable.getWriter();
  const upgradeRequest = [
    `GET ${path} HTTP/1.1`,
    `Host: ${host}`,
    `Upgrade: websocket`,
    `Connection: Upgrade`,
    `Sec-WebSocket-Key: ${key}`,
    `Sec-WebSocket-Version: 13`,
    `Origin: https://web.splus.ir`,
    `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`,
    '', '',
  ].join('\r\n');

  await writer.write(new TextEncoder().encode(upgradeRequest));

  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (!buf.includes('\r\n\r\n')) {
    const { value, done } = await reader.read();
    if (done) throw new Error('Socket closed during handshake');
    buf += decoder.decode(value, { stream: true });
  }

  if (!buf.includes('101')) {
    throw new Error(`Handshake failed: ${buf.split('\r\n')[0]}`);
  }

  return { reader, writer };
}
    }
  }

  async callApi(method, params) {
    params = params || {};
    const methodId = writeInt32BE(TL[method] || parseInt(method, 16));
    const paramData = this.serializeParams(params);
    const data = concatBytes(methodId, ...paramData);

    const sessionId = hexToBytes(this.session.sessionId);
    const serverSalt = hexToBytes(this.session.serverSalt);
    const msgId = writeInt64BE(BigInt(Date.now()) * BigInt(4096) + BigInt(Math.floor(Math.random() * 4096)));
    const seqNo = writeInt32BE(this.msgSeqNo++);
    const bodyLen = writeInt32BE(data.length);

    const plainMessage = concatBytes(serverSalt, sessionId, msgId, seqNo, bodyLen, data);
    const msgKey = await computeMsgKey(this.authKeyBytes, plainMessage, true);
    const { key: aesKey } = await computeAesKeyIve(this.authKeyBytes, msgKey, true);
    const paddedPlain = pad16(plainMessage);
    const encrypted = await aesEncryptIge(aesKey, paddedPlain);

    const envelope = concatBytes(this.authKeyIdBytes, msgKey, encrypted);
    const lengthPrefix = writeInt32BE(envelope.length + 4);
    const fullMessage = concatBytes(lengthPrefix, envelope);

    return new Promise((resolve, reject) => {
      const id = `req_${++this.requestId}`;
      const timer = setTimeout(() => {
        this.pendingResolvers.delete(id);
        reject(new Error(`Timeout waiting for response to ${method}`));
      }, 30000);

      this.pendingResolvers.set(id, { resolve, reject, timer });
      this.ws.send(fullMessage.buffer);
    });
  }

  async handleMessage(rawData) {
    try {
      const data = rawData.slice(4);
      if (data.length < 24) return;

      const msgKey = data.subarray(8, 24);
      const encrypted = data.subarray(24);

      const { key: aesKey } = await computeAesKeyIve(this.authKeyBytes, msgKey, false);
      const decrypted = await aesDecryptIge(aesKey, encrypted);

      const bodyLen = readInt32BE(decrypted, 28);
      const body = decrypted.subarray(32, 32 + bodyLen);
      const constructorId = readInt32BE(body, 0);

      if (constructorId === TL.rpcResult) {
        const innerBody = body.subarray(16);
        for (const [id, pending] of this.pendingResolvers) {
          clearTimeout(pending.timer);
          pending.resolve(this.parseResponse(innerBody));
          this.pendingResolvers.delete(id);
          break;
        }
      } else if (constructorId === TL.rpcError) {
        const code = readInt32BE(body, 4);
        const msg = deserializeString(body, 8);
        for (const [id, pending] of this.pendingResolvers) {
          clearTimeout(pending.timer);
          pending.reject(new Error(`RPC Error ${code}: ${msg.value}`));
          this.pendingResolvers.delete(id);
          break;
        }
      }
    } catch (e) {
      console.error('MTProto message parse error:', e);
    }
  }

  parseResponse(data) {
    const constructorId = readInt32BE(data, 0);
    if (constructorId === TL.gzipPacked) return { gzipPacked: true, raw: data };
    if (constructorId === TL.boolTrue) return true;
    if (constructorId === TL.boolFalse) return false;
    return { constructorId: constructorId.toString(16), raw: bytesToHex(data) };
  }

  serializeParams(params) {
    const parts = [];
    for (const [, value] of Object.entries(params)) {
      if (typeof value === 'number') {
        parts.push(writeInt32BE(value));
      } else if (typeof value === 'bigint') {
        parts.push(writeInt64BE(value));
      } else if (typeof value === 'string') {
        parts.push(serializeString(value));
      } else if (value && typeof value === 'object') {
        if (value._ === 'inputPeerEmpty') {
          parts.push(writeInt32BE(TL.inputPeerEmpty));
        } else if (value._ === 'inputPeerUser') {
          parts.push(writeInt32BE(TL.inputPeerUser));
          parts.push(writeInt32BE(value.user_id));
          parts.push(writeInt64BE(BigInt(0)));
        } else if (value._ === 'inputPeerChat') {
          parts.push(writeInt32BE(TL.inputPeerChat));
          parts.push(writeInt32BE(value.chat_id));
        } else if (value._ === 'inputPeerChannel') {
          parts.push(writeInt32BE(TL.inputPeerChannel));
          parts.push(writeInt32BE(value.channel_id));
          parts.push(writeInt64BE(BigInt(0)));
        }
      }
    }
    return parts;
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// ============================================================
// Telegram Helpers
// ============================================================

const TELEGRAM_API = 'https://api.telegram.org';

async function sendMsg(chatId, text, replyMarkup, botToken, parseMode) {
  if (!botToken) return;
  const body = { chat_id: chatId, text };
  if (replyMarkup) body.reply_markup = JSON.stringify(replyMarkup);
  if (parseMode) body.parse_mode = parseMode;
  await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function answerCallback(callbackQueryId, botToken) {
  if (!botToken) return;
  await fetch(`${TELEGRAM_API}/bot${botToken}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================================
// Deduplication
// ============================================================

function generateMessageKey(chatId, text, timestamp) {
  return `${chatId}:${text}:${timestamp}`;
}

async function hashString(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function isDuplicate(kv, chatId, text, timestamp) {
  const key = generateMessageKey(chatId, text, timestamp);
  const hash = await hashString(key);
  const kvKey = `splusbot:seen:${hash}`;
  const existing = await kv.get(kvKey);
  return existing !== null;
}

async function markAsSeen(kv, chatId, text, timestamp) {
  const key = generateMessageKey(chatId, text, timestamp);
  const hash = await hashString(key);
  const kvKey = `splusbot:seen:${hash}`;
  await kv.put(kvKey, '1', { expirationTtl: 604800 });
}

// ============================================================
// Soroush API Client
// ============================================================

function parseSession(data) {
  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new Error('Session data must be valid JSON');
  }

  if (parsed.GramJs && parsed.GramJs.authKey && parsed.GramJs.sessionId) {
    return {
      authKey: parsed.GramJs.authKey,
      authKeyId: parsed.GramJs.authKeyId || '',
      sessionId: parsed.GramJs.sessionId,
      serverSalt: parsed.GramJs.serverSalt || '0'.repeat(16),
      seqNo: parsed.GramJs.seqNo || 0,
      dcId: parsed.GramJs.dcId || 2,
    };
  }

  const account1 = parsed.account1 || null;
  const dc2Key = typeof parsed.dc2_auth_key === 'string'
    ? parsed.dc2_auth_key
    : (account1 && account1.dc2_auth_key) || '';
  const dcId = (account1 && account1.dcId) || parsed.dcId || 2;

  if (!dc2Key) {
    throw new Error('Missing dc2_auth_key. Expected account1.dc2_key or dc2_auth_key in session data.');
  }

  const sessionId = (parsed.indexedDB_session && parsed.indexedDB_session.sessionId) ||
                    parsed.sessionId ||
                    generateRandomHex(16);

  const serverSalt = (parsed.indexedDB_session && parsed.indexedDB_session.serverSalt) ||
                     parsed.serverSalt ||
                     '0'.repeat(16);

  const seqNo = (parsed.indexedDB_session && parsed.indexedDB_session.seqNo) ||
                parsed.seqNo ||
                0;

  return {
    authKey: dc2Key,
    authKeyId: '',
    sessionId: sessionId,
    serverSalt: typeof serverSalt === 'object' ? '0'.repeat(16) : serverSalt,
    seqNo: typeof seqNo === 'number' ? seqNo : 0,
    dcId: typeof dcId === 'number' ? dcId : 2,
  };
}

function generateRandomHex(length) {
  const bytes = new Uint8Array(length / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function fetchUnreadMessages(sessionData) {
  let session;
  try {
    session = parseSession(sessionData);
  } catch (e) {
    throw new Error(`Invalid session data: ${e.message}`);
  }

  const client = new MtprotoClient(session, {
    endpoint: 'wss://im-server.splus.ir/apiws',
  });

  try {
    await client.connect();

    const dialogsResult = await client.callApi('messages.getDialogs', {
      limit: 50,
      offset_id: 0,
      offset_date: 0,
      offset_peer: { _: 'inputPeerEmpty' },
      hash: BigInt(0),
    });

    const unreadDialogs = (dialogsResult && dialogsResult.dialogs || [])
      .filter((d) => d.unreadCount > 0);

    const messages = [];

    for (const dialog of unreadDialogs) {
      const peer = dialog.peer;
      const peerType = peer.channel_id ? 'channel' :
                       peer.chat_id ? 'chat' :
                       peer.user_id ? 'user' : 'unknown';
      const peerId = peer.channel_id || peer.chat_id || peer.user_id || 0;

      const historyResult = await client.callApi('messages.getHistory', {
        peer: {
          _: peerType === 'channel' ? 'inputPeerChannel' :
              peerType === 'chat' ? 'inputPeerChat' :
              'inputPeerUser',
          channel_id: peer.channel_id,
          chat_id: peer.chat_id,
          user_id: peer.user_id,
        },
        limit: Math.min(dialog.unreadCount, 10),
        offset_id: 0,
        offset_date: 0,
        add_offset: 0,
        hash: BigInt(0),
      });

      for (const msg of (historyResult && historyResult.messages || [])) {
        if (msg.out) continue;

        messages.push({
          messageId: msg.id,
          chatId: peerId,
          chatTitle: peerType === 'user' ? `User ${peerId}` :
                     peerType === 'chat' ? `Chat ${peerId}` :
                     `Channel ${peerId}`,
          senderName: peerType === 'user' ? `User ${(msg.fromId && msg.fromId.user_id) || peerId}` : 'Unknown',
          text: msg.text || '',
          timestamp: msg.date,
        });
      }
    }

    return messages;
  } finally {
    client.disconnect();
  }
}

// ============================================================
// Main Worker Handler
// ============================================================

async function getState(kv, chatId) {
  const data = await kv.get(`splusbot:state:${chatId}`, 'json');
  return data || { state: 'UNAUTHENTICATED' };
}

async function setState(kv, chatId, state) {
  await kv.put(`splusbot:state:${chatId}`, JSON.stringify(state));
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'GET') return new Response('SplusBot v4', { status: 200 });

    try {
      const update = await request.json();
      const chatId = (update.message && update.message.chat && update.message.chat.id) ||
                     (update.callback_query && update.callback_query.message && update.callback_query.message.chat && update.callback_query.message.chat.id);
      const text = (update.message && update.message.text) || (update.callback_query && update.callback_query.data) || '';
      const callbackQueryId = update.callback_query && update.callback_query.id;

      if (!chatId || !env.KV) return new Response('ok', { status: 200 });
      if (callbackQueryId) await answerCallback(callbackQueryId, env.TELEGRAM_BOT_TOKEN);

      const state = await getState(env.KV, chatId);
      const botToken = env.TELEGRAM_BOT_TOKEN;

      switch (state.state) {
        case 'UNAUTHENTICATED': {
          if (text === '/start') {
            const kb = { inline_keyboard: [[{ text: 'Login to Soroush+', callback_data: 'login_splus' }]] };
            await sendMsg(chatId, 'Welcome! Click below to login.', kb, botToken);
          } else if (text === 'login_splus') {
            await setState(env.KV, chatId, { state: 'AWAITING_TOKEN' });
            const instructions = [
              'To get your Soroush+ session:',
              '',
              '1. Open web.splus.ir and log in',
              '2. Press F12 \u2192 Console',
              '3. Paste this snippet:',
              '',
              '(async()=>{const s={};const a1=localStorage.getItem("account1");if(a1)try{s.account1=JSON.parse(a1)}catch{};["dc2_auth_key","dc6_auth_key","dc8_auth_key"].forEach(k=>{const v=localStorage.getItem(k);if(v)try{s[k]=JSON.parse(v)}catch{s[k]=v}});console.log(JSON.stringify(s))})()',
              '',
              '4. Copy the output and paste it below:',
            ].join('\n');
            await sendMsg(chatId, instructions, undefined, botToken);
          }
          break;
        }

        case 'AWAITING_TOKEN': {
          if (text && text.length > 20 && !text.startsWith('/')) {
            try {
              JSON.parse(text);
            } catch {
              await sendMsg(chatId, 'Invalid JSON. Paste the full session data.', undefined, botToken);
              break;
            }

            const kb = { inline_keyboard: [[{ text: 'Check Messages', callback_data: 'check_now' }]] };

            try {
              await fetchUnreadMessages(text);

              await env.KV.put(`splusbot:session:${chatId}`, text);
              await setState(env.KV, chatId, { state: 'AUTHENTICATED' });
              await sendMsg(chatId, 'Session validated! Click below to check unread messages.', kb, botToken);
            } catch (e) {
              const msg = e.message || 'Unknown error';
              if (msg.includes('Invalid session')) {
                await sendMsg(chatId, `Session error: ${msg}\n\nPlease re-extract the session.`, undefined, botToken);
              } else {
                await env.KV.put(`splusbot:session:${chatId}`, text);
                await setState(env.KV, chatId, { state: 'AUTHENTICATED' });
                await sendMsg(chatId, 'Session stored (connection will be tested on first check).', kb, botToken);
              }
            }
          } else {
            await sendMsg(chatId, 'Invalid token. Paste the full session JSON.', undefined, botToken);
          }
          break;
        }

        case 'AUTHENTICATED': {
          if (text === 'check_now' || text === '/fetch') {
            const session = await env.KV.get(`splusbot:session:${chatId}`);
            if (!session) {
              await setState(env.KV, chatId, { state: 'UNAUTHENTICATED' });
              await sendMsg(chatId, 'Session expired. Send /start to re-login.', undefined, botToken);
              break;
            }

            await sendMsg(chatId, 'Checking for unread messages...', undefined, botToken);

            try {
              const messages = await fetchUnreadMessages(session);

              if (messages.length === 0) {
                await sendMsg(chatId, 'No unread messages.', undefined, botToken);
                break;
              }

              const newMessages = [];
              for (const msg of messages) {
                if (!await isDuplicate(env.KV, msg.chatId, msg.text, msg.timestamp)) {
                  await markAsSeen(env.KV, msg.chatId, msg.text, msg.timestamp);
                  newMessages.push(msg);
                }
              }

              if (newMessages.length === 0) {
                await sendMsg(chatId, 'No new unread messages (all previously seen).', undefined, botToken);
                break;
              }

              const grouped = {};
              for (const m of newMessages) {
                if (!grouped[m.chatTitle]) grouped[m.chatTitle] = [];
                grouped[m.chatTitle].push(m);
              }

              for (const [chatTitle, msgs] of Object.entries(grouped)) {
                let msgText = `*${escapeHtml(chatTitle)}* (${msgs.length} new)\n\n`;
                for (const m of msgs.slice(0, 10)) {
                  msgText += `${escapeHtml(m.senderName)}: ${escapeHtml(m.text.slice(0, 200))}\n`;
                }
                if (msgs.length > 10) msgText += `\n... and ${msgs.length - 10} more`;
                await sendMsg(chatId, msgText, undefined, botToken, 'Markdown');
              }

              const kb = { inline_keyboard: [[{ text: 'Check Again', callback_data: 'check_now' }]] };
              await sendMsg(chatId, `Done! ${newMessages.length} new messages forwarded.`, kb, botToken);

            } catch (e) {
              const msg = e.message || 'Unknown error';
              if (msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized') || msg.includes('auth')) {
                await setState(env.KV, chatId, { state: 'UNAUTHENTICATED' });
                await env.KV.delete(`splusbot:session:${chatId}`);
                await sendMsg(chatId, 'Session expired! Send /start to re-login.', undefined, botToken);
              } else {
                await sendMsg(chatId, `Error: ${msg}`, undefined, botToken);
              }
            }
          } else if (text === '/logout') {
            await env.KV.delete(`splusbot:session:${chatId}`);
            await setState(env.KV, chatId, { state: 'UNAUTHENTICATED' });
            await sendMsg(chatId, 'Logged out. Send /start to login again.', undefined, botToken);
          }
          break;
        }
      }

      return new Response('ok', { status: 200 });
    } catch (e) {
      return new Response('ok', { status: 200 });
    }
  },
};
