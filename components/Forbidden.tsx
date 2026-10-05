// A signed-in user who can't see this client (e.g. an email link for someone
// else's account) — a plain 403, never another client's data.
export default function Forbidden() {
  return (
    <div className="p-10 max-w-[600px] mx-auto text-center">
      <p className="font-heading text-2xl font-bold" style={{ color: "var(--text-primary)" }}>403 — no access</p>
      <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
        You&apos;re signed in, but this account can&apos;t see that client. Check you&apos;re using the right login.
      </p>
    </div>
  );
}
