import type { Env, SplusUnreadChat, BotStatus } from './types';

const TELEGRAM_API = 'https://api.telegram.org';
const GITHUB_REPO = 'bibi23065/splusbot';
const GITHUB_WORKFLOW = 'check-messages.yml';
const SPLUS_WEB_URL = 'https://web.splus.ir';

function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

async function sendMsg(chatId: number, text: string, replyMarkup?: any, botToken?: string, parseMode?: string) {
  if (!botToken) return;
  const body: any = { chat_id: chatId, text };
  if (replyMarkup) body.reply_markup = JSON.stringify(replyMarkup);
  if (parseMode) body.parse_mode = parseMode;
  await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function editMsg(chatId: number, messageId: number, text: string, replyMarkup?: any, botToken?: string) {
  if (!botToken) return;
  const body: any = { chat_id: chatId, message_id: messageId, text };
  if (replyMarkup) body.reply_markup = JSON.stringify(replyMarkup);
  body.parse_mode = 'MarkdownV2';
  await fetch(`${TELEGRAM_API}/bot${botToken}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function answerCallback(callbackQueryId: string, botToken?: string) {
  if (!botToken) return;
  await fetch(`${TELEGRAM_API}/bot${botToken}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
}

async function getState(kv: KVNamespace, chatId: number): Promise<{ state: string }> {
  const data = await kv.get<{ state: string }>(`splusbot:state:${chatId}`, 'json');
  return data || { state: 'UNAUTHENTICATED' };
}

async function setState(kv: KVNamespace, chatId: number, state: any) {
  await kv.put(`splusbot:state:${chatId}`, JSON.stringify(state));
}

async function getBotStatus(kv: KVNamespace, chatId: number): Promise<BotStatus> {
  const raw = await kv.get<BotStatus>(`splusbot:status:${chatId}`, 'json');
  return raw || { lastRun: 0, totalMessages: 0, lastError: null, sessionValid: false };
}

async function updateBotStatus(kv: KVNamespace, chatId: number, updates: Partial<BotStatus>) {
  const current = await getBotStatus(kv, chatId);
  await kv.put(`splusbot:status:${chatId}`, JSON.stringify({ ...current, ...updates }));
}

async function triggerGitHubWorkflow(githubToken: string): Promise<{ success: boolean; error?: string }> {
  const resp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'splusbot-worker',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    return { success: false, error: `${resp.status}: ${err}` };
  }
  return { success: true };
}

function truncateButtonLabel(title: string, count: number): string {
  const label = `${title} (${count})`;
  const bytes = new TextEncoder().encode(label).length;
  if (bytes <= 60) return label;
  const maxTitleBytes = 60 - new TextEncoder().encode(` (${count})`).length;
  let truncated = '';
  let running = 0;
  for (const char of title) {
    const charBytes = new TextEncoder().encode(char).length;
    if (running + charBytes > maxTitleBytes) break;
    truncated += char;
    running += charBytes;
  }
  return `${truncated}… (${count})`;
}

function buildUnreadMessage(chats: SplusUnreadChat[]): { text: string; keyboard: any } {
  if (chats.length === 0) {
    return {
      text: '📬 *No unread messages*',
      keyboard: { inline_keyboard: [[{ text: '🔄 Refresh', callback_data: 'refresh' }], [{ text: '📊 Status', callback_data: 'status' }]] },
    };
  }

  const text = `📬 *Soroush\\+ Unread* \\(${chats.length} chats\\)\nTap a chat to see its preview:`;

  const rows: any[][] = [];
  for (let i = 0; i < chats.length; i++) {
    rows.push([{ text: truncateButtonLabel(chats[i].title, chats[i].unreadCount), callback_data: `chat:${i}` }]);
  }
  rows.push([
    { text: '🔄 Refresh', callback_data: 'refresh' },
    { text: '📊 Status', callback_data: 'status' },
  ]);

  return { text, keyboard: { inline_keyboard: rows } };
}

function buildChatDetail(chat: SplusUnreadChat, index: number): { text: string; keyboard: any } {
  const name = escapeMarkdownV2(chat.title);
  const unread = String(chat.unreadCount);
  const preview = escapeMarkdownV2(chat.preview || 'No preview available.');
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const text = [
    `💬 *New Message from Soroush*`,
    ``,
    `👤 *Sender:* ${name}`,
    `📩 *Unread:* ${unread}`,
    `🕒 *Time:* \`${time}\``,
    ``,
    `───────────────────`,
    ``,
    preview,
    ``,
    `───────────────────`,
    `[🌐 Open Soroush Web](${SPLUS_WEB_URL})`,
  ].join('\n');

  const keyboard = { inline_keyboard: [[{ text: '← Back', callback_data: 'back' }]] };
  return { text, keyboard };
}

function buildStatusMessage(status: BotStatus, sessionExists: boolean): { text: string; keyboard: any } {
  const connectionStatus = sessionExists ? '✅ Active' : '❌ Inactive';
  const sessionStatus = status.sessionValid ? '✅ Valid' : '⚠️ Unknown';
  const lastRun = status.lastRun ? new Date(status.lastRun).toLocaleString('en-US', { timeZone: 'Asia/Tehran' }) : 'Never';
  const total = String(status.totalMessages);
  const lastError = status.lastError ? escapeMarkdownV2(status.lastError.slice(0, 100)) : 'None';

  const text = [
    `📊 *Bot Status Dashboard*`,
    ``,
    `🔌 *Connection:* ${connectionStatus}`,
    `🔑 *Session:* ${sessionStatus}`,
    `🕐 *Last Run:* \`${lastRun}\``,
    `📬 *Messages Forwarded:* ${total}`,
    `❌ *Last Error:* ${lastError}`,
  ].join('\n');

  const keyboard = {
    inline_keyboard: [
      [{ text: '🔄 Refresh', callback_data: 'refresh' }],
      [{ text: '← Back', callback_data: 'back' }],
    ],
  };
  return { text, keyboard };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET') return new Response('SplusBot v6', { status: 200 });

    if (request.method === 'POST' && url.pathname === '/webhook/results') {
      try {
        const data = await request.json() as { chatId: number; chats: SplusUnreadChat[]; timestamp: number; error?: string };
        const botToken = env.TELEGRAM_BOT_TOKEN;

        if (data.error) {
          const errorText = [
            `❌ *Script Error Report*`,
            ``,
            `\`${escapeMarkdownV2(data.error)}\``,
            ``,
            `Check [GitHub Actions logs](https://github.com/${GITHUB_REPO}/actions) for details.`,
          ].join('\n');
          await sendMsg(data.chatId, errorText, undefined, botToken, 'MarkdownV2');
          await updateBotStatus(env.KV, data.chatId, { lastError: data.error, lastRun: data.timestamp });
          return new Response('ok', { status: 200 });
        }

        if (!data.chatId || !data.chats) return new Response('bad request', { status: 400 });

        await env.KV.put(`splusbot:unread:${data.chatId}`, JSON.stringify(data.chats), { expirationTtl: 3600 });

        const { text, keyboard } = buildUnreadMessage(data.chats);
        await sendMsg(data.chatId, text, keyboard, botToken, 'MarkdownV2');

        const currentStatus = await getBotStatus(env.KV, data.chatId);
        await updateBotStatus(env.KV, data.chatId, {
          lastRun: data.timestamp,
          totalMessages: currentStatus.totalMessages + data.chats.reduce((sum, c) => sum + c.unreadCount, 0),
          lastError: null,
          sessionValid: true,
        });

        return new Response('ok', { status: 200 });
      } catch {
        return new Response('error', { status: 500 });
      }
    }

    try {
      const update = await request.json() as any;
      const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
      const text = update.message?.text || update.callback_query?.data || '';
      const callbackQueryId = update.callback_query?.id;

      if (!chatId || !env.KV) return new Response('ok', { status: 200 });
      if (callbackQueryId) await answerCallback(callbackQueryId, env.TELEGRAM_BOT_TOKEN);

      const botToken = env.TELEGRAM_BOT_TOKEN;

      if (callbackQueryId) {
        if (text === 'status') {
          const session = await env.KV.get(`splusbot:session:${chatId}`);
          const status = await getBotStatus(env.KV, chatId);
          status.sessionValid = !!session;
          const { text: statusText, keyboard } = buildStatusMessage(status, !!session);
          const msgId = update.callback_query?.message?.message_id;
          if (msgId) {
            await editMsg(chatId, msgId, statusText, keyboard, botToken);
          } else {
            await sendMsg(chatId, statusText, keyboard, botToken, 'MarkdownV2');
          }
          return new Response('ok', { status: 200 });
        }

        if (text === 'refresh') {
          const githubToken = env.GITHUB_TOKEN;
          if (!githubToken) {
            await sendMsg(chatId, 'GitHub token not configured.', undefined, botToken);
            return new Response('ok', { status: 200 });
          }
          const session = await env.KV.get(`splusbot:session:${chatId}`);
          if (!session) {
            await setState(env.KV, chatId, { state: 'UNAUTHENTICATED' });
            await sendMsg(chatId, 'Session expired. Send /start to re\\-login.', undefined, botToken, 'MarkdownV2');
            return new Response('ok', { status: 200 });
          }
          await sendMsg(chatId, '⏳ Checking messages\\.', undefined, botToken, 'MarkdownV2');
          const result = await triggerGitHubWorkflow(githubToken);
          if (!result.success) {
            await sendMsg(chatId, `Failed to trigger check: ${escapeMarkdownV2(result.error || 'unknown')}`, undefined, botToken, 'MarkdownV2');
          }
          return new Response('ok', { status: 200 });
        }

        if (text === 'back') {
          const chats = await env.KV.get<SplusUnreadChat[]>(`splusbot:unread:${chatId}`, 'json');
          if (chats) {
            const msgId = update.callback_query?.message?.message_id;
            const { text: msgText, keyboard } = buildUnreadMessage(chats);
            if (msgId) {
              await editMsg(chatId, msgId, msgText, keyboard, botToken);
            } else {
              await sendMsg(chatId, msgText, keyboard, botToken, 'MarkdownV2');
            }
          } else {
            await sendMsg(chatId, 'No cached data\\. Click Refresh\\.', { inline_keyboard: [[{ text: '🔄 Refresh', callback_data: 'refresh' }]] }, botToken, 'MarkdownV2');
          }
          return new Response('ok', { status: 200 });
        }

        if (text.startsWith('chat:')) {
          const index = parseInt(text.split(':')[1], 10);
          const chats = await env.KV.get<SplusUnreadChat[]>(`splusbot:unread:${chatId}`, 'json');
          if (chats && index >= 0 && index < chats.length) {
            const { text: detailText, keyboard } = buildChatDetail(chats[index], index);
            const msgId = update.callback_query?.message?.message_id;
            if (msgId) {
              await editMsg(chatId, msgId, detailText, keyboard, botToken);
            } else {
              await sendMsg(chatId, detailText, keyboard, botToken, 'MarkdownV2');
            }
          } else {
            await sendMsg(chatId, 'Chat data expired\\. Click Refresh\\.', { inline_keyboard: [[{ text: '🔄 Refresh', callback_data: 'refresh' }]] }, botToken, 'MarkdownV2');
          }
          return new Response('ok', { status: 200 });
        }
      }

      const state = await getState(env.KV, chatId);

      switch (state.state) {
        case 'UNAUTHENTICATED': {
          if (text === '/start') {
            const kb = {
              inline_keyboard: [
                [{ text: '🔐 Login to Soroush+', callback_data: 'login_splus' }],
                [{ text: '📊 Status', callback_data: 'status' }],
              ],
            };
            const welcomeText = [
              `👋 *Welcome to SplusBot*`,
              ``,
              `I forward your unread Soroush\\+ messages to Telegram\\.`,
              `Click below to login\\.`,
            ].join('\n');
            await sendMsg(chatId, welcomeText, kb, botToken, 'MarkdownV2');
          } else if (text === 'login_splus') {
            await setState(env.KV, chatId, { state: 'AWAITING_TOKEN' });
            const instructions = [
              `🔑 *Session Setup*`,
              ``,
              `1\\. Run extract\\-session\\.mjs locally:`,
              `   \`node extract-session.mjs\``,
              ``,
              `2\\. It opens a browser\\. Log in to Soroush\\+\\.`,
              ``,
              `3\\. After login, press Enter in the terminal\\.`,
              ``,
              `4\\. Copy the JSON output and paste it below:`,
            ].join('\n');
            await sendMsg(chatId, instructions, undefined, botToken, 'MarkdownV2');
          }
          break;
        }

        case 'AWAITING_TOKEN': {
          if (text && text.length > 20 && !text.startsWith('/')) {
            try {
              JSON.parse(text);
            } catch {
              await sendMsg(chatId, 'Invalid JSON\\. Paste the full session data\\.', undefined, botToken, 'MarkdownV2');
              break;
            }

            const kb = {
              inline_keyboard: [
                [{ text: '📬 Check Messages', callback_data: 'check_now' }],
                [{ text: '📊 Status', callback_data: 'status' }],
              ],
            };

            try {
              await env.KV.put(`splusbot:session:${chatId}`, text);
              await setState(env.KV, chatId, { state: 'AUTHENTICATED' });
              await updateBotStatus(env.KV, chatId, { sessionValid: true });
              await sendMsg(chatId, '✅ *Session stored\\!* Click below to check unread messages\\.', kb, botToken, 'MarkdownV2');
            } catch (e: any) {
              await env.KV.put(`splusbot:session:${chatId}`, text);
              await setState(env.KV, chatId, { state: 'AUTHENTICATED' });
              await updateBotStatus(env.KV, chatId, { sessionValid: true });
              await sendMsg(chatId, '✅ *Session stored\\.* Click below to check unread messages\\.', kb, botToken, 'MarkdownV2');
            }
          } else {
            await sendMsg(chatId, 'Invalid token\\. Paste the full session JSON\\.', undefined, botToken, 'MarkdownV2');
          }
          break;
        }

        case 'AUTHENTICATED': {
          if (text === 'check_now' || text === '/fetch') {
            const githubToken = env.GITHUB_TOKEN;
            if (!githubToken) {
              await sendMsg(chatId, 'GitHub token not configured\\. Send /start to re\\-login\\.', undefined, botToken, 'MarkdownV2');
              break;
            }

            const session = await env.KV.get(`splusbot:session:${chatId}`);
            if (!session) {
              await setState(env.KV, chatId, { state: 'UNAUTHENTICATED' });
              await sendMsg(chatId, 'Session expired\\. Send /start to re\\-login\\.', undefined, botToken, 'MarkdownV2');
              break;
            }

            await sendMsg(chatId, '⏳ Checking messages\\.', undefined, botToken, 'MarkdownV2');

            const result = await triggerGitHubWorkflow(githubToken);
            if (!result.success) {
              await sendMsg(chatId, `Failed to trigger check: ${escapeMarkdownV2(result.error || 'unknown')}`, undefined, botToken, 'MarkdownV2');
            }
          } else if (text === '/status') {
            const session = await env.KV.get(`splusbot:session:${chatId}`);
            const status = await getBotStatus(env.KV, chatId);
            status.sessionValid = !!session;
            const { text: statusText, keyboard } = buildStatusMessage(status, !!session);
            await sendMsg(chatId, statusText, keyboard, botToken, 'MarkdownV2');
          } else if (text === '/logout') {
            await env.KV.delete(`splusbot:session:${chatId}`);
            await setState(env.KV, chatId, { state: 'UNAUTHENTICATED' });
            await updateBotStatus(env.KV, chatId, { sessionValid: false });
            await sendMsg(chatId, 'Logged out\\. Send /start to login again\\.', undefined, botToken, 'MarkdownV2');
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
