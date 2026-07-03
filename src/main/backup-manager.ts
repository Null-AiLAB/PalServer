// Backup/restore of the Palworld save folder (SaveGames).
// Replaces bedrock-server-manager's world-based backups with a save-folder zip.
// Adapted from bedrock-server-manager (MIT, (c) 2026 yuzum).

import { app, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { BackupInfo, StartResult } from '../shared/types';
import { saveDir } from './paths';

function backupsDir(): string {
  const d = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function listBackups(): BackupInfo[] {
  const dir = backupsDir();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.zip'))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { id: f, name: f.replace(/\.zip$/, ''), ts: st.mtimeMs, size: st.size };
    })
    .sort((a, b) => b.ts - a.ts);
}

export function createBackup(): StartResult {
  try {
    const src = saveDir();
    if (!fs.existsSync(src)) return { ok: false, error: 'セーブデータが見つかりません。' };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zip = new AdmZip();
    zip.addLocalFolder(src);
    zip.writeZip(path.join(backupsDir(), `save-${stamp}.zip`));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function restoreBackup(id: string): StartResult {
  try {
    const file = path.join(backupsDir(), id);
    if (!fs.existsSync(file)) return { ok: false, error: 'バックアップが見つかりません。' };
    const dest = saveDir();
    fs.mkdirSync(dest, { recursive: true });
    new AdmZip(file).extractAllTo(dest, true);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function openBackupsFolder(): void {
  void shell.openPath(backupsDir());
}
