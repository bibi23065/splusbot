import type { SplusSession, SplusConversation, SplusMessage } from './types';

const DEFAULT_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.8',
};

function buildAuthHeaders(session: SplusSession): Record<string, string> {
  const headers = { ...DEFAULT_HEADERS };
  if (session.token) {
    headers['Authorization'] = `Bearer ${session.token}`;
    headers['X-Access-Token'] = session.token;
  }
  if (Object.keys(session.cookies).length > 0) {
    const cookieStr = Object.entries(session.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    headers['Cookie'] = cookieStr;
  }
  return headers;
}

async function postRequest(baseUrl: string, path: string, body: Record<string, unknown>, headers?: Record<string, string>) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: headers || DEFAULT_HEADERS,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response from ${path}: ${text.slice(0, 200)}`);
  }
  return data;
}

export async function activation(baseUrl: string, phone: string): Promise<{ success: boolean; error?: string }> {
  try {
    const data = await postRequest(baseUrl, '/activation/', {
      PhoneNumber: phone,
      DeviceId: crypto.randomUUID(),
      PlatformType: 1,
      AppVersion: '1.10.0',
    }) as Record<string, unknown>;
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function sendSMS(baseUrl: string, phone: string): Promise<{ success: boolean; error?: string; data?: unknown }> {
  try {
    const data = await postRequest(baseUrl, '/sendSMS/', {
      PhoneNumber: phone,
      DeviceId: crypto.randomUUID(),
      PlatformType: 1,
      AppVersion: '1.10.0',
    });
    return { success: true, data };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function verifyCode(
  baseUrl: string,
  phone: string,
  code: string
): Promise<{ success: boolean; session?: SplusSession; error?: string }> {
  try {
    const data = await postRequest(baseUrl, '/Voucher/Verify/', {
      PhoneNumber: phone,
      Code: code,
      DeviceId: crypto.randomUUID(),
      PlatformType: 1,
      AppVersion: '1.10.0',
    }) as Record<string, unknown>;

    const cookies: Record<string, string> = {};
    const session: SplusSession = {
      token: (data.Token as string) || (data.token as string) || (data.AccessToken as string) || '',
      userId: String((data.UserId as string) || (data.userId as string) || (data.UserID as string) || ''),
      cookies,
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    };

    if (data.Cookies && typeof data.Cookies === 'object') {
      Object.assign(cookies, data.Cookies);
    }
    if (data.SetCookie && typeof data.SetCookie === 'object') {
      Object.assign(cookies, data.SetCookie);
    }

    if (!session.token && !session.userId) {
      return { success: false, error: `Unexpected response: ${JSON.stringify(data).slice(0, 300)}` };
    }

    return { success: true, session };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function getConversationList(
  baseUrl: string,
  session: SplusSession
): Promise<SplusConversation[]> {
  const headers = buildAuthHeaders(session);
  try {
    const data = await postRequest(baseUrl, '/CAPI/Conversation/List/', {
      UserId: session.userId,
      Offset: 0,
      Limit: 50,
    }, headers) as Record<string, unknown>;

    const conversations: SplusConversation[] = [];
    const items = (data.Conversations as Array<Record<string, unknown>>)
      || (data.conversations as Array<Record<string, unknown>>)
      || (data.Result as Array<Record<string, unknown>>)
      || (data.result as Array<Record<string, unknown>>)
      || [];

    for (const item of items) {
      conversations.push({
        id: String(item.Id || item.id || item.ChatId || item.chatId || ''),
        name: String(item.Name || item.name || item.Title || item.title || item.DisplayName || item.displayName || 'Unknown'),
        type: (item.Type as string) === '1' || (item.Type as string) === 'group' ? 'group'
          : (item.Type as string) === '2' || (item.Type as string) === 'channel' ? 'channel'
          : 'private',
        unreadCount: Number(item.UnreadCount || item.unreadCount || item.Badge || item.badge || 0),
        lastMessage: String(item.LastMessage || item.lastMessage || item.LastMessageText || item.lastMessageText || ''),
        lastMessageTime: String(item.LastMessageTime || item.lastMessageTime || item.Timestamp || item.timestamp || ''),
      });
    }

    return conversations;
  } catch (e) {
    throw new Error(`Failed to get conversations: ${(e as Error).message}`);
  }
}

export async function getNewPrivateMessages(
  baseUrl: string,
  session: SplusSession
): Promise<SplusMessage[]> {
  const headers = buildAuthHeaders(session);
  try {
    const data = await postRequest(baseUrl, '/GAPI/privatechat/newMessages/', {
      UserId: session.userId,
      LastMessageId: 0,
    }, headers) as Record<string, unknown>;

    return parseMessages(data, false);
  } catch (e) {
    throw new Error(`Failed to get private messages: ${(e as Error).message}`);
  }
}

export async function getNewChannelMessages(
  baseUrl: string,
  session: SplusSession
): Promise<SplusMessage[]> {
  const headers = buildAuthHeaders(session);
  try {
    const data = await postRequest(baseUrl, '/GAPI/channels/newMessages/json', {
      UserId: session.userId,
      LastMessageId: 0,
    }, headers) as Record<string, unknown>;

    return parseMessages(data, true);
  } catch (e) {
    throw new Error(`Failed to get channel messages: ${(e as Error).message}`);
  }
}

export async function getWindowArchive(
  baseUrl: string,
  session: SplusSession,
  chatId: string,
  isGroup: boolean
): Promise<SplusMessage[]> {
  const headers = buildAuthHeaders(session);
  const path = isGroup
    ? '/CAPI/Groupchat/WindowArchive/'
    : '/CAPI/Userchat/WindowArchive/';
  try {
    const data = await postRequest(baseUrl, path, {
      UserId: session.userId,
      ChatId: chatId,
      Offset: 0,
      Limit: 50,
    }, headers) as Record<string, unknown>;

    return parseMessages(data, isGroup);
  } catch (e) {
    throw new Error(`Failed to get chat history: ${(e as Error).message}`);
  }
}

function parseMessages(data: Record<string, unknown>, isChannel: boolean): SplusMessage[] {
  const messages: SplusMessage[] = [];
  const items = (data.Messages as Array<Record<string, unknown>>)
    || (data.messages as Array<Record<string, unknown>>)
    || (data.Result as Array<Record<string, unknown>>)
    || (data.result as Array<Record<string, unknown>>)
    || (data.Items as Array<Record<string, unknown>>)
    || (data.items as Array<Record<string, unknown>>)
    || [];

  for (const item of items) {
    messages.push({
      id: String(item.Id || item.id || item.MessageId || item.messageId || ''),
      text: String(item.Text || item.text || item.Body || item.body || item.Content || item.content || ''),
      sender: String(item.SenderName || item.senderName || item.From || item.from || item.Sender || item.sender || 'Unknown'),
      senderId: String(item.SenderId || item.senderId || item.FromId || item.fromId || item.UserId || item.userId || ''),
      chat: String(item.ChatName || item.chatName || item.ChatTitle || item.chatTitle || item.GroupName || item.groupName || 'Unknown'),
      chatId: String(item.ChatId || item.chatId || item.GroupId || item.groupId || item.ChannelId || item.channelId || ''),
      timestamp: String(item.Timestamp || item.timestamp || item.Date || item.date || item.SendDate || item.sendDate || ''),
      isChannel,
    });
  }

  return messages;
}
