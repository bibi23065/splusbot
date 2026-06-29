export interface Env {
  KV: KVNamespace;
  TELEGRAM_BOT_TOKEN: string;
  GITHUB_TOKEN: string;
}

export type BotState = 'UNAUTHENTICATED' | 'AWAITING_TOKEN' | 'AUTHENTICATED';

export interface SplusUnreadChat {
  title: string;
  unreadCount: number;
  preview: string;
  time: string;
}

export interface BotStatus {
  lastRun: number;
  totalMessages: number;
  lastError: string | null;
  sessionValid: boolean;
}
