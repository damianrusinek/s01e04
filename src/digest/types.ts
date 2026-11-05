export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  // Owner from the last entry; a missing owner stays visible as null.
  owner: string | null;
  // All valid entries for this job, including retries and failures.
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  // Most recent non-null error, retained even after a later successful run.
  lastError: string | null;
  // Original timestamp strings, including their offsets.
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  // One row per job, sorted by job for both HTML and JSON consumers.
  rows: DigestRow[];
  badLines: number;
  // Counts of valid log entries by status, rather than final job statuses.
  counts: Record<RunStatus, number>;
};

// src/digest/read.ts will export readNight with this synchronous signature.
// Return null only for a missing file or a rejected night path. An existing
// empty file returns empty rows, zero status counts, and badLines: 0.
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
