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

// ---- scheduler ----
export type ScheduleAction = 'start' | 'stop' | 'restart' | 'backup';

export interface ScheduleEntry {
  id: string;
  enabled: boolean;
  days: number[]; // 0=Sun .. 6=Sat
  time: string; // "HH:MM" (local)
  action: ScheduleAction;
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

  getLanAddress(): Promise<string>;
  openExternal(url: string): Promise<void>;

  onLog(cb: (l: LogLine) => void): () => void;
  onStatus(cb: (s: ServerStatus) => void): () => void;
  onMetrics(cb: (m: SystemMetrics) => void): () => void;
  onPlayitStatus(cb: (s: PlayitStatus) => void): () => void;
}
