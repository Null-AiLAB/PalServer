// Filesystem locations for Palworld Server Manager.
// Adapted from bedrock-server-manager/src/main/paths.ts (MIT, (c) 2026 yuzum).

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { readSettings } from './settings';

/** Root data folder inside the user's app data (persists across updates). */
export function dataDir(): string {
  return path.join(app.getPath('userData'), 'data');
}

/** Downloaded helper binaries (SteamCMD, playit). */
export function binDir(): string {
  return path.join(dataDir(), 'bin');
}

/** Default SteamCMD folder. */
export function defaultSteamCmdDir(): string {
  return path.join(binDir(), 'steamcmd');
}

/** Path to steamcmd.exe (Windows). */
export function steamCmdExe(): string {
  const dir = readSettings().steamCmdDir || defaultSteamCmdDir();
  return path.join(dir, process.platform === 'win32' ? 'steamcmd.exe' : 'steamcmd.sh');
}

/** Default install folder for the Palworld dedicated server. */
export function defaultServerDir(): string {
  return path.join(dataDir(), 'PalServer');
}

export function serverDir(): string {
  return readSettings().serverDir || defaultServerDir();
}

/** Path to the server executable. */
export function palServerExe(): string {
  return path.join(serverDir(), process.platform === 'win32' ? 'PalServer.exe' : 'PalServer.sh');
}

/** Active config file (the one the server actually reads). */
export function configFile(): string {
  return path.join(serverDir(), 'Pal', 'Saved', 'Config', 'WindowsServer', 'PalWorldSettings.ini');
}

/** The default/template config shipped with the server. */
export function defaultConfigFile(): string {
  return path.join(serverDir(), 'DefaultPalWorldSettings.ini');
}

/** The save data folder (used for backups). */
export function saveDir(): string {
  return path.join(serverDir(), 'Pal', 'Saved', 'SaveGames');
}

export function isInstalled(): boolean {
  return fs.existsSync(palServerExe());
}

export function ensureDirs(): void {
  for (const d of [dataDir(), binDir()]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
