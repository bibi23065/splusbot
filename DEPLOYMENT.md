# Deployment Guide

## Step 1: Set Cloudflare Secrets

```bash
wrangler secret put TELEGRAM_BOT_TOKEN
# Paste: your-telegram-bot-token (from @BotFather)

# No SOROUSH_AUTH_TOKEN secret needed — session is stored per-user in KV
```

## Step 2: Deploy the Worker

```bash
wrangler deploy
```

Note the deployed URL, e.g. `https://splusbot.your-subdomain.workers.dev`

## Step 3: Bind Telegram Webhook

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://splusbot.your-subdomain.workers.dev/"
```

Verify with:
```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

## Step 4: Test the Bot

1. Open Telegram → find your bot → send `/start`
2. Click "Login to Soroush+"
3. Open `web.splus.ir` in Chrome, log in
4. Open DevTools Console, paste this snippet:
```js
(async()=>{const s={};const a1=localStorage.getItem('account1');if(a1)try{s.account1=JSON.parse(a1)}catch{};['dc2_auth_key','dc6_auth_key','dc8_auth_key'].forEach(k=>{const v=localStorage.getItem(k);if(v)try{s[k]=JSON.parse(v)}catch{s[k]=v}});console.log(JSON.stringify(s))})()
```
5. Copy the output from Console
6. Paste it into the Telegram bot

5. Click "Check Messages"
6. Verify unread messages appear

## Troubleshooting

**Bot doesn't respond to /start**: Check webhook is set correctly with `getWebhookInfo`.

**"Invalid session" error**: Make sure the JSON you paste starts with `{` and contains `account1` or `dc2_auth_key`.

**"Connection closed" error**: The session may have expired. Extract fresh data from `web.splus.ir`.

**Empty messages**: Soroush may use different TL constructor IDs. Share raw WebSocket frames from DevTools for debugging.
