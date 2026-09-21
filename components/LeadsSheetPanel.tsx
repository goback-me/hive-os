"use client";

import { useEffect, useState } from "react";
import { LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadStatusValue } from "@/lib/lead-status";

type DriveFile = { id: string; name: string; modifiedTime: string };

type Props = {
  clientId: string;
  googleConnected: boolean;
  spreadsheetId: string | null;
  spreadsheetName: string | null;
  sheetName: string | null;
};

export default function LeadsSheetPanel({
  clientId,
  googleConnected,
  spreadsheetId,
  spreadsheetName,
  sheetName,
}: Props) {
  const [step, setStep] = useState<"picking-sheet" | "picking-tab" | "ready">(
    spreadsheetId && sheetName ? "ready" : "picking-sheet"
  );
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [sheetSearch, setSheetSearch] = useState("");
  const [tabs, setTabs] = useState<string[] | null>(null);
  const [pickedFile, setPickedFile] = useState<DriveFile | null>(null);
  const [loadingList, setLoadingList] = useState(false);

  const [currentSpreadsheetName, setCurrentSpreadsheetName] = useState(spreadsheetName);
  const [currentSheetName, setCurrentSheetName] = useState(sheetName);

  // Column names only (no data) — used to render the picker checkboxes.
  const [allColumns, setAllColumns] = useState<string[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [statusColumn, setStatusColumn] = useState<string | null>(null);
  const [statusMapping, setStatusMapping] = useState<Record<string, LeadStatusValue>>({});
  // The "did it close" column (e.g. "Prospect Status") — separate from the
  // outreach-stage column above (e.g. "HIVE STATUS"). Whichever resolves to
  // a more conclusive status wins — see moreConclusive() in lib/lead-status.ts.
  const [resultStatusColumn, setResultStatusColumn] = useState<string | null>(null);
  const [resultStatusMapping, setResultStatusMapping] = useState<Record<string, LeadStatusValue>>({});
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  // Actual row data — server already stripped hidden columns out of this.
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [statusValues, setStatusValues] = useState<string[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [resultStatusValues, setResultStatusValues] = useState<string[]>([]);
  const [resultStatusCounts, setResultStatusCounts] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<string>("__all__");

  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadMeta() {
    fetch(`/api/google/sheet-meta?clientId=${clientId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setAllColumns(data.allColumns);
        setVisibleColumns(data.visibleColumns);
        setStatusColumn(data.statusColumn);
        setStatusMapping(data.statusMapping ?? {});
        setResultStatusColumn(data.resultStatusColumn);
        setResultStatusMapping(data.resultStatusMapping ?? {});
        setCurrentSpreadsheetName(data.spreadsheetName);
        setCurrentSheetName(data.sheetName);
      })
      .catch((e) => setError(e.message));
  }

  function loadData() {
    setLoadingData(true);
    setError(null);
    fetch(`/api/google/data?clientId=${clientId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setHeaders(data.headers);
        setRows(data.rows);
        setStatusValues(data.statusValues ?? []);
        setStatusCounts(data.statusCounts ?? {});
        setResultStatusValues(data.resultStatusValues ?? []);
        setResultStatusCounts(data.resultStatusCounts ?? {});
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingData(false));
  }

  useEffect(() => {
    if (step !== "ready") return;
    loadMeta();
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, clientId]);

  function loadSpreadsheets() {
    setLoadingList(true);
    setError(null);
    fetch(`/api/google/spreadsheets`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setFiles(data.files);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingList(false));
  }

  function pickFile(file: DriveFile) {
    setPickedFile(file);
    setLoadingList(true);
    setError(null);
    fetch(`/api/google/tabs?spreadsheetId=${file.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setTabs(data.tabs);
        setStep("picking-tab");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingList(false));
  }

  function pickTab(tab: string) {
    if (!pickedFile) return;
    setLoadingList(true);
    setError(null);
    fetch("/api/google/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        spreadsheetId: pickedFile.id,
        spreadsheetName: pickedFile.name,
        sheetName: tab,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setStatusFilter("__all__");
        setStep("ready");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingList(false));
  }

  function toggleColumn(col: string) {
    const next = visibleColumns.includes(col)
      ? visibleColumns.filter((c) => c !== col)
      : allColumns.filter((h) => visibleColumns.includes(h) || h === col); // keep header order
    setVisibleColumns(next);
    // if we just hid the current status column(s), clear them locally too
    if (!next.includes(statusColumn ?? "")) setStatusColumn(null);
    if (!next.includes(resultStatusColumn ?? "")) setResultStatusColumn(null);
  }

  function saveColumns(nextStatusColumn: string | null, nextResultStatusColumn: string | null) {
    fetch("/api/google/columns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        visibleColumns,
        statusColumn: nextStatusColumn,
        statusMapping,
        resultStatusColumn: nextResultStatusColumn,
        resultStatusMapping,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setStatusColumn(nextStatusColumn);
        setResultStatusColumn(nextResultStatusColumn);
        setStatusFilter("__all__");
        setShowColumnPicker(false);
        loadData(); // re-fetch so the table reflects the new column set immediately
      })
      .catch((e) => setError(e.message));
  }

  function setMappingFor(sheetValue: string, ourStatus: LeadStatusValue | "") {
    setStatusMapping((prev) => {
      const next = { ...prev };
      if (ourStatus) next[sheetValue] = ourStatus;
      else delete next[sheetValue];
      return next;
    });
  }

  function setResultMappingFor(sheetValue: string, ourStatus: LeadStatusValue | "") {
    setResultStatusMapping((prev) => {
      const next = { ...prev };
      if (ourStatus) next[sheetValue] = ourStatus;
      else delete next[sheetValue];
      return next;
    });
  }

  const ghostBtn = { border: "1px solid var(--border)", color: "var(--text-secondary)" } as const;
  const selectStyle = { background: "var(--surface-card)", border: "1px solid var(--border)", color: "var(--text-primary)" } as const;

  // ── Not connected at the app level yet ───────────────────────────────
  if (!googleConnected) {
    return (
      <div className="card rounded-2xl p-5 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        Connect the Google account above first, then come back here to pick this client's sheet.
      </div>
    );
  }

  // ── Step 1: pick a spreadsheet ────────────────────────────────────────
  if (step === "picking-sheet") {
    return (
      <div className="card rounded-2xl p-5 max-w-[32rem] mx-auto">
        <h4 className="font-heading font-bold text-sm mb-3" style={{ color: "var(--text-primary)" }}>Pick a spreadsheet for this client</h4>

        {!files && (
          <button
            onClick={loadSpreadsheets}
            disabled={loadingList}
            className="btn-gradient px-4 py-2.5 rounded-lg text-sm font-bold disabled:opacity-50"
          >
            {loadingList ? "Loading…" : "Show Google Sheets"}
          </button>
        )}

        {error && <p className="text-xs mt-3" style={{ color: "var(--danger)" }}>{error}</p>}

        {files && (
          <>
            <div className="relative mt-2">
              <span className="material-symbols-outlined text-[18px] absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }}>
                search
              </span>
              <input
                type="text"
                value={sheetSearch}
                onChange={(e) => setSheetSearch(e.target.value)}
                placeholder="Search sheets…"
                className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
              />
            </div>

            {(() => {
              const filteredFiles = files.filter((f) => f.name.toLowerCase().includes(sheetSearch.trim().toLowerCase()));
              return (
                <div className="mt-2 max-h-80 overflow-y-auto" style={{ borderTop: "1px solid var(--border)" }}>
                  {filteredFiles.length === 0 && (
                    <p className="text-sm py-3" style={{ color: "var(--text-secondary)" }}>
                      {files.length === 0 ? "No spreadsheets found." : "No sheets match your search."}
                    </p>
                  )}
                  {filteredFiles.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => pickFile(f)}
                      disabled={loadingList}
                      className="w-full text-left py-3 flex items-center gap-2 rounded-lg px-2"
                      style={{ borderBottom: "1px solid var(--border)" }}
                    >
                      <span className="material-symbols-outlined text-[20px]" style={{ color: "var(--primary)" }}>description</span>
                      <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{f.name}</span>
                    </button>
                  ))}
                </div>
              );
            })()}
          </>
        )}
      </div>
    );
  }

  // ── Step 2: pick a tab within the spreadsheet ─────────────────────────
  if (step === "picking-tab") {
    return (
      <div className="card rounded-2xl p-5 max-w-[32rem] mx-auto">
        <h4 className="font-heading font-bold text-sm mb-3" style={{ color: "var(--text-primary)" }}>Pick a tab in "{pickedFile?.name}"</h4>
        {error && <p className="text-xs mb-3" style={{ color: "var(--danger)" }}>{error}</p>}
        <div className="flex flex-wrap gap-2">
          {(tabs ?? []).map((t) => (
            <button
              key={t}
              onClick={() => pickTab(t)}
              disabled={loadingList}
              className="px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-50"
              style={{ background: "var(--surface-hover)", color: "var(--text-primary)" }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Step 3: assigned + ready — table with column + status filters ────
  const filteredRows =
    statusColumn && statusFilter !== "__all__"
      ? rows.filter((r) => r[headers.indexOf(statusColumn)] === statusFilter)
      : rows;

  return (
    <div className="card rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h4 className="font-heading font-bold text-sm" style={{ color: "var(--text-primary)" }}>{currentSpreadsheetName ?? "Assigned sheet"}</h4>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Tab: {currentSheetName} · {filteredRows.length} of {rows.length} leads
          </p>
        </div>
        <div className="flex gap-2">
          {statusColumn && statusValues.length > 0 && (
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 rounded-lg text-xs font-bold outline-none" style={selectStyle}>
              <option value="__all__">All statuses ({rows.length})</option>
              {statusValues.map((v) => (
                <option key={v} value={v}>
                  {v} ({statusCounts[v] ?? 0})
                </option>
              ))}
            </select>
          )}
          <button onClick={() => setShowColumnPicker((s) => !s)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold" style={ghostBtn}>
            <span className="material-symbols-outlined text-[16px]">view_column</span>
            Columns
          </button>
          <button onClick={() => setStep("picking-sheet")} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold" style={ghostBtn}>
            <span className="material-symbols-outlined text-[16px]">swap_horiz</span>
            Change sheet
          </button>
        </div>
      </div>

      {showColumnPicker && (
        <div className="mb-3 p-3 rounded-lg" style={{ background: "var(--surface-hover)" }}>
          <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>Visible columns (unchecked = hidden, data not sent to the browser at all)</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {allColumns.map((h) => (
              <label
                key={h}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs cursor-pointer"
                style={{ background: "var(--surface-card)", border: "1px solid var(--border)" }}
              >
                <input type="checkbox" checked={visibleColumns.includes(h)} onChange={() => toggleColumn(h)} />
                {h}
              </label>
            ))}
          </div>

          <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>Outreach status column (your team's stage — e.g. "HIVE STATUS"; must be visible)</p>
          <select value={statusColumn ?? ""} onChange={(e) => setStatusColumn(e.target.value || null)} className="mb-3 px-3 py-2 rounded-lg text-xs font-bold outline-none" style={selectStyle}>
            <option value="">None</option>
            {visibleColumns.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>

          {statusColumn && statusValues.length > 0 && (
            <>
              <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
                Map "{statusColumn}" values to the Leads tab's 6 statuses (unmapped values default to New Lead)
              </p>
              <div className="space-y-2 mb-3">
                {statusValues.map((v) => (
                  <div key={v} className="flex items-center gap-2">
                    <span className="text-xs font-semibold flex-1 truncate" style={{ color: "var(--text-primary)" }}>{v}</span>
                    <span className="material-symbols-outlined text-[14px]" style={{ color: "var(--text-muted)" }}>arrow_forward</span>
                    <select
                      value={statusMapping[v] ?? ""}
                      onChange={(e) => setMappingFor(v, e.target.value as LeadStatusValue | "")}
                      className="px-2 py-1.5 rounded-lg text-xs font-bold outline-none"
                      style={selectStyle}
                    >
                      <option value="">New Lead (default)</option>
                      {LEAD_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {LEAD_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </>
          )}

          <p className="text-xs mb-2 pt-3" style={{ color: "var(--text-secondary)", borderTop: "1px solid var(--border)" }}>
            Result status column (did the deal actually close? — e.g. "Prospect Status"; optional, must be visible)
          </p>
          <select
            value={resultStatusColumn ?? ""}
            onChange={(e) => setResultStatusColumn(e.target.value || null)}
            className="mb-3 px-3 py-2 rounded-lg text-xs font-bold outline-none"
            style={selectStyle}
          >
            <option value="">None</option>
            {visibleColumns.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>

          {resultStatusColumn && resultStatusValues.length > 0 && (
            <>
              <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
                Map "{resultStatusColumn}" values — these OVERRIDE the outreach status above whenever they're more
                conclusive (e.g. "SOLD" beats "Live Transfer"). Revenue (Quote Value/Revenue Generated) is only
                counted on a lead once it's mapped to Won here.
              </p>
              <div className="space-y-2 mb-3">
                {resultStatusValues.map((v) => (
                  <div key={v} className="flex items-center gap-2">
                    <span className="text-xs font-semibold flex-1 truncate" style={{ color: "var(--text-primary)" }}>{v}</span>
                    <span className="material-symbols-outlined text-[14px]" style={{ color: "var(--text-muted)" }}>arrow_forward</span>
                    <select
                      value={resultStatusMapping[v] ?? ""}
                      onChange={(e) => setResultMappingFor(v, e.target.value as LeadStatusValue | "")}
                      className="px-2 py-1.5 rounded-lg text-xs font-bold outline-none"
                      style={selectStyle}
                    >
                      <option value="">Not conclusive (ignored)</option>
                      {LEAD_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {LEAD_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </>
          )}

          <div>
            <button onClick={() => saveColumns(statusColumn, resultStatusColumn)} className="btn-gradient px-4 py-2 rounded-lg text-xs font-bold">
              Save
            </button>
          </div>
        </div>
      )}

      {statusColumn && statusValues.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {statusValues.map((v) => {
            const active = statusFilter === v;
            return (
              <button
                key={v}
                onClick={() => setStatusFilter(active ? "__all__" : v)}
                className="px-2.5 py-1 rounded-full text-xs font-semibold"
                style={
                  active
                    ? { background: "var(--primary)", color: "#fff", border: "1px solid var(--primary)" }
                    : { background: "var(--surface-hover)", color: "var(--text-primary)", border: "1px solid var(--border)" }
                }
              >
                {v} · {statusCounts[v] ?? 0}
              </button>
            );
          })}
        </div>
      )}

      {error && <p className="text-xs mb-3" style={{ color: "var(--danger)" }}>{error}</p>}
      {loadingData && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Loading leads…</p>}

      {!loadingData && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {headers.map((h) => (
                  <th key={h} className="py-2 pr-6 text-xs font-bold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="py-2 pr-6 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={headers.length || 1} className="py-5" style={{ color: "var(--text-secondary)" }}>
                    No leads match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
