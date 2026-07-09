// IPC wiring: exposes main-process managers to the renderer and forwards events.
// Adapted from bedrock-server-manager/src/main/ipc.ts (MIT, (c) 2026 yuzum).

import { ipcMain, shell, app, type BrowserWindow } from 'electron';
import os from 'node:os';
import fs from 'node:fs';
import type { AppSettings, PalOptions, PlayerInfo } from '../shared/types';
import { serverManager } from './server-manager';
import { playitManager } from './playit-manager';
import { PalworldConfig, readRawConfig, writeRawConfig } from './palworld-config';
import { readSettings, writeSettings } from './settings';
import { isInstalled, serverDir } from './paths';
import { checkForUpdates, downloadUpdate, quitAndInstall } from './updater';
import {
  getState as getModState,
  setApiKey as setModApiKey,
  searchMods,
  installMod,
  uninstallMod,
  setEnabled as setModEnabled,
  installFramework,
  readModConfig,
  writeModConfig,
  exportClientPack,
} from './mod-manager';
import type { ModFramework } from '../shared/types';
import { rconCommand } from './rcon';
import { sampleMetrics } from './metrics';
import { listBackups, createBackup, restoreBackup, openBackupsFolder } from './backup-manager';
import { getSchedule, setSchedule } from './scheduler';
import { appendLog, openLogsFolder } from './logger';
import type { ScheduleEntry } from '../shared/types';

type GetWindow = () => BrowserWindow | null;

function lanAddress(): string {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const ni of ifs[name] ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return '127.0.0.1';
}

/** Palworld's ShowPlayers returns CSV lines: name,playeruid,steamid (with header). */
function parsePlayers(raw: string): PlayerInfo[] {
  const out: PlayerInfo[] = [];
  for (const line of raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    if (/^name\s*,/i.test(line)) continue;
    const [name, playerId, steamId] = line.split(',');
    if (name) out.push({ name, playerId, steamId });
  }
  return out;
}

export function registerIpc(getWindow: GetWindow): void {
  const send = (channel: string, payload: unknown) => {
    getWindow()?.webContents.send(channel, payload);
  };

  serverManager.on('log', (l) => {
    send('server:log', l);
    appendLog(l);
  });
  serverManager.on('status', (s) => {
    send('server:status', s);
    const st = readSettings();
    if (st.playitAutoStart && st.playitSecret) {
      if (s === 'starting') void playitManager.enable();
      else if (s === 'stopped' || s === 'not-installed' || s === 'error') playitManager.disable();
    }
  });
  playitManager.on('status', (s) => send('playit:status', s));

  setInterval(() => {
    void sampleMetrics().then((m) => send('system:metrics', m));
  }, 2000);

  // lifecycle
  ipcMain.handle('server:status', () => serverManager.getStatus());
  ipcMain.handle('server:start', () => serverManager.start());
  ipcMain.handle('server:stop', () => serverManager.stop());
  ipcMain.handle('server:restart', () => serverManager.restart());
  ipcMain.handle('server:command', (_e, command: string) => serverManager.sendCommand(command));

  // install / update
  ipcMain.handle('setup:installOrUpdate', () => serverManager.installOrUpdate());
  ipcMain.handle('setup:getInstallState', () => ({ installed: isInstalled() }));
  ipcMain.handle('setup:uninstall', () => serverManager.uninstall());

  // config (PalWorldSettings.ini)
  ipcMain.handle('config:get', () => PalworldConfig.load().toObject());
  ipcMain.handle('config:set', (_e, patch: PalOptions) => {
    try {
      const cfg = PalworldConfig.load();
      cfg.apply(patch);
      cfg.save();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  // app settings
  ipcMain.handle('settings:get', () => readSettings());
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => writeSettings(patch));

  // raw ini editing
  ipcMain.handle('config:getRaw', () => readRawConfig());
  ipcMain.handle('config:setRaw', (_e, text: string) => {
    try {
      writeRawConfig(text);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  // backups
  ipcMain.handle('backup:list', () => listBackups());
  ipcMain.handle('backup:create', () => createBackup());
  ipcMain.handle('backup:restore', (_e, id: string) => restoreBackup(id));
  ipcMain.handle('backup:openFolder', () => openBackupsFolder());

  // players via RCON
  ipcMain.handle('player:show', async () => {
    const s = readSettings();
    if (!s.rconEnabled || !s.adminPassword) return [];
    try {
      const out = await rconCommand(
        { port: s.rconPort ?? 25575, password: s.adminPassword },
        'ShowPlayers',
      );
      return parsePlayers(out);
    } catch {
      return [];
    }
  });

  // playit.gg
  ipcMain.handle('playit:status', () => playitManager.getStatus());
  ipcMain.handle('playit:enable', () => playitManager.enable());
  ipcMain.handle('playit:disable', () => playitManager.disable());
  ipcMain.handle('playit:setSecret', (_e, secret: string) => playitManager.setSecret(secret));
  ipcMain.handle('playit:setAddress', (_e, address: string) => playitManager.setAddress(address));

  // scheduler
  ipcMain.handle('schedule:get', () => getSchedule());
  ipcMain.handle('schedule:set', (_e, entries: ScheduleEntry[]) => setSchedule(entries));

  // logs
  ipcMain.handle('log:openFolder', () => openLogsFolder());

  // open the server files folder
  ipcMain.handle('system:openServerFolder', () => {
    const dir = serverDir();
    fs.mkdirSync(dir, { recursive: true });
    return shell.openPath(dir);
  });

  // misc
  ipcMain.handle('system:lanAddress', () => lanAddress());
  ipcMain.handle('app:openExternal', (_e, url: string) => shell.openExternal(url));

  // in-app updates
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('update:check', () => checkForUpdates());
  ipcMain.handle('update:download', () => downloadUpdate());
  ipcMain.handle('update:install', () => quitAndInstall());

  // mods
  ipcMain.handle('mods:state', () => getModState());
  ipcMain.handle('mods:setKey', (_e, key: string) => setModApiKey(key));
  ipcMain.handle('mods:search', (_e, query: string, serverOnly: boolean) => searchMods(query, serverOnly));
  ipcMain.handle('mods:install', (_e, id: number) => installMod(id));
  ipcMain.handle('mods:uninstall', (_e, id: number) => uninstallMod(id));
  ipcMain.handle('mods:setEnabled', (_e, id: number, enabled: boolean) => setModEnabled(id, enabled));
  ipcMain.handle('mods:framework', (_e, which: ModFramework) => installFramework(which));
  ipcMain.handle('mods:readConfig', (_e, relPath: string) => readModConfig(relPath));
  ipcMain.handle('mods:writeConfig', (_e, relPath: string, text: string) => writeModConfig(relPath, text));
  ipcMain.handle('mods:exportClient', () => {
    const res = exportClientPack();
    if (res.ok && res.warning) void shell.showItemInFolder(res.warning);
    return res;
  });
}
