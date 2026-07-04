// Append server log lines to a daily file, and open the logs folder.
// Adapted in spirit from bedrock-server-manager (MIT, (c) 2026 yuzum).

import { app, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { LogLine } from '../shared/types';

function logsDir(): string {
  const d = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

let stream: fs.WriteStream | null = null;
let streamDate = '';

function fileFor(date: string): string {
  return path.join(logsDir(), `server-${date}.log`);
}

export function appendLog(line: LogLine): void {
  try {
    const date = new Date(line.ts).toISOString().slice(0, 10);
    if (!stream || streamDate !== date) {
      stream?.end();
      stream = fs.createWriteStream(fileFor(date), { flags: 'a' });
      streamDate = date;
    }
    stream.write(`[${new Date(line.ts).toISOString()}] [${line.source}] ${line.text}\n`);
  } catch {
    /* best effort */
  }
}

export function openLogsFolder(): void {
  void shell.openPath(logsDir());
}
