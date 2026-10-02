// Raw sheet vs HQ, after every sync — catches anything the sync dropped,
// merged or misread. Both sides are counted the same way:
//   rows       non-blank rows (sheet) / active leads (HQ)
//   hive       rows per raw HIVE STATUS value
//   prospect   rows per raw Prospect Status value
//   won        rows that resolve to Won, and their total job value
//   unmatched  sheet rows with no lead of their own (duplicate identities) /
//              HQ leads with no sheet row
// Leads whose stage was changed in HQ more recently than the sheet (a
// write-back still on its way) are left out of `won` on both sides — they
// differ on purpose. Pure: lib/reconcile.check.ts runs it on a fixture.

export type SideCounts = {
  rows: number;
  hive: Record<string, number>;
  prospect: Record<string, number>;
  won: number;
  wonValue: number;
  unmatched: number;
};

export type Diff = { metric: string; sheet: number; hq: number };

// Raw cell values → counts, blank cells skipped, exact text kept.
export function countValues(values: (string | null | undefined)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    const k = (v ?? "").trim();
    if (k) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function reconcile(sheet: SideCounts, hq: SideCounts): Diff[] {
  const diffs: Diff[] = [];
  const add = (metric: string, a: number, b: number) => {
    if (a !== b) diffs.push({ metric, sheet: a, hq: b });
  };
  add("Leads (non-blank rows vs active leads)", sheet.rows, hq.rows);
  for (const [label, s, h] of [
    ["HIVE STATUS", sheet.hive, hq.hive],
    ["Prospect Status", sheet.prospect, hq.prospect],
  ] as const) {
    for (const k of Array.from(new Set([...Object.keys(s), ...Object.keys(h)])).sort()) add(`${label} "${k}"`, s[k] ?? 0, h[k] ?? 0);
  }
  add("Won", sheet.won, hq.won);
  add("Won job value ($)", cents(sheet.wonValue), cents(hq.wonValue));
  add("Sheet rows with no lead of their own (duplicate email/phone/name)", sheet.unmatched, 0);
  add("HQ leads with no sheet row", 0, hq.unmatched);
  return diffs;
}
