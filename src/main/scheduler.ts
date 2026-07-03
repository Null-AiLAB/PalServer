// Simple time-based scheduler: fires start/stop/restart/backup actions on the
// configured days + local time. Adapted in spirit from bedrock-server-manager's
// scheduler (MIT, (c) 2026 yuzum).

import type { ScheduleAction, ScheduleEntry } from '../shared/types';
import { serverManager } from './server-manager';
import { createBackup } from './backup-manager';
import { readSettings, writeSettings } from './settings';

let timer: NodeJS.Timeout | null = null;
/** Per-entry last-fired minute key, so an action runs at most once per minute. */
const lastFired = new Map<string, string>();

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

function tick(): void {
  const now = new Date();
  const day = now.getDay();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const hhmm = `${hh}:${mm}`;
  const minuteKey = `${now.toDateString()} ${hhmm}`;

  for (const e of readSettings().schedule ?? []) {
    if (!e.enabled) continue;
    if (!e.days.includes(day)) continue;
    if (e.time !== hhmm) continue;
    if (lastFired.get(e.id) === minuteKey) continue;
    lastFired.set(e.id, minuteKey);
    runAction(e.action);
  }
}

export function startScheduler(): void {
  if (timer) return;
  timer = setInterval(tick, 30_000); // 30s cadence catches every minute boundary
  tick();
}

export function getSchedule(): ScheduleEntry[] {
  return readSettings().schedule ?? [];
}

export function setSchedule(entries: ScheduleEntry[]): ScheduleEntry[] {
  writeSettings({ schedule: entries });
  return entries;
}
