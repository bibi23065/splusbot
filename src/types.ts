export interface Env {
  KV: KVNamespace;
  TELEGRAM_BOT_TOKEN: string;
  GITHUB_TOKEN: string;
}

export type BotState = 'UNAUTHENTICATED' | 'AWAITING_JWT' | 'AUTHENTICATED';

export interface UserState {
  state: BotState;
}

export interface SplusDialog {
  peerId: number;
  peerType: number;
  title: string;
  unreadCount: number;
  lastMessageDate: number;
}

export interface SplusMessage {
  messageId: number;
  date: number;
  text?: string;
  senderName: string;
  senderUsername?: string;
  chatId: number;
  chatType: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
    date: number;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name: string; username?: string };
    message?: {
      message_id: number;
      chat: { id: number; type: string };
    };
    data?: string;
  };
}
