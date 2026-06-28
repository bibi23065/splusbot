import type { Env } from './env';
import type { UserState } from './types';

const STATE_PREFIX = 'state:';
const SESSION_PREFIX = 'session:';
const STATE_TTL = 7 * 24 * 60 * 60;
const SESSION_TTL = 30 * 24 * 60 * 60;

export async function getUserState(kv: KVNamespace, chatId: number): Promise<UserState> {
  const raw = await kv.get(`${STATE_PREFIX}${chatId}`, 'json') as UserState | null;
  if (!raw) {
    return { phone: null, state: 'IDLE', chatId };
  }
  return raw;
}

export async function setUserState(kv: KVNamespace, chatId: number, state: Partial<UserState>) {
  const current = await getUserState(kv, chatId);
  const updated = { ...current, ...state, chatId };
  await kv.put(`${STATE_PREFIX}${chatId}`, JSON.stringify(updated), { expirationTtl: STATE_TTL });
}

export async function clearUserState(kv: KVNamespace, chatId: number) {
  await kv.delete(`${STATE_PREFIX}${chatId}`);
}

export async function saveSession(kv: KVNamespace, chatId: number, session: unknown) {
  await kv.put(`${SESSION_PREFIX}${chatId}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
}

export async function getSession<T = Record<string, unknown>>(kv: KVNamespace, chatId: number): Promise<T | null> {
  return kv.get(`${SESSION_PREFIX}${chatId}`, 'json') as Promise<T | null>;
}

export async function deleteSession(kv: KVNamespace, chatId: number) {
  await kv.delete(`${SESSION_PREFIX}${chatId}`);
}

export function isValidPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  return /^(\+?98|0)?9\d{9}$/.test(cleaned);
}

export function isValidCode(code: string): boolean {
  return /^\d{4,6}$/.test(code.trim());
}

export function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '+98' + cleaned.slice(1);
  } else if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}
