import type { Env } from './types';

const TELEGRAM_API = 'https://api.telegram.org';
const GITHUB_REPO = 'bibi23065/splusbot';
const GITHUB_WORKFLOW = 'check-messages.yml';

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

async function answerCallback(callbackQueryId: string, botToken?: string) {
  if (!botToken) return;
  await fetch(`${TELEGRAM_API}/bot${botToken}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function getState(kv: KVNamespace, chatId: number): Promise<{ state: string }> {
  const data = await kv.get<{ state: string }>(`splusbot:state:${chatId}`, 'json');
  return data || { state: 'UNAUTHENTICATED' };
}

async function setState(kv: KVNamespace, chatId: number, state: any) {
  await kv.put(`splusbot:state:${chatId}`, JSON.stringify(state));
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

async function getLatestRun(githubToken: string): Promise<any> {
  const resp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/runs?per_page=1`, {
    headers: {
      'Authorization': `token ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'splusbot-worker',
    },
  });
  if (!resp.ok) return null;
  const data: any = await resp.json();
  return data.workflow_runs?.[0] || null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'GET') return new Response('SplusBot v4', { status: 200 });

    try {
      const update = await request.json() as any;
      const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
      const text = update.message?.text || update.callback_query?.data || '';
      const callbackQueryId = update.callback_query?.id;

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
              'To get your session token:',
              '',
              '1. Run extract-session.mjs locally:',
              '   node extract-session.mjs',
              '',
              '2. It opens a browser. Log in to Soroush+.',
              '',
              '3. After login, press Enter in the terminal.',
              '',
              '4. Copy the JSON output and paste it below:',
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
              const run = await getLatestRun(env.GITHUB_TOKEN);
              await env.KV.put(`splusbot:session:${chatId}`, text);
              await setState(env.KV, chatId, { state: 'AUTHENTICATED' });
              await sendMsg(chatId, 'Session stored! Click below to check unread messages.', kb, botToken);
            } catch (e: any) {
              await env.KV.put(`splusbot:session:${chatId}`, text);
              await setState(env.KV, chatId, { state: 'AUTHENTICATED' });
              await sendMsg(chatId, 'Session stored. Click below to check unread messages.', kb, botToken);
            }
          } else {
            await sendMsg(chatId, 'Invalid token. Paste the full session JSON.', undefined, botToken);
          }
          break;
        }

        case 'AUTHENTICATED': {
          if (text === 'check_now' || text === '/fetch') {
            const githubToken = env.GITHUB_TOKEN;
            if (!githubToken) {
              await sendMsg(chatId, 'GitHub token not configured. Send /start to re-login.', undefined, botToken);
              break;
            }

            const session = await env.KV.get(`splusbot:session:${chatId}`);
            if (!session) {
              await setState(env.KV, chatId, { state: 'UNAUTHENTICATED' });
              await sendMsg(chatId, 'Session expired. Send /start to re-login.', undefined, botToken);
              break;
            }

            await sendMsg(chatId, 'Checking messages...', undefined, botToken);

            const result = await triggerGitHubWorkflow(githubToken);
            if (result.success) {
              await sendMsg(chatId, 'Check triggered! Messages will arrive in your Telegram shortly.', undefined, botToken);
            } else {
              await sendMsg(chatId, `Failed to trigger check: ${result.error}`, undefined, botToken);
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
    } catch (e: any) {
      return new Response('ok', { status: 200 });
    }
  },
};
