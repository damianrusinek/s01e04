import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

const night = '2026-10-28';
const entry = {
  at: '2026-10-28T23:00:00+01:00', job: 'lane/sync', status: 'ok', owner: 'rook',
};

describe('run log reader', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function writeLines(lines: unknown[]) {
    writeFileSync(join(runsDir, `${night}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n'));
  }

  it('reads the real night: five jobs, one bad line, and counts for every valid entry', () => {
    const digest = readNight('runs', night);
    expect(digest?.badLines).toBe(1);
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest?.rows.map((row) => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.rows[0].owner).toBeNull();
    expect(digest?.rows[1]).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
      lastStatus: 'ok', lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('uses entry order, preserves offsets, and retains the latest non-null error', () => {
    writeLines([
      { ...entry, at: '2026-10-29T01:00:00+05:30', status: 'retry', error: 'old error' },
      { ...entry, at: '2026-10-28T20:00:00-07:00', status: 'fail', error: 'latest error' },
      { ...entry, at: '2026-10-28T19:00:00-07:00', owner: null, error: null },
      { ...entry, at: '2026-10-28T18:00:00-07:00', owner: null },
    ]);
    expect(readNight(runsDir, night)).toEqual({
      badLines: 0, counts: { ok: 2, retry: 1, fail: 1 },
      rows: [{
        job: 'lane/sync', owner: null, runs: 4, retries: 1, lastStatus: 'ok',
        lastError: 'latest error', firstAt: '2026-10-29T01:00:00+05:30',
        lastAt: '2026-10-28T18:00:00-07:00',
      }],
    });
  });

  it('counts invalid JSON and malformed fields without discarding valid records', () => {
    const malformed = [
      null, [], 42, 'text', {},
      { ...entry, at: 42 }, { ...entry, at: 'not a timestamp' },
      { ...entry, at: '2026-10-28T23:00:00' },
      { ...entry, job: null }, { ...entry, job: '' },
      { ...entry, status: 'pending' }, { ...entry, status: null },
      { ...entry, owner: undefined }, { ...entry, owner: 42 },
      { ...entry, error: false }, { ...entry, error: {} },
    ];
    const path = join(runsDir, `${night}.jsonl`);
    // Two bad JSON records, including a blank line, between valid records.
    writeFileSync(path, [
      ...malformed.map((line) => JSON.stringify(line)),
      JSON.stringify(entry), '{broken', '', JSON.stringify(entry), '',
    ].join('\n'));
    const digest = readNight(runsDir, night);
    expect(digest?.badLines).toBe(malformed.length + 2);
    expect(digest?.counts).toEqual({ ok: 2, retry: 0, fail: 0 });
    expect(digest?.rows[0].runs).toBe(2);
  });

  it('handles CRLF and a final line without a newline', () => {
    writeFileSync(join(runsDir, `${night}.jsonl`), `${JSON.stringify(entry)}\r\n${JSON.stringify(entry)}`);
    expect(readNight(runsDir, night)?.badLines).toBe(0);
    expect(readNight(runsDir, night)?.rows[0].runs).toBe(2);
  });

  it('distinguishes an empty file from a missing or rejected night', () => {
    expect(readNight(runsDir, night)).toBeNull();
    writeFileSync(join(runsDir, `${night}.jsonl`), '');
    expect(readNight(runsDir, night)).toEqual({
      rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
    for (const rejected of ['', '../2026-10-28', '/2026-10-28', '2026-10-28/other', '2026-10-28\\other', '2026-10-28\0', '2026-10-28.jsonl']) {
      expect(readNight(runsDir, rejected)).toBeNull();
    }
  });

  it('does not conceal file read errors as a missing night', () => {
    mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow();
  });
});
