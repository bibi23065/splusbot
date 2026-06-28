export type LoginState = 'IDLE' | 'AWAITING_PHONE' | 'AWAITING_SMS' | 'AUTHENTICATED';

export interface UserState {
  phone: string | null;
  state: LoginState;
  chatId: number;
}

export interface SplusSession {
  token: string;
  userId: string;
  cookies: Record<string, string>;
  expiresAt: number;
}

export interface SplusMessage {
  id: string;
  text: string;
  sender: string;
  senderId: string;
  chat: string;
  chatId: string;
  timestamp: string;
  isChannel: boolean;
}

export interface SplusConversation {
  id: string;
  name: string;
  type: 'private' | 'group' | 'channel';
  unreadCount: number;
  lastMessage?: string;
  lastMessageTime?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  from: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
  };
  chat: {
    id: number;
    type: string;
  };
  date: number;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
  };
  message?: TelegramMessage;
  data?: string;
}
