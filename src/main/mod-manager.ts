// Mod manager: browse CurseForge, install/enable/disable/uninstall mods into the
// official Palworld mod layout, edit mod configs, and export a client pack.
//
// NOTE: Palworld's mod system + third-party archives vary a lot in the wild, so
// installation is best-effort and benefits from real-server testing. We keep our
// own authoritative record of installed mods in settings.json regardless, and we
// only *edit* the ActiveModList inside a server-generated PalModSettings.ini
// (rather than authoring it blindly) to avoid corrupting the official format.

import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type {
  InstalledMod,
  ModActionResult,
  ModFramework,
  ModInstallType,
  ModManagerState,
  ModSearchItem,
} from '../shared/types';
import { readSettings, writeSettings } from './settings';
import {
  logicModsDir,
  modCacheDir,
  modSettingsIni,
  modsRootDir,
  palSchemaModsDir,
  serverDir,
  ue4ssDir,
  ue4ssModsDir,
  workshopPaksDir,
} from './paths';

const CF_BASE = 'https://api.curseforge.com';

// ------------------------------------------------------------------
// CurseForge API
// ------------------------------------------------------------------
let cachedGameId: number | null = null;

function apiKey(): string {
  return readSettings().curseforgeApiKey ?? '';
}

async function cf<T>(pathAndQuery: string): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error('CurseForge APIキーが未設定です。');
  const res = await fetch(`${CF_BASE}${pathAndQuery}`, {
    headers: { Accept: 'application/json', 'x-api-key': key },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('APIキーが無効か、権限がありません。');
    throw new Error(`CurseForge API エラー (HTTP ${res.status})`);
  }
  return (await res.json()) as T;
}

async function palworldGameId(): Promise<number> {
  if (cachedGameId) return cachedGameId;
  const body = await cf<{ data: { id: number; slug: string }[] }>('/v1/games?pageSize=50');
  const game = body.data.find((g) => g.slug?.toLowerCase() === 'palworld');
  if (!game) throw new Error('CurseForge に Palworld が見つかりませんでした。');
  cachedGameId = game.id;
  return game.id;
}

interface CfFile {
  id: number;
  displayName: string;
  fileName: string;
  downloadUrl: string | null;
  gameVersions?: string[];
  fileDate?: string;
}
interface CfMod {
  id: number;
  name: string;
  summary: string;
  downloadCount: number;
  dateModified: string;
  authors?: { name: string }[];
  logo?: { thumbnailUrl?: string; url?: string };
  links?: { websiteUrl?: string };
  categories?: { name: string }[];
  latestFiles?: CfFile[];
  latestFilesIndexes?: { gameVersion: string }[];
}

function serverHintFor(m: CfMod): ModSearchItem['serverHint'] {
  const hay = `${m.name} ${m.summary} ${(m.categories ?? []).map((c) => c.name).join(' ')}`.toLowerCase();
  if (/server|plugin|palschema|admin|rcon|whitelist|anti-?cheat/.test(hay)) return 'yes';
  if (/texture|reshade|visual|hud|ui skin|title screen|music|outfit|swimsuit|cosmetic/.test(hay))
    return 'client-only';
  return 'maybe';
}

function toSearchItem(m: CfMod): ModSearchItem {
  const latest = (m.latestFiles ?? []).slice().sort((a, b) => b.id - a.id)[0];
  return {
    id: m.id,
    name: m.name,
    summary: m.summary ?? '',
    author: m.authors?.[0]?.name ?? '',
    downloadCount: m.downloadCount ?? 0,
    dateModified: m.dateModified ?? '',
    logoUrl: m.logo?.thumbnailUrl ?? m.logo?.url,
    websiteUrl: m.links?.websiteUrl,
    categories: (m.categories ?? []).map((c) => c.name),
    gameVersions: (m.latestFilesIndexes ?? []).map((i) => i.gameVersion).filter(Boolean),
    latestFileId: latest?.id,
    latestFileName: latest?.fileName,
    serverHint: serverHintFor(m),
  };
}

export async function searchMods(query: string, serverOnly: boolean): Promise<ModSearchItem[]> {
  const gameId = await palworldGameId();
  const q = query.trim();
  const params = new URLSearchParams({
    gameId: String(gameId),
    pageSize: '40',
    sortField: q ? '6' : '2', // 6=Name relevance-ish when searching, 2=Popularity otherwise
    sortOrder: 'desc',
  });
  if (q) params.set('searchFilter', q);
  const body = await cf<{ data: CfMod[] }>(`/v1/mods/search?${params.toString()}`);
  let items = body.data.map(toSearchItem);
  if (serverOnly) items = items.filter((i) => i.serverHint !== 'client-only');
  return items;
}

async function resolveDownloadUrl(modId: number, file: CfFile): Promise<string> {
  if (file.downloadUrl) return file.downloadUrl;
  const body = await cf<{ data: string }>(`/v1/mods/${modId}/files/${file.id}/download-url`);
  if (!body.data) throw new Error('このMODは外部ダウンロードが許可されていません（サイトから手動DLが必要）。');
  return body.data;
}

async function latestFile(modId: number): Promise<CfFile> {
  const body = await cf<{ data: CfMod }>(`/v1/mods/${modId}`);
  const files = body.data.latestFiles ?? [];
  const f = files.slice().sort((a, b) => b.id - a.id)[0];
  if (!f) throw new Error('ダウンロード可能なファイルが見つかりませんでした。');
  return f;
}

// ------------------------------------------------------------------
// Install helpers
// ------------------------------------------------------------------
function rel(abs: string): string {
  return path.relative(serverDir(), abs).split(path.sep).join('/');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

interface InfoJson {
  PackageName?: string;
  Version?: string;
  InstallRule?: { IsServer?: boolean } & Record<string, unknown>;
}

function readInfoJson(root: string): InfoJson | null {
  const direct = path.join(root, 'Info.json');
  const candidates = fs.existsSync(direct) ? [direct] : walk(root).filter((f) => path.basename(f) === 'Info.json');
  if (candidates.length === 0) return null;
  try {
    return JSON.parse(fs.readFileSync(candidates[0], 'utf-8')) as InfoJson;
  } catch {
    return null;
  }
}

function detectType(files: string[]): ModInstallType {
  const lower = files.map((f) => f.toLowerCase());
  if (lower.some((f) => f.includes('logicmods') && f.endsWith('.pak'))) return 'logicmods';
  if (lower.some((f) => f.includes('palschema'))) return 'palschema';
  if (lower.some((f) => f.endsWith('.pak'))) return 'pak';
  if (lower.some((f) => f.endsWith('.lua') || f.endsWith('.dll') || f.endsWith('main.lua'))) return 'ue4ss-lua';
  if (lower.some((f) => f.endsWith('.json'))) return 'palschema';
  return 'unknown';
}

function destDirFor(type: ModInstallType, pkg: string): string {
  switch (type) {
    case 'logicmods':
      return logicModsDir();
    case 'pak':
      return path.join(workshopPaksDir(), pkg);
    case 'palschema':
      return path.join(palSchemaModsDir(), pkg);
    case 'ue4ss-lua':
    case 'ue4ss':
      return path.join(ue4ssModsDir(), pkg);
    default:
      return path.join(workshopPaksDir(), pkg);
  }
}

function copyInto(fromDir: string, toDir: string): string[] {
  fs.mkdirSync(toDir, { recursive: true });
  const copied: string[] = [];
  for (const src of walk(fromDir)) {
    const relPath = path.relative(fromDir, src);
    const dest = path.join(toDir, relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    copied.push(dest);
  }
  return copied;
}

// ------------------------------------------------------------------
// ActiveModList management (edit a server-generated PalModSettings.ini)
// ------------------------------------------------------------------
function readActiveList(): { list: string[]; existed: boolean } {
  const file = modSettingsIni();
  if (!fs.existsSync(file)) return { list: [], existed: false };
  const text = fs.readFileSync(file, 'utf-8');
  const set = new Set<string>();
  // tuple form: ActiveModList=("A","B")
  const tuple = text.match(/ActiveModList\s*=\s*\(([^)]*)\)/i);
  if (tuple) {
    for (const m of tuple[1].matchAll(/"([^"]+)"/g)) set.add(m[1]);
  }
  // line form: ActiveModList=A
  for (const m of text.matchAll(/^\s*ActiveModList\s*=\s*([^("\s][^\r\n]*)$/gim)) set.add(m[1].trim());
  return { list: [...set], existed: true };
}

function writeActiveList(list: string[]): void {
  const file = modSettingsIni();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tuple = `ActiveModList=(${list.map((p) => `"${p}"`).join(',')})`;
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      `[/Script/Pal.PalModWorldSettings]\nbEnableMods=True\n${tuple}\n`,
      'utf-8',
    );
    return;
  }
  let text = fs.readFileSync(file, 'utf-8');
  // Drop any existing ActiveModList lines, then append the normalized tuple.
  text = text.replace(/^\s*ActiveModList\s*=.*$/gim, '').replace(/\n{3,}/g, '\n\n');
  if (!/bEnableMods\s*=/i.test(text)) text += '\nbEnableMods=True';
  text = `${text.trimEnd()}\n${tuple}\n`;
  fs.writeFileSync(file, text, 'utf-8');
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------
function installed(): InstalledMod[] {
  return readSettings().installedMods ?? [];
}
function saveInstalled(mods: InstalledMod[]): void {
  writeSettings({ installedMods: mods });
}

export function getState(): ModManagerState {
  return {
    hasApiKey: !!apiKey(),
    frameworks: {
      ue4ss: fs.existsSync(ue4ssDir()),
      palSchema: fs.existsSync(palSchemaModsDir()),
    },
    installed: installed(),
  };
}

export function setApiKey(key: string): ModManagerState {
  writeSettings({ curseforgeApiKey: key.trim() });
  cachedGameId = null;
  return getState();
}

export async function installMod(modId: number): Promise<ModActionResult> {
  try {
    if (installed().some((m) => m.id === modId)) {
      return { ok: false, error: '既にインストール済みです。' };
    }
    const file = await latestFile(modId);
    const url = await resolveDownloadUrl(modId, file);

    fs.mkdirSync(modCacheDir(), { recursive: true });
    const archivePath = path.join(modCacheDir(), file.fileName || `mod-${modId}.zip`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ダウンロード失敗 (HTTP ${res.status})`);
    fs.writeFileSync(archivePath, Buffer.from(await res.arrayBuffer()));

    // Extract (only .zip archives are supported for auto-install).
    const extractRoot = path.join(modCacheDir(), `extract-${modId}`);
    fs.rmSync(extractRoot, { recursive: true, force: true });
    fs.mkdirSync(extractRoot, { recursive: true });
    if (/\.pak$/i.test(archivePath)) {
      fs.copyFileSync(archivePath, path.join(extractRoot, path.basename(archivePath)));
    } else {
      try {
        new AdmZip(archivePath).extractAllTo(extractRoot, true);
      } catch {
        return { ok: false, error: 'アーカイブを展開できませんでした（対応形式は .zip / .pak）。' };
      }
    }

    const info = readInfoJson(extractRoot);
    const files = walk(extractRoot);
    const type = detectType(files);
    const pkg =
      info?.PackageName?.trim() ||
      (file.fileName || `mod-${modId}`).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '_');
    const isServer = info?.InstallRule?.IsServer === true;

    const destDir = destDirFor(type, pkg);
    const placed = copyInto(extractRoot, destDir).map(rel);
    const configFiles = placed.filter((f) => /\.(json|ini|cfg|txt)$/i.test(f) && !/info\.json$/i.test(f));

    // Enable via ActiveModList (edit the generated ini if present).
    const { existed } = readActiveList();
    const active = new Set(readActiveList().list);
    active.add(pkg);
    writeActiveList([...active]);

    const record: InstalledMod = {
      id: modId,
      packageName: pkg,
      name: info?.PackageName ?? file.displayName ?? pkg,
      version: info?.Version ?? '',
      installType: type,
      enabled: true,
      isServer,
      clientRequired: !isServer,
      files: placed,
      configFiles,
      installedAt: Date.now(),
    };
    saveInstalled([...installed(), record]);

    const warnings: string[] = [];
    if (!existed)
      warnings.push('PalModSettings.ini が未生成です。サーバーを一度起動して生成後、再適用すると確実です。');
    if (type === 'unknown') warnings.push('MODの種類を自動判別できませんでした。配置先の確認をおすすめします。');
    if (type === 'ue4ss-lua' || type === 'ue4ss')
      warnings.push('UE4SS系はキャラリセット不具合の報告があります。テスト後に本運用してください。');
    if (!isServer)
      warnings.push('このMODはサーバー専用と明示されていません。参加者側にも導入が必要な場合があります。');

    return { ok: true, warning: warnings.join(' ') || undefined };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function uninstallMod(modId: number): ModActionResult {
  try {
    const mods = installed();
    const mod = mods.find((m) => m.id === modId);
    if (!mod) return { ok: false, error: 'インストール記録が見つかりません。' };
    for (const relPath of mod.files) {
      const abs = path.join(serverDir(), relPath);
      fs.rmSync(abs, { force: true });
    }
    // remove now-empty package folder
    const dir = destDirFor(mod.installType, mod.packageName);
    try {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch {
      /* ignore */
    }
    const active = new Set(readActiveList().list);
    active.delete(mod.packageName);
    writeActiveList([...active]);
    saveInstalled(mods.filter((m) => m.id !== modId));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function setEnabled(modId: number, enabled: boolean): ModActionResult {
  try {
    const mods = installed();
    const mod = mods.find((m) => m.id === modId);
    if (!mod) return { ok: false, error: 'インストール記録が見つかりません。' };
    const active = new Set(readActiveList().list);
    if (enabled) active.add(mod.packageName);
    else active.delete(mod.packageName);
    writeActiveList([...active]);
    saveInstalled(mods.map((m) => (m.id === modId ? { ...m, enabled } : m)));
    return { ok: true, warning: 'サーバーを再起動すると反映されます。' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ------------------------------------------------------------------
// Framework installers (RE-UE4SS / PalSchema)
// ------------------------------------------------------------------
async function downloadZipTo(url: string, destDir: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`ダウンロード失敗 (HTTP ${res.status})`);
  const tmp = path.join(modCacheDir(), `fw-${Date.now()}.zip`);
  fs.mkdirSync(modCacheDir(), { recursive: true });
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  fs.mkdirSync(destDir, { recursive: true });
  new AdmZip(tmp).extractAllTo(destDir, true);
  fs.rmSync(tmp, { force: true });
}

async function latestGithubZip(repo: string, match: RegExp): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub リリース取得に失敗 (HTTP ${res.status})`);
  const body = (await res.json()) as { assets: { name: string; browser_download_url: string }[] };
  const asset = body.assets.find((a) => match.test(a.name));
  if (!asset) throw new Error('対応するリリースアセットが見つかりませんでした。');
  return asset.browser_download_url;
}

export async function installFramework(which: ModFramework): Promise<ModActionResult> {
  try {
    if (which === 'ue4ss') {
      // Palworld-specific RE-UE4SS. Source/asset naming can change; flagged experimental.
      const url = await latestGithubZip('UE4SS-RE/RE-UE4SS', /palworld.*\.zip$/i).catch(() =>
        latestGithubZip('UE4SS-RE/RE-UE4SS', /UE4SS_.*\.zip$/i),
      );
      await downloadZipTo(url, ue4ssDir());
      return {
        ok: true,
        warning:
          'RE-UE4SS を導入しました（実験的）。UE4SS-settings.ini の GuiConsoleVisible=0 を確認してください。キャラリセット不具合に注意。',
      };
    }
    // PalSchema: framework folder must exist for PalSchema mods to load.
    fs.mkdirSync(palSchemaModsDir(), { recursive: true });
    return {
      ok: true,
      warning:
        'PalSchema 用フォルダを用意しました。PalSchema 本体(.pak/ローダー)が別途必要な場合は、対応MODから導入してください。',
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ------------------------------------------------------------------
// Config editing (restricted to installed mods' config files)
// ------------------------------------------------------------------
function isKnownConfig(relPath: string): boolean {
  return installed().some((m) => m.configFiles.includes(relPath));
}

export function readModConfig(relPath: string): string {
  if (!isKnownConfig(relPath)) throw new Error('編集対象の設定ファイルではありません。');
  return fs.readFileSync(path.join(serverDir(), relPath), 'utf-8');
}

export function writeModConfig(relPath: string, text: string): ModActionResult {
  try {
    if (!isKnownConfig(relPath)) return { ok: false, error: '編集対象の設定ファイルではありません。' };
    fs.writeFileSync(path.join(serverDir(), relPath), text, 'utf-8');
    return { ok: true, warning: 'サーバー再起動で反映されます。' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ------------------------------------------------------------------
// Client pack: zip up client-required mod files + a README of instructions.
// ------------------------------------------------------------------
export function exportClientPack(): ModActionResult {
  try {
    const clientMods = installed().filter((m) => m.clientRequired && m.enabled);
    if (clientMods.length === 0) {
      return { ok: false, error: 'クライアント導入が必要なMODはありません。' };
    }
    const zip = new AdmZip();
    const lines = ['# Palworld クライアントMOD導入手順', ''];
    for (const m of clientMods) {
      lines.push(`## ${m.name} (${m.installType})`);
      for (const relPath of m.files) {
        const abs = path.join(serverDir(), relPath);
        if (fs.existsSync(abs)) zip.addLocalFile(abs, path.dirname(relPath));
      }
      lines.push(`- 配置先: ${m.files[0] ?? '(mod description参照)'}`, '');
    }
    zip.addFile('README.md', Buffer.from(lines.join('\n'), 'utf-8'));
    fs.mkdirSync(modCacheDir(), { recursive: true });
    const out = path.join(modCacheDir(), 'client-mods.zip');
    zip.writeZip(out);
    return { ok: true, warning: out };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Silence unused-import lint for paths that document intended layout.
void modsRootDir;
