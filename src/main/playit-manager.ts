// playit.gg agent manager. The tunnel itself is configured on the playit.gg
// dashboard to point at 127.0.0.1:8211 (UDP) for Palworld. This module just
// downloads the agent and runs `playit --secret <key>`, then detects the
// assigned public address from its output.
//
// Adapted from bedrock-server-manager/src/main/playit-manager.ts
// (MIT, Copyright (c) 2026 yuzum).

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { PlayitState, PlayitStatus } from '../shared/types';
import { binDir, ensureDirs } from './paths';
import { readSettings, writeSettings } from './settings';

function playitAssetName(): string {
  return process.platform === 'win32'
    ? 'playit-windows-x86_64-signed.exe'
    : 'playit-linux-amd64';
}
function playitBinaryName(): string {
  return process.platform === 'win32' ? 'playit.exe' : 'playit';
}
function playitDownloadUrl(): string {
  return `https://github.com/playit-cloud/playit-agent/releases/latest/download/${playitAssetName()}`;
}

const TUNNEL_RE = /\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:ply\.gg|playit\.gg))(?::(\d+))?\b/i;

class PlayitManager extends EventEmitter {
  private child: ChildProcess | null = null;
  private state: PlayitState = 'disabled';
  private detectedAddress?: string;
  private message?: string;
  private buf = '';

  exePath(): string {
    return path.join(binDir(), playitBinaryName());
  }
  isInstalled(): boolean {
    return fs.existsSync(this.exePath());
  }
  private hasSecret(): boolean {
    return !!readSettings().playitSecret;
  }

  getStatus(): PlayitStatus {
    return {
      state: this.state,
      installed: this.isInstalled(),
      hasSecret: this.hasSecret(),
      tunnelAddress: this.detectedAddress ?? readSettings().playitTunnelAddress,
      message: this.message,
    };
  }
  private setState(state: PlayitState, message?: string): void {
    this.state = state;
    this.message = message;
    this.emit('status', this.getStatus());
  }

  setSecret(secret: string): PlayitStatus {
    writeSettings({ playitSecret: secret.trim() });
    this.setState(this.state === 'connected' ? this.state : 'disabled', 'シークレットを保存しました。');
    return this.getStatus();
  }
  setAddress(address: string): PlayitStatus {
    writeSettings({ playitTunnelAddress: address.trim() });
    this.emit('status', this.getStatus());
    return this.getStatus();
  }

  private async ensureInstalled(): Promise<void> {
    if (this.isInstalled()) return;
    ensureDirs();
    fs.mkdirSync(binDir(), { recursive: true });
    this.setState('installing', 'playit エージェントをダウンロードしています...');
    const res = await fetch(playitDownloadUrl(), { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`playit のダウンロードに失敗 (HTTP ${res.status})`);
    const tmp = this.exePath() + '.download';
    const reader = res.body.getReader();
    const node = new Readable({
      async read() {
        const { done, value } = await reader.read();
        if (done) return this.push(null);
        this.push(Buffer.from(value));
      },
    });
    await pipeline(node, fs.createWriteStream(tmp));
    fs.renameSync(tmp, this.exePath());
    if (process.platform !== 'win32') fs.chmodSync(this.exePath(), 0o755);
  }

  async enable(): Promise<PlayitStatus> {
    if (this.child) return this.getStatus();
    const secret = readSettings().playitSecret;
    if (!secret) {
      this.setState('needs-secret', 'playit.gg のシークレットキーを設定してください。');
      return this.getStatus();
    }
    try {
      await this.ensureInstalled();
    } catch (err) {
      this.setState('error', (err as Error).message);
      return this.getStatus();
    }

    this.detectedAddress = undefined;
    this.setState('starting', 'playit エージェントを起動しています...');
    try {
      this.child = spawn(this.exePath(), ['--secret', secret], { windowsHide: true });
    } catch (err) {
      this.setState('error', `起動に失敗: ${(err as Error).message}`);
      this.child = null;
      return this.getStatus();
    }
    this.child.stdout?.setEncoding('utf-8');
    this.child.stderr?.setEncoding('utf-8');
    this.child.stdout?.on('data', (c: string) => this.onData(c));
    this.child.stderr?.on('data', (c: string) => this.onData(c));
    this.child.on('error', (e) => this.setState('error', e.message));
    this.child.on('exit', () => {
      this.child = null;
      if (this.state !== 'disabled') this.setState('disabled', 'playit エージェントが終了しました。');
    });
    return this.getStatus();
  }

  disable(): PlayitStatus {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    this.detectedAddress = undefined;
    this.setState('disabled');
    return this.getStatus();
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    const lines = this.buf.split(/\r?\n/);
    this.buf = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) this.parseLine(line);
  }
  private parseLine(line: string): void {
    if (/InvalidAgentKey|Failed to create agent|Setup error/i.test(line)) {
      const auth = /InvalidAgentKey/i.test(line);
      this.setState('error', auth ? 'シークレットキーが無効です。' : line.trim());
      return;
    }
    const tunnel = line.match(TUNNEL_RE);
    if (tunnel) {
      this.detectedAddress = tunnel[2] ? `${tunnel[1]}:${tunnel[2]}` : tunnel[1];
      this.setState('connected', '外部接続が有効です。');
      return;
    }
    if (/authenticated|tunnel.*(running|established|connected)|session established/i.test(line)) {
      if (this.state !== 'connected') this.setState('connected', '外部接続が有効です。');
    }
  }

  forceStop(): void {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }
}

export const playitManager = new PlayitManager();
