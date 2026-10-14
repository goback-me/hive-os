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

import { normalizeEmail, normalizePhone } from "./sheet-parse";

export type SideCounts = {
  rows: number;
  hive: Record<string, number>;
  prospect: Record<string, number>;
  won: number;
  wonValue: number;
  unmatched: number;
};

export type Diff = { metric: string; sheet: number; hq: number };

// A sheet row with no lead of its own: another row with the same email (or
// the same email+phone+name) took it, and HQ shows only that row — keptRow.
// Row numbers as in the sheet (header = row 1). Shown by the reconcile
// alert's Fix panel (components/DuplicateRowsFix.tsx).
export type RowCells = { name: string; email: string; phone: string; hive: string; prospect: string };
export type DuplicateRow = RowCells & { row: number; keptRow: number; kept: RowCells; match: "email" | "phone" | "name" };
type RowOnLead = RowCells & { lead: string };

// rows: row index → the lead it landed on; owners: the row index each lead
// ended up showing.
export function duplicateRows(rows: Map<number, RowOnLead>, owners: Set<number>): DuplicateRow[] {
  const ownerOf = new Map(Array.from(rows).filter(([i]) => owners.has(i)).map(([i, r]) => [r.lead, i]));
  const out: DuplicateRow[] = [];
  for (const [i, r] of Array.from(rows)) {
    const k = ownerOf.get(r.lead);
    if (owners.has(i) || k === undefined) continue;
    const { lead: _a, ...cells } = r;
    const { lead: _b, ...kept } = rows.get(k)!;
    const same = (a: string, b: string, norm: (v: string) => string) => !!norm(a) && norm(a) === norm(b);
    const match = same(r.email, kept.email, normalizeEmail) ? "email" : same(r.phone, kept.phone, normalizePhone) ? "phone" : "name";
    out.push({ row: i + 2, keptRow: k + 2, kept, match, ...cells });
  }
  return out;
}

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
