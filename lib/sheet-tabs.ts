import { getSheetValues } from "./google-sheets";
import { normalizeHeader } from "./sheet-parse";

// A client's leads can come from several tabs of one spreadsheet (e.g. a tab
// per month or per campaign). The tabs are read as one list: the primary
// tab's columns as they are, then any column another tab adds, matched by
// normalized header ("Phone " = "phone"). Everything downstream — the sync,
// the live table, the column settings — works on that combined list.

export function sheetTabs(sheet: { sheetName: string; sheetNames?: string[] | null }): string[] {
  const list = sheet.sheetNames?.length ? sheet.sheetNames : [sheet.sheetName];
  return Array.from(new Set([sheet.sheetName, ...list].filter(Boolean)));
}

type TabValues = { headers: string[]; rows: string[][]; cells: unknown[][] };

export type CombinedValues = TabValues & {
  rowTabs: string[]; // per row: the tab it's on
  rowNumbers: number[]; // per row: its row number in that tab (header = 1)
};

// One header key per column; a header repeated within a tab gets "#2", "#3"…
function headerKeys(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h, i) => {
    const n = normalizeHeader(h);
    if (!n) return `\u0000blank${i}`; // blank headers never merge across tabs
    const count = (seen.get(n) ?? 0) + 1;
    seen.set(n, count);
    return count === 1 ? n : `${n}#${count}`;
  });
}

// Pure: exported for lib/sheet-tabs.check.ts.
export function combineTabs(tabs: { tab: string; values: TabValues }[]): CombinedValues {
  const [first, ...rest] = tabs;
  const headers = [...first.values.headers];
  const keyIndex = new Map<string, number>();
  headerKeys(headers).forEach((k, i) => keyIndex.set(k, i));
  for (const t of rest) {
    headerKeys(t.values.headers).forEach((k, i) => {
      if (keyIndex.has(k) || k.startsWith("\u0000")) return;
      keyIndex.set(k, headers.length);
      headers.push(t.values.headers[i]);
    });
  }

  const out: CombinedValues = { headers, rows: [], cells: [], rowTabs: [], rowNumbers: [] };
  for (const t of tabs) {
    const keys = headerKeys(t.values.headers);
    const target = keys.map((k) => keyIndex.get(k) ?? -1);
    t.values.rows.forEach((r, ri) => {
      const row = headers.map(() => "");
      const cell: unknown[] = headers.map(() => "");
      target.forEach((ti, si) => {
        if (ti === -1) return;
        row[ti] = r[si] ?? "";
        cell[ti] = t.values.cells[ri]?.[si] ?? "";
      });
      out.rows.push(row);
      out.cells.push(cell);
      out.rowTabs.push(t.tab);
      out.rowNumbers.push(ri + 2);
    });
  }
  return out;
}

// Reads every tab (a missing tab fails the whole read, so a sync never runs on
// a partial list and soft-deletes the missing tab's leads).
export async function getCombinedSheetValues(
  accessToken: string,
  spreadsheetId: string,
  tabs: string[],
  opts: { unformatted?: boolean } = {}
): Promise<CombinedValues> {
  const values = await Promise.all(
    tabs.map((tab) =>
      getSheetValues(accessToken, spreadsheetId, tab, opts).catch((e) => {
        throw new Error(`Tab "${tab}": ${e instanceof Error ? e.message : String(e)}`);
      })
    )
  );
  return combineTabs(tabs.map((tab, i) => ({ tab, values: values[i] })));
}
