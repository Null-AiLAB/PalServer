// Shared types for Palworld Server Manager (main <-> renderer).
// Adapted from bedrock-server-manager (MIT, Copyright (c) 2026 yuzum).

export type ServerStatus =
  | 'not-installed'
  | 'installing'
  | 'updating'
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error';

export type LogSource = 'stdout' | 'stderr' | 'system' | 'steamcmd' | 'rcon';
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogLine {
  id: number;
  ts: number;
  level: LogLevel;
  source: LogSource;
  text: string;
}

export interface StartResult {
  ok: boolean;
  error?: string;
}

export type PalOptionValue = string | number | boolean;
export type PalOptions = Record<string, PalOptionValue>;

export interface PlayerInfo {
  name: string;
  playerId?: string;
  steamId?: string;
}

export interface BackupInfo {
  id: string;
  name: string;
  ts: number;
  size: number;
}

export interface SystemMetrics {
  running: boolean;
  cpu: number; // percent
  memory: number; // bytes
  uptime: number; // ms since started
}

export interface InstallState {
  installed: boolean;
}

// ---- in-app updates (electron-updater) ----
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateStatus {
  state: UpdateState;
  currentVersion?: string;
  version?: string; // available / downloaded version
  percent?: number; // download progress (0-100)
  message?: string; // error message
}

// ---- mods (CurseForge browser + installer) ----
export type ModInstallType = 'pak' | 'logicmods' | 'ue4ss' | 'ue4ss-lua' | 'palschema' | 'unknown';

/** A search result from the catalog (CurseForge). */
export interface ModSearchItem {
  id: number;
  name: string;
  summary: string;
  author: string;
  downloadCount: number;
  dateModified: string;
  logoUrl?: string;
  websiteUrl?: string;
  categories: string[];
  gameVersions: string[];
  latestFileId?: number;
  latestFileName?: string;
  /** best-effort: does the catalog hint this works on a dedicated server? */
  serverHint: 'yes' | 'maybe' | 'client-only';
}

/** A mod we've installed on the server. */
export interface InstalledMod {
  id: number; // CurseForge mod id
  packageName: string; // from Info.json; used in ActiveModList
  name: string;
  version: string;
  installType: ModInstallType;
  enabled: boolean;
  isServer: boolean;
  clientRequired: boolean;
  files: string[]; // installed paths, relative to the server root
  configFiles: string[]; // editable config paths, relative to the server root
  installedAt: number;
}

export type ModFramework = 'ue4ss' | 'palschema';

export interface ModManagerState {
  hasApiKey: boolean;
  frameworks: { ue4ss: boolean; palSchema: boolean };
  installed: InstalledMod[];
}

export interface ModActionResult {
  ok: boolean;
  error?: string;
  warning?: string;
}

// ---- scheduler ----
export type ScheduleAction = 'start' | 'stop' | 'restart' | 'backup';

export interface ScheduleEntry {
  id: string;
  enabled: boolean;
  days: number[]; // 0=Sun .. 6=Sat
  time: string; // "HH:MM" (local)
  action: ScheduleAction;
  warnMinutes?: number[]; // e.g. [5,1] -> "N分後に…" を各タイミングで送信
  countdownSec?: number; // 例: 10 -> 実行N秒前から秒読み。0/未設定でオフ
}

// ---- playit.gg ----
export type PlayitState =
  | 'disabled'
  | 'needs-secret'
  | 'installing'
  | 'starting'
  | 'connected'
  | 'error';

export interface PlayitStatus {
  state: PlayitState;
  installed: boolean;
  hasSecret: boolean;
  tunnelAddress?: string;
  message?: string;
}

// ---- persisted app settings ----
export interface AppSettings {
  serverDir?: string;
  steamCmdDir?: string;
  launchArgs?: string;
  autoRestart?: boolean;
  rconEnabled?: boolean;
  rconPort?: number;
  adminPassword?: string;
  playitSecret?: string;
  playitTunnelAddress?: string;
  playitAutoStart?: boolean;
  schedule?: ScheduleEntry[];
  setupComplete?: boolean;
  curseforgeApiKey?: string;
  installedMods?: InstalledMod[];
}

// ---- preload API surface (window.api) ----
export interface AppApi {
  getStatus(): Promise<ServerStatus>;
  start(): Promise<StartResult>;
  stop(): Promise<StartResult>;
  restart(): Promise<StartResult>;
  sendCommand(command: string): Promise<StartResult>;

  installOrUpdate(): Promise<StartResult>;
  getInstallState(): Promise<InstallState>;
  uninstallServer(): Promise<StartResult>;

  getConfig(): Promise<PalOptions>;
  setConfig(patch: PalOptions): Promise<StartResult>;
  getConfigRaw(): Promise<string>;
  setConfigRaw(text: string): Promise<StartResult>;

  getSettings(): Promise<AppSettings>;
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;

  listBackups(): Promise<BackupInfo[]>;
  createBackup(): Promise<StartResult>;
  restoreBackup(id: string): Promise<StartResult>;
  openBackupsFolder(): Promise<void>;

  showPlayers(): Promise<PlayerInfo[]>;

  getPlayitStatus(): Promise<PlayitStatus>;
  enablePlayit(): Promise<PlayitStatus>;
  disablePlayit(): Promise<PlayitStatus>;
  setPlayitSecret(secret: string): Promise<PlayitStatus>;
  setPlayitAddress(address: string): Promise<PlayitStatus>;

  getSchedule(): Promise<ScheduleEntry[]>;
  setSchedule(entries: ScheduleEntry[]): Promise<ScheduleEntry[]>;

  openLogsFolder(): Promise<void>;
  openServerFolder(): Promise<string>;

  getLanAddress(): Promise<string>;
  openExternal(url: string): Promise<void>;

  getAppVersion(): Promise<string>;
  checkForUpdates(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<UpdateStatus>;
  quitAndInstall(): Promise<void>;

  // mods
  getModState(): Promise<ModManagerState>;
  setCurseforgeKey(key: string): Promise<ModManagerState>;
  searchMods(query: string, serverOnly: boolean): Promise<ModSearchItem[]>;
  installMod(id: number): Promise<ModActionResult>;
  uninstallMod(id: number): Promise<ModActionResult>;
  setModEnabled(id: number, enabled: boolean): Promise<ModActionResult>;
  installFramework(which: ModFramework): Promise<ModActionResult>;
  readModConfig(relPath: string): Promise<string>;
  writeModConfig(relPath: string, text: string): Promise<ModActionResult>;
  exportClientPack(): Promise<ModActionResult>;

  onLog(cb: (l: LogLine) => void): () => void;
  onStatus(cb: (s: ServerStatus) => void): () => void;
  onMetrics(cb: (m: SystemMetrics) => void): () => void;
  onPlayitStatus(cb: (s: PlayitStatus) => void): () => void;
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void;
}
