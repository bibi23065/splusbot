export interface Env {
  KV: KVNamespace;
  TELEGRAM_BOT_TOKEN: string;
  GITHUB_TOKEN: string;
}

export type BotState = 'UNAUTHENTICATED' | 'AWAITING_TOKEN' | 'AUTHENTICATED';

export interface SplusMessage {
  chatTitle: string;
  unreadCount: number;
}
