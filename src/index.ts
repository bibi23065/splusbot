import type { Env } from './types';

const BOT_TOKEN = '8960541207:AAEyAriLq0tWOMZjFEMSL6plhoywCql5TRg';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function sendMsg(chatId: number, text: string, replyMarkup?: any): Promise<any> {
  const body: any = { chat_id: chatId, text };
  if (replyMarkup) body.reply_markup = JSON.stringify(replyMarkup);
  const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return resp.json();
}

async function answerCallback(callbackQueryId: string): Promise<void> {
  await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
}

async function getState(kv: KVNamespace, chatId: number): Promise<any> {
  const data = await kv.get(`splusbot:state:${chatId}`, 'json');
  return data ?? { state: 'UNAUTHENTICATED' };
}

async function setState(kv: KVNamespace, chatId: number, state: any): Promise<void> {
  await kv.put(`splusbot:state:${chatId}`, JSON.stringify(state));
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('en-CA', { timeZone: 'Asia/Tehran' }).replace(',', '');
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'GET') return new Response('Splus Bot v2', { status: 200 });

    try {
      const update = await request.json() as any;
      const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
      const text = update.message?.text || update.callback_query?.data || '';
      const callbackQueryId = update.callback_query?.id;

      if (!chatId || !env.KV) return new Response('ok', { status: 200 });

      if (callbackQueryId) await answerCallback(callbackQueryId);

      const state = await getState(env.KV, chatId);

      switch (state.state) {
        case 'UNAUTHENTICATED': {
          if (text === '/start') {
            const kb = { inline_keyboard: [[{ text: 'Login to Soroush+', callback_data: 'login_splus' }]] };
            await sendMsg(chatId, 'Welcome! To login, run the auth script locally:\n\n<code>python auth.py</code>\n\nGet the token and paste it here.', kb);
          } else if (text === 'login_splus') {
            await setState(env.KV, chatId, { state: 'AWAITING_JWT' });
            await sendMsg(chatId, 'Run <code>python auth.py</code> on your computer.\nThen paste the session token here:');
          }
          break;
        }
        case 'AWAITING_JWT': {
          if (text && text.length > 20 && !text.startsWith('/')) {
            try {
              const parsed = JSON.parse(text);
              await env.KV.put(`splusbot:token:${chatId}`, JSON.stringify(parsed));
            } catch {
              await env.KV.put(`splusbot:token:${chatId}`, text.trim());
            }
            await setState(env.KV, chatId, { state: 'AUTHENTICATED' });
            const kb = { inline_keyboard: [[{ text: 'Fetch Unread Messages', callback_data: 'fetch_unread' }]] };
            await sendMsg(chatId, 'Authenticated! Click below to fetch unread messages.', kb);
          } else {
            await sendMsg(chatId, 'Invalid token. Please paste the full session data from <code>auth.py</code>.');
          }
          break;
        }
        case 'AUTHENTICATED': {
          if (text === 'fetch_unread' || text === '/fetch') {
            const tokenData = await env.KV.get(`splusbot:token:${chatId}`);
            if (!tokenData) {
              await sendMsg(chatId, 'Session expired. Send /start to login again.');
              await setState(env.KV, chatId, { state: 'UNAUTHENTICATED' });
              return new Response('ok', { status: 200 });
            }
            try {
              await sendMsg(chatId, 'Fetching chats...');
              const dialogs = await loadDialogs(tokenData);
              const unread = dialogs.filter((d: any) => d.unreadCount > 0);
              if (unread.length === 0) {
                const kb = { inline_keyboard: [[{ text: 'Fetch Again', callback_data: 'fetch_unread' }]] };
                await sendMsg(chatId, 'No unread messages.', kb);
              } else {
                await env.KV.put(`splusbot:dialogs:${chatId}`, JSON.stringify(unread));
                const buttons = unread.slice(0, 8).map((d: any, i: number) => [{ text: `${d.title} (${d.unreadCount})`, callback_data: `chat_${i}` }]);
                buttons.push([{ text: 'Refresh', callback_data: 'fetch_unread' }]);
                const kb = { inline_keyboard: buttons };
                await sendMsg(chatId, `Found ${unread.length} chats with unread messages. Tap to view:`, kb);
              }
            } catch (e: any) {
              await sendMsg(chatId, `Error: ${e.message}\n\nIf fetching fails, the Soroush+ API may need MTProto (not supported from Workers). Use the Puppeteer script locally: <code>npm start</code>`);
            }
          } else if (text.startsWith('chat_') && text !== 'chat_page_2') {
            const tokenData = await env.KV.get(`splusbot:token:${chatId}`);
            const dialogsJson = await env.KV.get(`splusbot:dialogs:${chatId}`);
            if (!tokenData || !dialogsJson) {
              await sendMsg(chatId, 'Session expired. Send /start to login again.');
              return new Response('ok', { status: 200 });
            }
            const idx = parseInt(text.replace('chat_', ''), 10);
            const dialogs = JSON.parse(dialogsJson);
            const dialog = dialogs[idx];
            if (!dialog) {
              await sendMsg(chatId, 'Chat not found.');
              return new Response('ok', { status: 200 });
            }
            try {
              await sendMsg(chatId, `Fetching messages from <b>${escapeHtml(dialog.title || 'Chat ' + dialog.peerId)}</b>...`);
              const messages = await loadHistory(tokenData, dialog.peerId, dialog.peerType, Math.min(dialog.unreadCount, 20));
              if (messages.length === 0) {
                await sendMsg(chatId, 'No messages found.');
              } else {
                let msg = `<b>${escapeHtml(dialog.title || 'Chat ' + dialog.peerId)}</b> (${dialog.unreadCount} unread)\n━━━━━━━━━━━━\n`;
                for (const m of messages) {
                  const time = formatTime(m.date);
                  msg += `\n<b>${escapeHtml(m.senderName)}</b> ${time}\n${m.text ? escapeHtml(m.text) : '[Media]'}\n`;
                }
                await sendMsg(chatId, msg);
              }
              const kb = { inline_keyboard: [[{ text: 'Back to chats', callback_data: 'fetch_unread' }]] };
              await sendMsg(chatId, 'Done.', kb);
            } catch (e: any) {
              await sendMsg(chatId, `Error: ${e.message}`);
            }
          } else if (text === '/logout') {
            await env.KV.delete(`splusbot:token:${chatId}`);
            await env.KV.delete(`splusbot:dialogs:${chatId}`);
            await setState(env.KV, chatId, { state: 'UNAUTHENTICATED' });
            await sendMsg(chatId, 'Logged out. Send /start to login again.');
          }
          break;
        }
      }

      return new Response('ok', { status: 200 });
    } catch (e: any) {
      return new Response('ok', { status: 200 });
    }
  },
};

async function loadDialogs(tokenData: string): Promise<any[]> {
  let sessionData: any;
  try { sessionData = JSON.parse(tokenData); } catch { sessionData = { token: tokenData }; }

  const token = sessionData.token || tokenData;
  const base = 'https://wslb2.soroush-hamrah.ir';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
    'Authorization': `Bearer ${token}`,
    'X-Access-Token': token,
  };

  const resp = await fetch(`${base}/CAPI/Conversation/List/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ Offset: 0, Limit: 50 }),
  });

  if (!resp.ok) throw new Error(`API returned ${resp.status}`);

  const data: any = await resp.json();
  const items = data.Conversations || data.conversations || data.Result || data.result || [];
  return items.map((item: any) => ({
    peerId: item.Id || item.id || item.ChatId || 0,
    peerType: item.Type === '1' || item.Type === 'group' ? 2 : 1,
    title: item.Name || item.name || item.Title || item.DisplayName || 'Unknown',
    unreadCount: item.UnreadCount || item.unreadCount || item.Badge || 0,
    lastMessageDate: item.LastMessageTime || item.Timestamp || 0,
  }));
}

async function loadHistory(tokenData: string, peerId: number, peerType: number, limit: number): Promise<any[]> {
  let sessionData: any;
  try { sessionData = JSON.parse(tokenData); } catch { sessionData = { token: tokenData }; }

  const token = sessionData.token || tokenData;
  const base = 'https://wslb2.soroush-hamrah.ir';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
    'Authorization': `Bearer ${token}`,
    'X-Access-Token': token,
  };

  const path = peerType === 2 ? '/CAPI/Groupchat/WindowArchive/' : '/CAPI/Userchat/WindowArchive/';
  const resp = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ChatId: peerId, Offset: 0, Limit: limit }),
  });

  if (!resp.ok) throw new Error(`API returned ${resp.status}`);

  const data: any = await resp.json();
  const items = data.Messages || data.messages || data.Result || data.result || data.Items || [];
  return items.map((item: any) => ({
    messageId: item.Id || item.MessageId || 0,
    date: item.Timestamp || item.Date || item.SendDate || 0,
    text: item.Text || item.Body || item.Content || '',
    senderName: item.SenderName || item.From || item.Sender || 'Unknown',
    chatId: peerId,
    chatType: peerType,
  }));
}
