// Palworld REST API client. Replaces RCON, which Pocketpair deprecated in 1.0
// (and plans to remove). Auth is HTTP Basic with username "admin" and the
// server's AdminPassword. Base URL: http://127.0.0.1:{RESTAPIPort}/v1/api
//
// The REST API is intended for LAN/localhost use only, which matches how this
// app runs (same machine as the server), so we always target 127.0.0.1.

import type { PlayerInfo } from '../shared/types';
import { readSettings } from './settings';

const HOST = '127.0.0.1';

function baseUrl(): string {
  const port = readSettings().restApiPort ?? 8212;
  return `http://${HOST}:${port}/v1/api`;
}

function authHeader(): string {
  const pw = readSettings().adminPassword ?? '';
  return 'Basic ' + Buffer.from(`admin:${pw}`).toString('base64');
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  timeoutMs = 5000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        Authorization: authHeader(),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (res.status === 401) {
      throw new Error('REST API 認証に失敗しました（AdminPassword を確認してください）。');
    }
    if (!res.ok) throw new Error(`REST API エラー (HTTP ${res.status})`);
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface ServerInfoResp {
  version?: string;
  servername?: string;
  description?: string;
  worldguid?: string;
}

export interface MetricsResp {
  serverfps?: number;
  currentplayernum?: number;
  maxplayernum?: number;
  serverframetime?: number;
  uptime?: number;
  days?: number;
}

interface RawPlayer {
  name?: string;
  accountName?: string;
  playerId?: string;
  userId?: string;
  steamId?: string;
}
interface PlayersResp {
  players?: RawPlayer[];
}

/** GET /info — used as a readiness probe on startup. */
export function info(timeoutMs = 2500): Promise<ServerInfoResp> {
  return request<ServerInfoResp>('GET', '/info', undefined, timeoutMs);
}

/** GET /metrics — server-reported fps / player count / uptime / days. */
export function metrics(timeoutMs = 2500): Promise<MetricsResp> {
  return request<MetricsResp>('GET', '/metrics', undefined, timeoutMs);
}

/** GET /players — connected players (multibyte-safe, unlike RCON ShowPlayers). */
export async function players(): Promise<PlayerInfo[]> {
  const body = await request<PlayersResp>('GET', '/players');
  return (body.players ?? []).map((p) => ({
    name: p.name ?? p.accountName ?? '',
    playerId: p.playerId,
    steamId: p.steamId,
    userId: p.userId,
  }));
}

/** POST /announce — broadcast a message to all players (UTF-8 / Japanese OK). */
export async function announce(message: string): Promise<void> {
  await request('POST', '/announce', { message });
}

/** POST /kick — remove a player by userId (e.g. "steam_0123..."). */
export async function kick(userid: string, message = 'Kicked by admin.'): Promise<void> {
  await request('POST', '/kick', { userid, message });
}

/** POST /ban — ban a player by userId. */
export async function ban(userid: string, message = 'Banned by admin.'): Promise<void> {
  await request('POST', '/ban', { userid, message });
}

/** POST /unban — lift a ban by userId. */
export async function unban(userid: string): Promise<void> {
  await request('POST', '/unban', { userid });
}

/** POST /save — persist the world. */
export async function save(): Promise<void> {
  await request('POST', '/save', {});
}

/** POST /shutdown — graceful shutdown after waittime seconds, with a message. */
export async function shutdown(waittime: number, message: string): Promise<void> {
  await request('POST', '/shutdown', { waittime, message });
}

/** POST /stop — force stop (fallback when a graceful shutdown doesn't respond). */
export async function forceStop(): Promise<void> {
  await request('POST', '/stop', {});
}
