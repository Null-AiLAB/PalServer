// Palworld dedicated server lifecycle: install/update via SteamCMD, launch
// PalServer, and stop it gracefully over RCON.
//
// This replaces bedrock-server-manager's downloader.ts + server-manager.ts.
// Key differences vs Bedrock:
//   - Install: SteamCMD `app_update 2394010`, not a direct ZIP download.
//   - Stop/commands: REST API, because PalServer does not read stdin commands
//     (RCON was deprecated by Pocketpair in 1.0 and is being removed).
//
// Adapted from bedrock-server-manager (MIT, Copyright (c) 2026 yuzum).

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import AdmZip from 'adm-zip';
import type { LogLine, LogSource, ServerStatus, StartResult } from '../shared/types';
import {
  configFile,
  defaultConfigFile,
  ensureDirs,
  isInstalled,
  palServerExe,
  saveDir,
  serverDir,
  steamCmdExe,
  defaultSteamCmdDir,
} from './paths';
import { readSettings } from './settings';
import { PalworldConfig } from './palworld-config';
import * as rest from './rest-api';

const PALWORLD_APPID = '2394010';
const STEAMCMD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip';

let logCounter = 0;
function makeLog(text: string, source: LogSource): LogLine {
  const level = /error|failed|失敗/i.test(text) ? 'error' : /warn/i.test(text) ? 'warn' : 'info';
  return { id: ++logCounter, ts: Date.now(), level, source, text };
}

/**
 * PalServer prints its startup banner ("Game version is v… / Running Palworld
 * dedicated server on :PORT") as UTF-16, which reaches our UTF-8 stdout reader
 * mis-decoded into CJK "mojibake". Detect that one line by its (un-garbled)
 * ASCII tail and rebuild the original text: each mis-decoded code point is two
 * little-endian bytes of the real ASCII. Everything else passes through
 * untouched so legitimate non-ASCII (e.g. player names) is never mangled.
 */
function fixBannerMojibake(line: string): string {
  if (!/Palworld dedicated server on/i.test(line)) return line;
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7f]/.test(line)) return line; // pure ASCII: nothing to fix
  const bytes: number[] = [];
  for (const ch of line) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0x7f) bytes.push(cp);
    else if (cp <= 0xffff) bytes.push(cp & 0xff, (cp >> 8) & 0xff);
    else return line; // unexpected wide char: leave as-is
  }
  const rebuilt = Buffer.from(bytes).toString('utf8');
  // Only accept a clean, printable reconstruction (allow tab/newline).
  // eslint-disable-next-line no-control-regex
  if (/[^\t\n\r\x20-\x7e]/.test(rebuilt)) return line;
  return rebuilt;
}

/**
 * PalServer logs a line for every REST request it serves (e.g. "REST accessed
 * endpoint /v1/api/metrics OK"). The app itself polls /metrics every 2s and
 * probes /info while starting, so those lines flood the console with no value.
 * Filter out just those two background-probe endpoints; user-initiated calls
 * (announce/kick/ban/save/shutdown/players) still show as confirmation.
 */
function isRestPollingNoise(line: string): boolean {
  return /REST accessed endpoint \/v1\/api\/(metrics|info)\b/i.test(line);
}

class ServerManager extends EventEmitter {
  private child: ChildProcess | null = null;
  private status: ServerStatus = 'stopped';
  private intentionalStop = false;
  private startedAt: number | null = null;
  private playersRefreshTimer: NodeJS.Timeout | null = null;

  getStatus(): ServerStatus {
    if (!isInstalled() && this.status === 'stopped') return 'not-installed';
    return this.status;
  }
  getStartedAt(): number | null {
    return this.startedAt;
  }
  getPid(): number | null {
    return this.child?.pid ?? null;
  }

  private setStatus(s: ServerStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
  }
  private log(text: string, source: LogSource = 'system'): void {
    this.emit('log', makeLog(text, source));
  }

  /**
   * Split a captured stdout/stderr chunk into lines, repairing the mis-encoded
   * startup banner (which also hides an embedded newline), and emit each line.
   */
  private logServerChunk(chunk: string, source: LogSource): void {
    for (const raw of chunk.split(/\r?\n/)) {
      if (!raw) continue;
      const fixed = fixBannerMojibake(raw);
      for (const line of fixed.split(/\r?\n/)) {
        if (!line) continue;
        if (isRestPollingNoise(line)) continue; // drop our own /metrics,/info probe spam
        this.log(line, source);
        this.maybeRefreshPlayers(line);
      }
    }
  }

  /**
   * When a connection-related line appears in the server log, debounce a single
   * roster refresh (emit 'players-changed'). This updates the player list only
   * when someone actually joins/leaves — no timer polling.
   */
  private maybeRefreshPlayers(line: string): void {
    if (
      !/Join succeeded|Join request|AddPlayer|RemovePlayer|player.*(join|left|connect|disconnect)|UNetConnection.*Close|Close.*UNetConnection/i.test(
        line,
      )
    ) {
      return;
    }
    if (this.playersRefreshTimer) return; // a refresh is already scheduled
    this.playersRefreshTimer = setTimeout(() => {
      this.playersRefreshTimer = null;
      this.emit('players-changed');
    }, 1500);
  }

  // ------------------------------------------------------------------
  // Install / update via SteamCMD
  // ------------------------------------------------------------------
  private async ensureSteamCmd(): Promise<void> {
    if (fs.existsSync(steamCmdExe())) return;
    ensureDirs();
    const dir = defaultSteamCmdDir();
    fs.mkdirSync(dir, { recursive: true });
    this.log('SteamCMD をダウンロードしています...');
    const res = await fetch(STEAMCMD_URL, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`SteamCMD のダウンロードに失敗 (HTTP ${res.status})`);
    const zipPath = path.join(dir, 'steamcmd.zip');
    const reader = res.body.getReader();
    const node = new Readable({
      async read() {
        const { done, value } = await reader.read();
        if (done) return this.push(null);
        this.push(Buffer.from(value));
      },
    });
    await pipeline(node, fs.createWriteStream(zipPath));
    new AdmZip(zipPath).extractAllTo(dir, true);
    fs.rmSync(zipPath, { force: true });
    this.log('SteamCMD の準備が完了しました。');
  }

  /** Install or update the Palworld dedicated server. */
  async installOrUpdate(): Promise<StartResult> {
    if (this.child) return { ok: false, error: 'サーバー起動中は更新できません。先に停止してください。' };
    try {
      await this.ensureSteamCmd();
    } catch (err) {
      this.log((err as Error).message);
      this.setStatus('error');
      return { ok: false, error: (err as Error).message };
    }

    const target = serverDir();
    fs.mkdirSync(target, { recursive: true });
    this.setStatus(isInstalled() ? 'updating' : 'installing');
    this.log(`SteamCMD で Palworld専用サーバー (App ${PALWORLD_APPID}) を導入/更新します...`);

    return new Promise<StartResult>((resolve) => {
      const args = [
        '+force_install_dir', target,
        '+login', 'anonymous',
        '+app_update', PALWORLD_APPID, 'validate',
        '+quit',
      ];
      const cmd = spawn(steamCmdExe(), args, { windowsHide: true });
      cmd.stdout?.setEncoding('utf-8');
      cmd.stderr?.setEncoding('utf-8');
      cmd.stdout?.on('data', (d: string) => d.split(/\r?\n/).forEach((l) => l && this.log(l, 'steamcmd')));
      cmd.stderr?.on('data', (d: string) => d.split(/\r?\n/).forEach((l) => l && this.log(l, 'steamcmd')));
      cmd.on('exit', (code) => {
        if (code === 0 && isInstalled()) {
          this.seedConfig();
          this.setStatus('stopped');
          this.log('導入/更新が完了しました。');
          resolve({ ok: true });
        } else {
          this.setStatus('error');
          const msg = `SteamCMD が異常終了しました (code=${code}).`;
          this.log(msg);
          resolve({ ok: false, error: msg });
        }
      });
      cmd.on('error', (e) => {
        this.setStatus('error');
        this.log(`SteamCMD 実行エラー: ${e.message}`);
        resolve({ ok: false, error: e.message });
      });
    });
  }

  /** Copy DefaultPalWorldSettings.ini -> active config on first install. */
  private seedConfig(): void {
    try {
      if (!fs.existsSync(configFile()) && fs.existsSync(defaultConfigFile())) {
        fs.mkdirSync(path.dirname(configFile()), { recursive: true });
        fs.copyFileSync(defaultConfigFile(), configFile());
        this.log('初期設定ファイルを作成しました。');
      }
    } catch {
      /* non-fatal */
    }
  }

  /** Make sure the REST API is enabled in the config so we can control the server. */
  private ensureRestConfig(): void {
    const s = readSettings();
    if (s.restApiEnabled === false) return;
    try {
      const cfg = PalworldConfig.load();
      cfg.setBool('RESTAPIEnabled', true);
      cfg.setNumber('RESTAPIPort', s.restApiPort ?? 8212);
      if (s.adminPassword) cfg.setString('AdminPassword', s.adminPassword);
      cfg.save();
    } catch (e) {
      this.log(`REST API 設定の適用に失敗: ${(e as Error).message}`);
    }
  }

  // ------------------------------------------------------------------
  // Start / stop
  // ------------------------------------------------------------------
  start(): StartResult {
    if (this.child) return { ok: false, error: 'サーバーは既に起動しています。' };
    if (!isInstalled()) {
      const msg = 'サーバーが未インストールです。先に「インストール」を実行してください。';
      this.log(msg);
      return { ok: false, error: msg };
    }

    this.ensureRestConfig();
    // Launch the shipping executable directly when it exists. The PalServer.exe
    // launcher spawns the real server in a *new* console (CMD) window that our
    // flags can't suppress; running the shipping exe ourselves with
    // windowsHide keeps it hidden and gives us the real server PID.
    const shippingExe = path.join(serverDir(), 'Pal', 'Binaries', 'Win64', 'PalServer-Win64-Shipping.exe');
    const exe = fs.existsSync(shippingExe) ? shippingExe : palServerExe();
    const cwd = serverDir();
    const settings = readSettings();
    const userArgs = (settings.launchArgs ?? '').split(' ').filter(Boolean);
    const has = (list: string[], flag: string) => list.some((a) => a.toLowerCase() === flag.toLowerCase());
    const extra = [...userArgs];
    // Standard recommended performance trio for dedicated servers.
    if (settings.perfFlags !== false) {
      for (const f of ['-useperfthreads', '-NoAsyncLoadingThread', '-UseMultithreadForDS']) {
        if (!has(extra, f)) extra.push(f);
      }
    }
    // List the server on the in-game community browser.
    if (settings.publicLobby && !has(extra, '-publiclobby')) extra.push('-publiclobby');

    this.intentionalStop = false;
    this.setStatus('starting');
    this.log(`サーバーを起動します: ${exe}`);

    try {
      this.child = spawn(exe, extra, {
        cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.setStatus('error');
      this.child = null;
      return { ok: false, error: (err as Error).message };
    }

    this.child.stdout?.setEncoding('utf-8');
    this.child.stderr?.setEncoding('utf-8');
    this.child.stdout?.on('data', (d: string) => this.logServerChunk(d, 'stdout'));
    this.child.stderr?.on('data', (d: string) => this.logServerChunk(d, 'stderr'));
    this.child.on('error', (e) => {
      this.log(`プロセスエラー: ${e.message}`);
      this.setStatus('error');
    });
    this.child.on('exit', (code, signal) => this.onExit(code, signal));

    this.waitUntilReady();
    return { ok: true };
  }

  /** Poll the REST API until the server answers, then mark it running. */
  private waitUntilReady(): void {
    const s = readSettings();
    const deadline = Date.now() + 90_000;
    // No admin password: REST auth is impossible, so just wait a few seconds.
    if (s.restApiEnabled === false || !s.adminPassword) {
      setTimeout(() => {
        if (this.child && this.status === 'starting') {
          this.startedAt = Date.now();
          this.setStatus('running');
          this.log('サーバーが起動しました。');
        }
      }, 8000);
      return;
    }

    // Poll /info until it answers, or fall back after the deadline.
    const tick = async () => {
      if (!this.child || this.status !== 'starting') return;
      try {
        await rest.info(2500);
        this.startedAt = Date.now();
        this.setStatus('running');
        this.log('サーバーが起動しました。');
        return;
      } catch {
        /* not ready yet */
      }
      if (Date.now() > deadline) {
        if (this.child) {
          this.startedAt = Date.now();
          this.setStatus('running');
          this.log('サーバーが起動しました（REST未確認）。');
        }
        return;
      }
      setTimeout(tick, 3000);
    };
    setTimeout(tick, 3000);
  }

  async stop(): Promise<StartResult> {
    if (!this.child) return { ok: false, error: 'サーバーは起動していません。' };
    this.intentionalStop = true;
    this.setStatus('stopping');
    const s = readSettings();

    if (s.restApiEnabled !== false && s.adminPassword) {
      this.log('REST API 経由で安全に停止します...');
      try {
        await rest.save();
        await rest.shutdown(1, 'サーバーを停止します');
      } catch (e) {
        this.log(`安全な停止に失敗、強制停止を試みます: ${(e as Error).message}`);
        try {
          await rest.forceStop();
        } catch {
          /* fall through to force-kill */
        }
      }
    }
    // Force-kill safety net.
    setTimeout(() => {
      if (this.child) {
        this.log('時間内に停止しなかったため強制終了します。');
        this.child.kill();
      }
    }, 10_000);
    return { ok: true };
  }

  async restart(): Promise<StartResult> {
    if (this.child) {
      // Wait for the *stopped* status. stop() emits 'stopping' first, so a
      // one-shot listener would be consumed by that and never see 'stopped';
      // use a persistent listener that removes itself once the server is down.
      const onStatus = (st: ServerStatus) => {
        if (st === 'stopped') {
          this.off('status', onStatus);
          setTimeout(() => this.start(), 1000);
        }
      };
      this.on('status', onStatus);
      return this.stop();
    }
    return this.start();
  }

  private restReady(): StartResult | null {
    const s = readSettings();
    if (s.restApiEnabled === false || !s.adminPassword) {
      return { ok: false, error: 'REST API が無効か AdminPassword が未設定です。設定を確認してください。' };
    }
    return null;
  }

  /** Broadcast a message to everyone in-game (REST /announce). */
  async announce(message: string): Promise<StartResult> {
    const msg = message.trim();
    if (!msg) return { ok: false, error: '空のメッセージです。' };
    const bad = this.restReady();
    if (bad) return bad;
    try {
      await rest.announce(msg);
      this.log(`[announce] ${msg}`, 'rcon');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Kick a player by their REST userId (REST /kick). */
  async kickPlayer(userId: string): Promise<StartResult> {
    const id = userId.trim();
    if (!id) return { ok: false, error: 'ユーザーIDが空です。' };
    const bad = this.restReady();
    if (bad) return bad;
    try {
      await rest.kick(id);
      this.log(`[kick] ${id}`, 'rcon');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Ban a player by their REST userId (REST /ban). */
  async banPlayer(userId: string): Promise<StartResult> {
    const id = userId.trim();
    if (!id) return { ok: false, error: 'ユーザーIDが空です。' };
    const bad = this.restReady();
    if (bad) return bad;
    try {
      await rest.ban(id);
      this.log(`[ban] ${id}`, 'rcon');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Lift a ban by REST userId (REST /unban). */
  async unbanPlayer(userId: string): Promise<StartResult> {
    const id = userId.trim();
    if (!id) return { ok: false, error: 'ユーザーIDが空です。' };
    const bad = this.restReady();
    if (bad) return bad;
    try {
      await rest.unban(id);
      this.log(`[unban] ${id}`, 'rcon');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Save the world now (REST /save). */
  async saveWorld(): Promise<StartResult> {
    const bad = this.restReady();
    if (bad) return bad;
    try {
      await rest.save();
      this.log('[save] ワールドを保存しました。', 'rcon');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.child = null;
    this.startedAt = null;
    this.log(`サーバープロセスが終了しました (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);

    const crashed = !this.intentionalStop && code !== 0;
    if (crashed) {
      this.setStatus('error');
      if (readSettings().autoRestart) {
        this.log('自動再起動が有効です。再起動します...');
        setTimeout(() => this.start(), 1500);
      }
    } else {
      this.setStatus('stopped');
    }
    this.intentionalStop = false;
  }

  forceStop(): void {
    if (this.child) {
      this.intentionalStop = true;
      this.child.kill();
    }
  }

  /** Delete the installed Palworld server files (frees disk space). */
  async uninstall(): Promise<StartResult> {
    if (this.child) {
      return { ok: false, error: '起動中はアンインストールできません。先に停止してください。' };
    }
    try {
      fs.rmSync(serverDir(), { recursive: true, force: true });
      this.startedAt = null;
      this.setStatus('not-installed');
      this.log('サーバーをアンインストールしました。');
      return { ok: true };
    } catch (e) {
      this.log(`アンインストールに失敗: ${(e as Error).message}`);
      return { ok: false, error: (e as Error).message };
    }
  }

  /** Delete just the world/save data (keeps the server install intact). */
  deleteWorldData(): StartResult {
    if (this.child) {
      return { ok: false, error: '起動中はワールドを削除できません。先に停止してください。' };
    }
    try {
      const dir = saveDir();
      if (!fs.existsSync(dir)) {
        this.log('削除対象のワールドデータが見つかりませんでした。');
        return { ok: true };
      }
      fs.rmSync(dir, { recursive: true, force: true });
      this.log('ワールドデータ（セーブ）を削除しました。次回の起動で新しいワールドが作成されます。');
      return { ok: true };
    } catch (e) {
      this.log(`ワールド削除に失敗: ${(e as Error).message}`);
      return { ok: false, error: (e as Error).message };
    }
  }
}

export const serverManager = new ServerManager();
