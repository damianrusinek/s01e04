import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight, RunStatus } from './types.js';

type RunEntry = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error: string | null;
};

function parseEntry(line: string): RunEntry | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(entry.at) ||
    !Number.isFinite(Date.parse(entry.at)) ||
    typeof entry.job !== 'string' || entry.job.trim() === '' ||
    (entry.status !== 'ok' && entry.status !== 'retry' && entry.status !== 'fail') ||
    (typeof entry.owner !== 'string' && entry.owner !== null) ||
    (entry.error !== undefined && entry.error !== null && typeof entry.error !== 'string')
  ) return null;

  return {
    at: entry.at,
    job: entry.job,
    status: entry.status,
    owner: entry.owner,
    error: entry.error ?? null,
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const digest: NightDigest = { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const rows = new Map<string, DigestRow>();
  const lines = contents === '' ? [] : contents.split(/\r?\n/);
  // A final newline terminates the last record; it does not create a bad record.
  if (lines.at(-1) === '') lines.pop();

  for (const line of lines) {
    const entry = parseEntry(line);
    if (!entry) {
      digest.badLines++;
      continue;
    }
    digest.counts[entry.status]++;
    const row = rows.get(entry.job);
    if (row) {
      row.owner = entry.owner;
      row.runs++;
      row.retries += Number(entry.status === 'retry');
      row.lastStatus = entry.status;
      row.lastError = entry.error ?? row.lastError;
      row.lastAt = entry.at;
    } else {
      rows.set(entry.job, {
        job: entry.job,
        owner: entry.owner,
        runs: 1,
        retries: Number(entry.status === 'retry'),
        lastStatus: entry.status,
        lastError: entry.error,
        firstAt: entry.at,
        lastAt: entry.at,
      });
    }
  }

  digest.rows = [...rows.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return digest;
};
