// Persisted app settings (JSON in userData).
// Adapted from bedrock-server-manager/src/main/settings.ts (MIT, (c) 2026 yuzum).

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AppSettings } from '../shared/types';

const DEFAULTS: AppSettings = {
  autoRestart: false,
  perfFlags: true,
  restApiEnabled: true,
  restApiPort: 8212,
};

function file(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

let cache: AppSettings | null = null;

export function readSettings(): AppSettings {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf-8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache!;
}

export function writeSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...readSettings(), ...patch };
  cache = next;
  try {
    fs.writeFileSync(file(), JSON.stringify(next, null, 2), 'utf-8');
  } catch {
    /* best effort */
  }
  return next;
}
