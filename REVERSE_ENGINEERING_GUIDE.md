# Soroush Web Reverse Engineering Guide

## CRITICAL DISCOVERY: Soroush Uses GramJs/MTProto

The localStorage key `GramJs:apiCache` confirms Soroush is built on GramJs, the open-source MTProto client library. All communication goes through a single WebSocket at `wss://im-server.splus.ir/apiws` using binary-encrypted MTProto protocol.

## What's Implemented

The Cloudflare Worker now includes a minimal MTProto client (`src/mtproto.ts`) that handles:
- AES-IGE encryption/decryption using Web Crypto API
- TL binary serialization for request/response encoding
- WebSocket connection management
- Message framing with proper auth_key, server_salt, and session_id

## Session Extraction (What You Need to Do)

Soroush stores MTProto auth data in **IndexedDB** (not just localStorage). Run `extract-session.mjs` to pull everything:

```bash
node extract-session.mjs
```

This opens a browser, you log in, and it extracts:
- All localStorage keys (including `GramJs:apiCache`)
- All IndexedDB databases and object stores (this is where auth_key, session_id, server_salt live)

### Manual Extraction (if script doesn't work)

1. Open `web.splus.ir` and log in
2. Open DevTools → Application → IndexedDB
3. Look for databases with names containing `GramJs`, `mtproto`, or `soroush`
4. Inside, find object stores that contain:
   - `authKey` or `auth_key` (256-byte hex string, 512 hex chars)
   - `sessionId` or `session_id` (8-byte hex string, 16 hex chars)
   - `serverSalt` or `server_salt` (8-byte hex string, 16 hex chars)
   - `dcId` or `dc_id` (number, usually 2 or 4)

5. In DevTools Console, run:
```js
// Get all IndexedDB data
const dbs = await indexedDB.databases();
for (const db of dbs) {
  const req = indexedDB.open(db.name, db.version);
  req.onsuccess = () => {
    const stores = Array.from(req.result.objectStoreNames);
    stores.forEach(store => {
      const tx = req.result.transaction(store, 'readonly');
      tx.objectStore(store).getAll().onsuccess = (e) => {
        console.log(`${db.name}.${store}:`, e.target.result);
      };
    });
  };
}
```

6. Create a JSON with this structure:
```json
{
  "GramJs": {
    "sessionId": "hex_string_16_chars",
    "authKey": "hex_string_512_chars",
    "serverSalt": "hex_string_16_chars",
    "seqNo": 0,
    "dcId": 2
  }
}
```

7. Paste this JSON into the Telegram bot when it asks for the session token

## How the Worker Uses the Session

When you paste the session JSON:

1. `src/soroush.ts` parses it into a `MtprotoSession` object
2. `src/mtproto.ts` connects to `wss://im-server.splus.ir/apiws`
3. The client encrypts requests using AES-IGE with your auth_key
4. It sends `messages.getDialogs` to get the chat list
5. For each unread chat, it sends `messages.getHistory` to get messages
6. Results are formatted and sent to your Telegram chat

## TL Constructor IDs (for debugging)

These are the Telegram TL constructor IDs used by the client:

| Method | Constructor ID |
|--------|---------------|
| invokeWithLayer | 0xda9b0d0d |
| initConnection | 0xc1f51339 |
| help.getConfig | 0x4a35253f |
| messages.getDialogs | 0x1f2b0698 |
| messages.getHistory | 0x452c0c64 |
| messages.readHistory | 0x0b086f7c |

## Troubleshooting

**Connection fails**: The auth_key may be invalid or expired. Re-extract from IndexedDB.

**RPC Error 401**: Session is not authorized. The extracted session may be incomplete.

**Empty dialogs**: Soroush may use different constructor IDs than standard Telegram. Capture the raw WebSocket frames in DevTools (Network → WS → Messages) and share the hex data.

**WebSocket won't connect**: Cloudflare Workers use a different WebSocket API than browsers. If `new WebSocket()` fails in the Worker, we may need to use the `connect()` API from `cloudflare:sockets`.
