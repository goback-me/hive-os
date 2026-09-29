// Coach-only marker on a section/card the client's own login doesn't see.
export default function HiddenBadge({ reason }: { reason?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap"
      style={{ background: "var(--surface-hover)", color: "var(--text-secondary)", border: "1px dashed var(--border-strong)" }}
      title={reason ? `Hidden from client — ${reason}` : "Hidden from client"}
    >
      <span className="material-symbols-outlined text-[12px]">visibility_off</span>
      Hidden from client
    </span>
  );
}
