import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: '' };
const night = '2026-10-28';
const entries = [
  { at: `${night}T09:00:00+01:00`, job: 'zeta', status: 'ok', owner: null },
  { at: `${night}T08:00:00+01:00`, job: 'alpha', status: 'retry', owner: 'Ada', error: 'first' },
  { at: `${night}T10:00:00+01:00`, job: 'alpha', status: 'ok', owner: 'Ada' },
];
let runsDir: string;

afterEach(() => {
  if (runsDir) rmSync(runsDir, { recursive: true, force: true });
});

function makeRunsDir() {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  return runsDir;
}

function writeNight(contents: string) {
  writeFileSync(join(runsDir, `${night}.jsonl`), contents);
}

describe.each([
  { name: 'HTML page', path: `/digest/${night}`, json: false },
  { name: 'JSON API', path: `/api/digest/${night}`, json: true },
])('$name', ({ path, json }) => {
  it('returns 200 for a valid night and keeps jobs sorted', async () => {
    makeRunsDir();
    writeNight(`${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);

    const response = await createApp({ ...config, runsDir }).request(path);
    expect(response.status).toBe(200);

    if (json) {
      expect((await response.json()).map((row: { job: string }) => row.job)).toEqual(['alpha', 'zeta']);
    } else {
      const html = await response.text();
      expect(html).toContain('digest · 2026-10-28');
      expect([...html.matchAll(/<tbody>[\s\S]*?<\/tbody>/g)]).toHaveLength(1);
      expect([...html.matchAll(/<td>([^<]+)<\/td>/g)].map((match) => match[1])).toEqual([
        'alpha', 'Ada', '2', '1', 'ok', 'first', entries[1].at, entries[2].at,
        'zeta', '—', '1', '0', 'ok', '—', entries[0].at, entries[0].at,
      ]);
    }
  });

  it('returns 404 when the night is missing', async () => {
    makeRunsDir();
    const response = await createApp({ ...config, runsDir }).request(path);
    expect(response.status).toBe(404);
  });

  it('preserves the existing empty-night behavior', async () => {
    makeRunsDir();
    writeNight('');

    const response = await createApp({ ...config, runsDir }).request(path);
    expect(response.status).toBe(200);
    if (json) {
      expect(await response.json()).toEqual([]);
    } else {
      expect(await response.text()).toContain('nothing ran');
    }
  });

  it('keeps valid rows when the night contains a malformed line', async () => {
    makeRunsDir();
    writeNight([
      JSON.stringify(entries[0]),
      '{malformed json',
      JSON.stringify(entries[1]),
    ].join('\n'));

    const response = await createApp({ ...config, runsDir }).request(path);
    expect(response.status).toBe(200);
    if (json) {
      expect((await response.json()).map((row: { job: string }) => row.job)).toEqual(['alpha', 'zeta']);
    } else {
      const html = await response.text();
      expect(html).toContain('<td>alpha</td>');
      expect(html).toContain('<td>zeta</td>');
      expect(html).not.toContain('{malformed json');
    }
  });
});

it('returns the same job order in the HTML page and JSON API', async () => {
  makeRunsDir();
  writeNight(`${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  const app = createApp({ ...config, runsDir });

  const [htmlResponse, jsonResponse] = await Promise.all([
    app.request(`/digest/${night}`),
    app.request(`/api/digest/${night}`),
  ]);
  const html = await htmlResponse.text();
  const table = [...html.matchAll(/<tbody>[\s\S]*?<\/tbody>/g)][0]?.[0] ?? '';
  const htmlJobs = [...table.matchAll(/<tr>\s*<td>([^<]+)<\/td>/g)].map((match) => match[1]);
  const jsonJobs = (await jsonResponse.json()).map((row: { job: string }) => row.job);

  expect(htmlResponse.status).toBe(200);
  expect(jsonResponse.status).toBe(200);
  expect(htmlJobs).toEqual(jsonJobs);
  expect(jsonJobs).toEqual(['alpha', 'zeta']);
});
