// Sample CPU/memory/uptime of the running PalServer process.
// Adapted from bedrock-server-manager/src/main/metrics.ts (MIT, (c) 2026 yuzum).

import pidusage from 'pidusage';
import type { SystemMetrics } from '../shared/types';
import { serverManager } from './server-manager';

export async function sampleMetrics(): Promise<SystemMetrics> {
  const pid = serverManager.getPid();
  const startedAt = serverManager.getStartedAt();
  if (!pid) return { running: false, cpu: 0, memory: 0, uptime: 0 };
  try {
    const stat = await pidusage(pid);
    return {
      running: true,
      cpu: Math.round(stat.cpu),
      memory: stat.memory,
      uptime: startedAt ? Date.now() - startedAt : 0,
    };
  } catch {
    return { running: false, cpu: 0, memory: 0, uptime: 0 };
  }
}
