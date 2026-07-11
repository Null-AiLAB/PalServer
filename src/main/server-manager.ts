// Palworld dedicated server lifecycle: install/update via SteamCMD, launch
// PalServer, and stop it gracefully over RCON.
//
// This replaces bedrock-server-manager's downloader.ts + server-manager.ts.
// Key differences vs Bedrock:
//   - Install: SteamCMD `app_update 2394010`, not a direct ZIP download.
//   - Stop/commands: RCON, because PalServer does not read stdin commands.
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
import { rconCommand } from './rcon';

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

class ServerManager extends EventEmitter {
  private child: ChildProcess | null = null;
  private status: ServerStatus = 'stopped';
  private intentionalStop = false;
  private startedAt: number | null = null;

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
        if (line) this.log(line, source);
      }
    }
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

  /** Make sure RCON is enabled in the config so we can control the server. */
  private ensureRconConfig(): void {
    const s = readSettings();
    if (!s.rconEnabled) return;
    try {
      const cfg = PalworldConfig.load();
      cfg.setBool('RCONEnabled', true);
      cfg.setNumber('RCONPort', s.rconPort ?? 25575);
      if (s.adminPassword) cfg.setString('AdminPassword', s.adminPassword);
      cfg.save();
    } catch (e) {
      this.log(`RCON設定の適用に失敗: ${(e as Error).message}`);
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

    this.ensureRconConfig();
    // Launch the shipping executable directly when it exists. The PalServer.exe
    // launcher spawns the real server in a *new* console (CMD) window that our
    // flags can't suppress; running the shipping exe ourselves with
    // windowsHide keeps it hidden and gives us the real server PID.
    const shippingExe = path.join(serverDir(), 'Pal', 'Binaries', 'Win64', 'PalServer-Win64-Shipping.exe');
    const exe = fs.existsSync(shippingExe) ? shippingExe : palServerExe();
    const cwd = serverDir();
    const settings = readSettings();
    const userArgs = (settings.launchArgs ?? '').split(' ').filter(Boolean);
    // Standard recommended performance trio for dedicated servers.
    const PERF_FLAGS = ['-useperfthreads', '-NoAsyncLoadingThread', '-UseMultithreadForDS'];
    const extra =
      settings.perfFlags === false
        ? userArgs
        : [...userArgs, ...PERF_FLAGS.filter((f) => !userArgs.some((a) => a.toLowerCase() === f.toLowerCase()))];

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

  /** Poll RCON until the server answers, then mark it running. */
  private waitUntilReady(): void {
    const s = readSettings();
    const deadline = Date.now() + 90_000;
    // RCON disabled: no reliable readiness probe, so wait a few seconds.
    if (!s.rconEnabled || !s.adminPassword) {
      setTimeout(() => {
        if (this.child && this.status === 'starting') {
          this.startedAt = Date.now();
          this.setStatus('running');
          this.log('サーバーが起動しました。');
        }
      }, 8000);
      return;
    }

    // RCON enabled: poll Info until it answers, or fall back after the deadline.
    const tick = async () => {
      if (!this.child || this.status !== 'starting') return;
      try {
        await rconCommand(
          { port: s.rconPort ?? 25575, password: s.adminPassword!, timeoutMs: 2500 },
          'Info',
        );
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
          this.log('サーバーが起動しました（RCON未確認）。');
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

    if (s.rconEnabled && s.adminPassword) {
      this.log('RCON経由で安全に停止します...');
      try {
        await rconCommand(
          { port: s.rconPort ?? 25575, password: s.adminPassword },
          'Save',
        );
        await rconCommand(
          { port: s.rconPort ?? 25575, password: s.adminPassword },
          'Shutdown 1 Server_is_shutting_down',
        );
      } catch (e) {
        this.log(`RCON停止に失敗、強制終了します: ${(e as Error).message}`);
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
      this.once('status', (s: ServerStatus) => {
        if (s === 'stopped') setTimeout(() => this.start(), 1000);
      });
      return this.stop();
    }
    return this.start();
  }

  /** Send an arbitrary RCON command (e.g. ShowPlayers, Broadcast Hi). */
  async sendCommand(command: string): Promise<StartResult> {
    const cmd = command.trim();
    if (!cmd) return { ok: false, error: '空のコマンドです。' };
    const s = readSettings();
    if (!s.rconEnabled || !s.adminPassword) {
      return { ok: false, error: 'RCONが無効です。設定でRCONとAdminPasswordを有効にしてください。' };
    }
    try {
      const out = await rconCommand({ port: s.rconPort ?? 25575, password: s.adminPassword }, cmd);
      this.log(`> ${cmd}`, 'rcon');
      if (out.trim()) this.log(out.trim(), 'rcon');
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
