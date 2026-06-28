import type { Env } from './env';
import type { TelegramUpdate, SplusSession } from './types';
import { sendMessage, answerCallbackQuery, sendInlineKeyboard } from './telegram';
import { getUserState, setUserState, clearUserState, saveSession, getSession, deleteSession, isValidPhone, isValidCode, normalizePhone } from './state-machine';
import { sendSMS, verifyCode, getConversationList, getNewPrivateMessages, getNewChannelMessages } from './splus-client';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    if (request.method !== 'POST' || url.pathname !== '/') {
      return new Response('Not Found', { status: 404 });
    }

    let update: TelegramUpdate;
    try {
      update = await request.json() as TelegramUpdate;
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    try {
      if (update.message) {
        await handleMessage(env, update.message);
      } else if (update.callback_query) {
        await handleCallbackQuery(env, update.callback_query);
      }
    } catch (e) {
      console.error('Handler error:', e);
    }

    return new Response('OK', { status: 200 });
  },
};

async function handleMessage(env: Env, msg: NonNullable<TelegramUpdate['message']>) {
  const chatId = msg.chat.id;
  const text = msg.text?.trim() || '';

  if (text === '/start') {
    await clearUserState(env.BOT_KV, chatId);
    await setUserState(env.BOT_KV, chatId, { state: 'AWAITING_PHONE' });
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      'Welcome to Soroush+ Message Bot!\n\nPlease enter your Soroush+ phone number (e.g., 0912xxxxxxx):'
    );
    return;
  }

  if (text === '/cancel') {
    await clearUserState(env.BOT_KV, chatId);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Operation cancelled.');
    return;
  }

  if (text === '/logout') {
    await clearUserState(env.BOT_KV, chatId);
    await deleteSession(env.BOT_KV, chatId);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Logged out. Send /start to login again.');
    return;
  }

  if (text === '/fetch') {
    await handleFetch(env, chatId);
    return;
  }

  const state = await getUserState(env.BOT_KV, chatId);

  switch (state.state) {
    case 'AWAITING_PHONE':
      await handlePhoneInput(env, chatId, text);
      break;
    case 'AWAITING_SMS':
      await handleSmsInput(env, chatId, text);
      break;
    case 'IDLE':
    case 'AUTHENTICATED':
    default:
      break;
  }
}

async function handlePhoneInput(env: Env, chatId: number, text: string) {
  if (!isValidPhone(text)) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      'Invalid phone number format. Please enter a valid Iranian phone number (e.g., 0912xxxxxxx):'
    );
    return;
  }

  const phone = normalizePhone(text);
  await setUserState(env.BOT_KV, chatId, { phone });

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Sending SMS code...');

  const result = await sendSMS(env.SPLUS_API_BASE, phone);
  if (result.success) {
    await setUserState(env.BOT_KV, chatId, { state: 'AWAITING_SMS' });
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      'SMS sent! Please enter the verification code you received:'
    );
  } else {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      `Failed to send SMS: ${result.error}\nPlease try again or check your phone number.`
    );
  }
}

async function handleSmsInput(env: Env, chatId: number, text: string) {
  if (!isValidCode(text)) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      'Invalid code format. Please enter a 4-6 digit code:'
    );
    return;
  }

  const state = await getUserState(env.BOT_KV, chatId);
  if (!state.phone) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Session error. Send /start to try again.');
    await clearUserState(env.BOT_KV, chatId);
    return;
  }

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Verifying code...');

  const result = await verifyCode(env.SPLUS_API_BASE, state.phone, text.trim());
  if (result.success && result.session) {
    await saveSession(env.BOT_KV, chatId, result.session);
    await setUserState(env.BOT_KV, chatId, { state: 'AUTHENTICATED' });
    await sendInlineKeyboard(env.TELEGRAM_BOT_TOKEN, chatId,
      'Login successful!',
      [[{ text: 'Fetch Messages', callback_data: 'fetch' }]]
    );
  } else {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      `Verification failed: ${result.error}\nPlease try again or send /start to restart.`
    );
  }
}

async function handleCallbackQuery(env: Env, query: NonNullable<TelegramUpdate['callback_query']>) {
  const chatId = query.message?.chat.id;
  if (!chatId) return;

  await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, query.id);

  if (query.data === 'fetch') {
    await handleFetch(env, chatId);
  }
}

async function handleFetch(env: Env, chatId: number) {
  const session = await getSession<SplusSession>(env.BOT_KV, chatId);
  if (!session) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      'Not logged in. Send /start to login.'
    );
    return;
  }

  if (session.expiresAt < Date.now()) {
    await deleteSession(env.BOT_KV, chatId);
    await clearUserState(env.BOT_KV, chatId);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      'Session expired. Send /start to login again.'
    );
    return;
  }

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Fetching messages...');

  try {
    const [conversations, privateMessages, channelMessages] = await Promise.allSettled([
      getConversationList(env.SPLUS_API_BASE, session),
      getNewPrivateMessages(env.SPLUS_API_BASE, session),
      getNewChannelMessages(env.SPLUS_API_BASE, session),
    ]);

    const allMessages = [
      ...(privateMessages.status === 'fulfilled' ? privateMessages.value : []),
      ...(channelMessages.status === 'fulfilled' ? channelMessages.value : []),
    ];

    const unreadConversations = conversations.status === 'fulfilled'
      ? conversations.value.filter(c => c.unreadCount > 0)
      : [];

    if (allMessages.length === 0 && unreadConversations.length === 0) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
        'No unread messages found.'
      );
      return;
    }

    let output = '';

    if (unreadConversations.length > 0) {
      output += `=== Chats with unread messages (${unreadConversations.length}) ===\n\n`;
      for (const conv of unreadConversations.slice(0, 20)) {
        output += `${conv.type === 'channel' ? '#' : conv.type === 'group' ? '&' : '@'} ${conv.name}\n`;
        output += `  Unread: ${conv.unreadCount}`;
        if (conv.lastMessage) output += ` | Last: ${conv.lastMessage.slice(0, 50)}`;
        if (conv.lastMessageTime) output += `\n  Time: ${conv.lastMessageTime}`;
        output += '\n\n';
      }
    }

    if (allMessages.length > 0) {
      output += `=== Messages (${allMessages.length}) ===\n\n`;
      for (const msg of allMessages.slice(0, 50)) {
        output += `Chat: ${msg.chat}\n`;
        output += `From: ${msg.sender}\n`;
        if (msg.timestamp) output += `Time: ${msg.timestamp}\n`;
        output += `${msg.text}\n`;
        output += '---\n\n';
      }
    }

    const maxLen = 4000;
    if (output.length <= maxLen) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, output);
    } else {
      const chunks = splitMessage(output, maxLen);
      for (const chunk of chunks) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, chunk);
      }
    }

    await sendInlineKeyboard(env.TELEGRAM_BOT_TOKEN, chatId, 'Done!',
      [[{ text: 'Refresh', callback_data: 'fetch' }]]
    );
  } catch (e) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      `Error fetching messages: ${(e as Error).message}`
    );
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf('\n\n', maxLen);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt <= 0) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n+/, '');
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
