"use client";

import { useEffect, useState } from "react";

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
  const [tabs, setTabs] = useState<string[] | null>(null);
  const [pickedFile, setPickedFile] = useState<DriveFile | null>(null);
  const [loadingList, setLoadingList] = useState(false);

  const [currentSpreadsheetName, setCurrentSpreadsheetName] = useState(spreadsheetName);
  const [currentSheetName, setCurrentSheetName] = useState(sheetName);

  // Column names only (no data) — used to render the picker checkboxes.
  const [allColumns, setAllColumns] = useState<string[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [statusColumn, setStatusColumn] = useState<string | null>(null);
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  // Actual row data — server already stripped hidden columns out of this.
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [statusValues, setStatusValues] = useState<string[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
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
    // if we just hid the current status column, clear it locally too
    if (!next.includes(statusColumn ?? "")) setStatusColumn(null);
  }

  function saveColumns(nextStatusColumn: string | null) {
    fetch("/api/google/columns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, visibleColumns, statusColumn: nextStatusColumn }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setStatusColumn(nextStatusColumn);
        setStatusFilter("__all__");
        setShowColumnPicker(false);
        loadData(); // re-fetch so the table reflects the new column set immediately
      })
      .catch((e) => setError(e.message));
  }

  // ── Not connected at the app level yet ───────────────────────────────
  if (!googleConnected) {
    return (
      <div className="custom-card p-lg text-center text-body-sm text-on-surface-variant">
        Connect the Google account above first, then come back here to pick this client's sheet.
      </div>
    );
  }

  // ── Step 1: pick a spreadsheet ────────────────────────────────────────
  if (step === "picking-sheet") {
    return (
      <div className="custom-card p-lg max-w-lg mx-auto">
        <h4 className="font-headline-sm text-primary mb-md">Pick a spreadsheet for this client</h4>

        {!files && (
          <button
            onClick={loadSpreadsheets}
            disabled={loadingList}
            className="px-lg py-3 bg-primary text-white rounded-lg font-label-md hover:opacity-90 disabled:opacity-50"
          >
            {loadingList ? "Loading…" : "Show Google Sheets"}
          </button>
        )}

        {error && <p className="text-body-sm text-red-600 mt-md">{error}</p>}

        {files && (
          <div className="divide-y divide-outline-variant/30 mt-sm max-h-80 overflow-y-auto">
            {files.length === 0 && <p className="text-body-sm text-on-surface-variant py-md">No spreadsheets found.</p>}
            {files.map((f) => (
              <button
                key={f.id}
                onClick={() => pickFile(f)}
                disabled={loadingList}
                className="w-full text-left py-md flex items-center gap-sm hover:bg-surface-container rounded-lg px-sm"
              >
                <span className="material-symbols-outlined text-primary text-[20px]">description</span>
                <span className="font-label-md text-on-surface">{f.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Step 2: pick a tab within the spreadsheet ─────────────────────────
  if (step === "picking-tab") {
    return (
      <div className="custom-card p-lg max-w-lg mx-auto">
        <h4 className="font-headline-sm text-primary mb-md">Pick a tab in "{pickedFile?.name}"</h4>
        {error && <p className="text-body-sm text-red-600 mb-md">{error}</p>}
        <div className="flex flex-wrap gap-sm">
          {(tabs ?? []).map((t) => (
            <button
              key={t}
              onClick={() => pickTab(t)}
              disabled={loadingList}
              className="px-md py-sm bg-surface-container rounded-lg font-label-sm hover:bg-primary-container/10 disabled:opacity-50"
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
    <div className="custom-card p-lg">
      <div className="flex flex-wrap items-center justify-between gap-md mb-md">
        <div>
          <h4 className="font-headline-sm text-primary">{currentSpreadsheetName ?? "Assigned sheet"}</h4>
          <p className="text-body-sm text-on-surface-variant">
            Tab: {currentSheetName} · {filteredRows.length} of {rows.length} leads
          </p>
        </div>
        <div className="flex gap-sm">
          {statusColumn && statusValues.length > 0 && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-md py-2 border border-outline-variant rounded-lg font-label-sm bg-white"
            >
              <option value="__all__">All statuses ({rows.length})</option>
              {statusValues.map((v) => (
                <option key={v} value={v}>
                  {v} ({statusCounts[v] ?? 0})
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => setShowColumnPicker((s) => !s)}
            className="flex items-center gap-xs px-md py-2 border border-outline-variant rounded-lg font-label-sm hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-[16px]">view_column</span>
            Columns
          </button>
          <button
            onClick={() => setStep("picking-sheet")}
            className="flex items-center gap-xs px-md py-2 border border-outline-variant rounded-lg font-label-sm hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-[16px]">swap_horiz</span>
            Change sheet
          </button>
        </div>
      </div>

      {showColumnPicker && (
        <div className="mb-md p-md bg-surface-container rounded-lg">
          <p className="text-label-sm text-on-surface-variant mb-sm">Visible columns (unchecked = hidden, data not sent to the browser at all)</p>
          <div className="flex flex-wrap gap-sm mb-md">
            {allColumns.map((h) => (
              <label key={h} className="flex items-center gap-xs px-sm py-1 bg-white rounded-md border border-outline-variant/50 text-label-sm cursor-pointer">
                <input type="checkbox" checked={visibleColumns.includes(h)} onChange={() => toggleColumn(h)} />
                {h}
              </label>
            ))}
          </div>

          <p className="text-label-sm text-on-surface-variant mb-sm">Status column (drives the filter dropdown, must be visible)</p>
          <select
            value={statusColumn ?? ""}
            onChange={(e) => setStatusColumn(e.target.value || null)}
            className="mb-md px-md py-2 border border-outline-variant rounded-lg font-label-sm bg-white"
          >
            <option value="">None</option>
            {visibleColumns.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>

          <div>
            <button onClick={() => saveColumns(statusColumn)} className="px-md py-2 bg-primary text-white rounded-lg font-label-sm hover:opacity-90">
              Save
            </button>
          </div>
        </div>
      )}

      {statusColumn && statusValues.length > 0 && (
        <div className="flex flex-wrap gap-sm mb-md">
          {statusValues.map((v) => (
            <button
              key={v}
              onClick={() => setStatusFilter(statusFilter === v ? "__all__" : v)}
              className={`px-sm py-1 rounded-full text-label-sm border ${
                statusFilter === v
                  ? "bg-primary text-white border-primary"
                  : "bg-surface-container text-on-surface border-outline-variant/50 hover:bg-primary-container/10"
              }`}
            >
              {v} · {statusCounts[v] ?? 0}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-body-sm text-red-600 mb-md">{error}</p>}
      {loadingData && <p className="text-body-sm text-on-surface-variant">Loading leads…</p>}

      {!loadingData && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-body-sm">
            <thead>
              <tr className="border-b border-outline-variant">
                {headers.map((h) => (
                  <th key={h} className="py-sm pr-lg font-label-sm text-on-surface-variant whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/30">
              {filteredRows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="py-sm pr-lg text-on-surface whitespace-nowrap">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={headers.length || 1} className="py-lg text-on-surface-variant">
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