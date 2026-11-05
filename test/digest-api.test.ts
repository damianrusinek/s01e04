import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: '' };
let runsDir: string;

afterEach(() => {
  if (runsDir) rmSync(runsDir, { recursive: true, force: true });
});

describe('digest API', () => {
  it('returns the sorted digest rows as JSON', async () => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-api-'));
    const entries = [
      { at: '2026-10-28T09:00:00+01:00', job: 'zeta', status: 'ok', owner: null },
      { at: '2026-10-28T08:00:00+01:00', job: 'alpha', status: 'retry', owner: 'Ada', error: 'first' },
      { at: '2026-10-28T10:00:00+01:00', job: 'alpha', status: 'ok', owner: 'Ada' },
    ];
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);

    const res = await createApp({ ...config, runsDir }).request('/api/digest/2026-10-28');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        job: 'alpha', owner: 'Ada', runs: 2, retries: 1, lastStatus: 'ok', lastError: 'first',
        firstAt: '2026-10-28T08:00:00+01:00', lastAt: '2026-10-28T10:00:00+01:00',
      },
      {
        job: 'zeta', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-28T09:00:00+01:00', lastAt: '2026-10-28T09:00:00+01:00',
      },
    ]);
  });

  it('returns 404 when the night is missing', async () => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-api-'));
    const res = await createApp({ ...config, runsDir }).request('/api/digest/2026-10-28');

    expect(res.status).toBe(404);
  });
});
