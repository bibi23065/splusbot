import type { Env } from './env';

const TELEGRAM_API = 'https://api.telegram.org';

async function callTelegram(token: string, method: string, body: Record<string, unknown>) {
  const url = `${TELEGRAM_API}/bot${token}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json() as { ok: boolean; description?: string; result?: unknown };
  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description || 'unknown'}`);
  }
  return data.result;
}

export async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  options?: { reply_markup?: Record<string, unknown>; parse_mode?: string }
) {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (options?.parse_mode) body.parse_mode = options.parse_mode;
  if (options?.reply_markup) body.reply_markup = options.reply_markup;
  return callTelegram(token, 'sendMessage', body);
}

export async function answerCallbackQuery(token: string, callbackQueryId: string) {
  return callTelegram(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId });
}

export async function sendInlineKeyboard(
  token: string,
  chatId: number,
  text: string,
  buttons: Array<Array<{ text: string; callback_data: string }>>
) {
  return sendMessage(token, chatId, text, {
    reply_markup: { inline_keyboard: buttons },
  });
}

export async function editMessageText(
  token: string,
  chatId: number,
  messageId: number,
  text: string,
  options?: { reply_markup?: Record<string, unknown> }
) {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
  };
  if (options?.reply_markup) body.reply_markup = options.reply_markup;
  return callTelegram(token, 'editMessageText', body);
}
