// Time-based scheduler: fires start/stop/restart/backup on the configured days +
// local time, and (optionally) announces the upcoming action in-game beforehand:
//   - minute warnings:  "サーバーは5分後に自動で再起動されます。"
//   - second countdown: "サーバー再起動まであと10秒" -> "9…" -> "8…" ...
// Announcements are Broadcasts, so they only reach players while the server runs.
// Adapted in spirit from bedrock-server-manager's scheduler (MIT, (c) 2026 yuzum).

import type { ScheduleAction, ScheduleEntry } from '../shared/types';
import { serverManager } from './server-manager';
import { createBackup } from './backup-manager';
import { readSettings, writeSettings } from './settings';

let timer: NodeJS.Timeout | null = null;
let cache: ScheduleEntry[] = [];

// De-dupe map: event key -> occurrence target epoch (ms). Pruned once it passes.
const fired = new Map<string, number>();

function actionNoun(a: ScheduleAction): string {
  switch (a) {
    case 'restart':
      return '再起動';
    case 'stop':
      return 'シャットダウン';
    case 'backup':
      return 'バックアップ';
    default:
      return '起動';
  }
}

function broadcast(text: string): void {
  // Palworld's Broadcast breaks on spaces; JP text has none but stay safe.
  const msg = text.trim().replace(/\s+/g, '_');
  if (msg) void serverManager.sendCommand(`Broadcast ${msg}`);
}

function runAction(action: ScheduleAction): void {
  switch (action) {
    case 'start':
      serverManager.start();
      break;
    case 'stop':
      void serverManager.stop();
      break;
    case 'restart':
      void serverManager.restart();
      break;
    case 'backup':
      createBackup();
      break;
  }
}

function fireOnce(key: string, target: number, fn: () => void): void {
  if (fired.get(key) === target) return;
  fired.set(key, target);
  fn();
}

function tick(): void {
  const now = Date.now();
  const d = new Date(now);
  const dow = d.getDay();

  for (const e of cache) {
    if (!e.enabled) continue;
    if (!e.days.includes(dow)) continue;
    const [hh, mm] = e.time.split(':').map(Number);
    if (Number.isNaN(hh) || Number.isNaN(mm)) continue;

    const target = new Date(d);
    target.setHours(hh, mm, 0, 0);
    const targetMs = target.getTime();
    const deltaSec = Math.round((targetMs - now) / 1000);
    const occ = `${e.id}:${targetMs}`;

    // Minute-before warnings.
    for (const w of e.warnMinutes ?? []) {
      if (w > 0 && deltaSec === w * 60) {
        fireOnce(`${occ}:warn:${w}`, targetMs, () =>
          broadcast(`サーバーは${w}分後に自動で${actionNoun(e.action)}されます。`),
        );
      }
    }

    // Second-before countdown: lead line at N, then "M…" each second down to 1.
    const cd = e.countdownSec ?? 0;
    if (cd > 0) {
      if (deltaSec === cd) {
        fireOnce(`${occ}:cdlead`, targetMs, () =>
          broadcast(`サーバー${actionNoun(e.action)}まであと${cd}秒`),
        );
      }
      if (deltaSec >= 1 && deltaSec <= cd - 1) {
        fireOnce(`${occ}:cd:${deltaSec}`, targetMs, () => broadcast(`${deltaSec}…`));
      }
    }

    // The action itself.
    if (deltaSec === 0) {
      fireOnce(`${occ}:action`, targetMs, () => runAction(e.action));
    }
  }

  // Prune stale de-dupe keys (2 minutes after their occurrence).
  for (const [k, t] of fired) {
    if (t < now - 120_000) fired.delete(k);
  }
}

export function startScheduler(): void {
  if (timer) return;
  cache = readSettings().schedule ?? [];
  timer = setInterval(tick, 1000);
  tick();
}

export function getSchedule(): ScheduleEntry[] {
  return readSettings().schedule ?? [];
}

export function setSchedule(entries: ScheduleEntry[]): ScheduleEntry[] {
  writeSettings({ schedule: entries });
  cache = entries;
  return entries;
}
