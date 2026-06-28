import type { Env } from './types';

const BOT_TOKEN = '8960541207:AAEyAriLq0tWOMZjFEMSL6plhoywCql5TRg';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const GITHUB_REPO = 'bibi23065/splusbot';
const GITHUB_WORKFLOW = 'check-messages.yml';

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
    if (request.method === 'GET') return new Response('Splus Bot v3', { status: 200 });

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
            const kb = { inline_keyboard: [[{ text: 'Check Messages', callback_data: 'check_now' }]] };
            await sendMsg(chatId, 'Authenticated! Click below to check for unread messages.', kb);
          } else {
            await sendMsg(chatId, 'Invalid token. Please paste the full session data.');
          }
          break;
        }
        case 'AUTHENTICATED': {
          if (text === 'check_now' || text === '/fetch') {
            const githubToken = env.GITHUB_TOKEN;
            if (!githubToken) {
              await sendMsg(chatId, 'GitHub token not configured. Send /start to re-login.');
              return new Response('ok', { status: 200 });
            }
            await sendMsg(chatId, 'Checking messages...');
            const result = await triggerGitHubWorkflow(githubToken);
            if (result.success) {
              await sendMsg(chatId, 'Check triggered! Messages will arrive in your Telegram shortly.');
            } else {
              await sendMsg(chatId, `Failed to trigger check: ${result.error}`);
            }
          } else if (text === '/logout') {
            await env.KV.delete(`splusbot:token:${chatId}`);
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
