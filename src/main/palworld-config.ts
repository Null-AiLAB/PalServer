// Parser / serializer for Palworld's PalWorldSettings.ini.
//
// Palworld does NOT use a simple key=value file like Bedrock's server.properties.
// All gameplay/server settings live on a single line:
//
//   [/Script/Pal.PalGameWorldSettings]
//   OptionSettings=(Difficulty=None,ServerName="My Server",PublicPort=8211,...)
//
// This module round-trips that line: values you don't touch keep their exact
// original text (e.g. float formatting like 1.000000), and only changed keys
// are re-rendered. Replaces bedrock-server-manager/src/main/config-manager.ts.

import fs from 'node:fs';
import path from 'node:path';
import type { PalOptionValue, PalOptions } from '../shared/types';
import { configFile, defaultConfigFile } from './paths';

interface Entry {
  key: string;
  raw: string; // exact token as it appears after "Key="
  quoted: boolean;
}

const OPTION_RE = /OptionSettings\s*=\s*\((.*)\)\s*$/m;

/** Split the inner CSV, respecting double-quoted strings and nested parens. */
function splitTopLevel(inner: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let inStr = false;
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inStr) {
      cur += ch;
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; cur += ch; continue; }
    if (ch === '(') { depth++; cur += ch; continue; }
    if (ch === ')') { depth--; cur += ch; continue; }
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() !== '') parts.push(cur);
  return parts;
}

function parseValue(raw: string): PalOptionValue {
  const v = raw.trim();
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d*\.\d+$/.test(v)) return parseFloat(v);
  if (v === 'True') return true;
  if (v === 'False') return false;
  return v; // enum token: None / All / PlayerDropItem / ...
}

/**
 * In-memory, round-trippable view of PalWorldSettings.ini.
 */
export class PalworldConfig {
  private lines: string[] = [];
  private optionLineIndex = -1;
  private entries: Entry[] = [];

  /** Load the active config; if it does not exist, seed from the default template. */
  static load(): PalworldConfig {
    const active = configFile();
    let text: string;
    if (fs.existsSync(active)) {
      text = fs.readFileSync(active, 'utf-8');
    } else if (fs.existsSync(defaultConfigFile())) {
      text = fs.readFileSync(defaultConfigFile(), 'utf-8');
    } else {
      // Minimal skeleton if nothing exists yet.
      text =
        '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(Difficulty=None,PublicPort=8211)\n';
    }
    const cfg = new PalworldConfig();
    cfg.parse(text);
    return cfg;
  }

  private parse(text: string): void {
    this.lines = text.split(/\r?\n/);
    this.optionLineIndex = this.lines.findIndex((l) => OPTION_RE.test(l));
    this.entries = [];
    if (this.optionLineIndex === -1) return;

    const m = this.lines[this.optionLineIndex].match(OPTION_RE);
    if (!m) return;
    for (const part of splitTopLevel(m[1])) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim();
      const raw = part.slice(eq + 1).trim();
      this.entries.push({ key, raw, quoted: raw.startsWith('"') });
    }
  }

  has(key: string): boolean {
    return this.entries.some((e) => e.key === key);
  }

  get(key: string): PalOptionValue | undefined {
    const e = this.entries.find((x) => x.key === key);
    return e ? parseValue(e.raw) : undefined;
  }

  /** All entries as a typed object. */
  toObject(): PalOptions {
    const out: PalOptions = {};
    for (const e of this.entries) out[e.key] = parseValue(e.raw);
    return out;
  }

  private setRaw(key: string, raw: string, quoted: boolean): void {
    const e = this.entries.find((x) => x.key === key);
    if (e) {
      e.raw = raw;
      e.quoted = quoted;
    } else {
      this.entries.push({ key, raw, quoted });
    }
  }

  setString(key: string, value: string): void {
    this.setRaw(key, `"${value.replace(/"/g, '')}"`, true);
  }
  setNumber(key: string, value: number): void {
    this.setRaw(key, String(value), false);
  }
  setBool(key: string, value: boolean): void {
    this.setRaw(key, value ? 'True' : 'False', false);
  }
  /** Enum-style token (unquoted), e.g. Difficulty=None or DeathPenalty=All. */
  setEnum(key: string, token: string): void {
    this.setRaw(key, token, false);
  }

  /** Apply a typed patch, inferring the on-disk form from the JS type and prior quoting. */
  apply(patch: PalOptions): void {
    for (const [key, value] of Object.entries(patch)) {
      if (typeof value === 'boolean') this.setBool(key, value);
      else if (typeof value === 'number') this.setNumber(key, value);
      else {
        const prev = this.entries.find((e) => e.key === key);
        // Preserve enum-ness: if the previous value was unquoted (an enum token), keep it unquoted.
        if (prev && !prev.quoted) this.setEnum(key, value);
        else this.setString(key, value);
      }
    }
  }

  /** Rebuild the full file text with the OptionSettings line replaced. */
  serialize(): string {
    const inner = this.entries.map((e) => `${e.key}=${e.raw}`).join(',');
    const optionLine = `OptionSettings=(${inner})`;
    const lines = [...this.lines];
    if (this.optionLineIndex >= 0) {
      lines[this.optionLineIndex] = optionLine;
    } else {
      lines.unshift('[/Script/Pal.PalGameWorldSettings]', optionLine);
    }
    return lines.join('\n');
  }

  /** Write back to the ACTIVE config file (creating the folder if needed). */
  save(): void {
    const active = configFile();
    fs.mkdirSync(path.dirname(active), { recursive: true });
    fs.writeFileSync(active, this.serialize(), 'utf-8');
  }
}
