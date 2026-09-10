"use client";

import { useFormState } from "react-dom";
import { useState } from "react";
import { createUser, deleteUser } from "@/lib/actions";
import type { CreateClientState } from "@/lib/actions";
import AddClientModal from "../clients/AddClientModal";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: "COACH" | "CLIENT";
  clientName: string | null;
};

type ClientOption = { id: string; name: string };

type CreateUserState = { email: string; tempPassword: string } | { error: string } | null;

async function createUserAction(_prev: CreateUserState, formData: FormData): Promise<CreateUserState> {
  try {
    const result = await createUser(formData);
    return result;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Something went wrong" };
  }
}

export default function UsersPanel({
  users,
  clients,
  onCreateClient,
}: {
  users: UserRow[];
  clients: ClientOption[];
  onCreateClient: (prev: CreateClientState, formData: FormData) => Promise<CreateClientState>;
}) {
  const [state, formAction] = useFormState(createUserAction, null);
  const [role, setRole] = useState<"CLIENT" | "COACH">("CLIENT");

  return (
    <section className="card rounded-2xl p-6">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="font-heading font-bold text-lg" style={{ color: "var(--text-primary)" }}>
          Users & logins
        </h3>
        <AddClientModal action={onCreateClient} />
      </div>
      <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
        Admins see every client. Client logins only ever see their own data. Need a new client first? Use "Add Client" above.
      </p>

      <div className="space-y-2 mb-5">
        {users.map((u) => (
          <div key={u.id} className="flex items-center justify-between rounded-lg p-3" style={{ background: "var(--surface)" }}>
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                {u.name} <span style={{ color: "var(--text-muted)" }}>· {u.email}</span>
              </p>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {u.role === "COACH" ? "Admin (full access)" : `Client · ${u.clientName ?? "—"}`}
              </p>
            </div>
            <form action={deleteUser.bind(null, u.id)}>
              <button
                type="submit"
                className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                style={{ color: "var(--danger)", border: "1px solid var(--border-strong)" }}
              >
                Remove
              </button>
            </form>
          </div>
        ))}
        {users.length === 0 && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No users yet.</p>}
      </div>

      {state && "tempPassword" in state && (
        <div
          className="mb-4 px-4 py-3 rounded-lg text-sm space-y-1"
          style={{ background: "var(--primary-tint)", color: "var(--text-primary)" }}
        >
          <p className="font-semibold">Login created for {state.email}</p>
          <p>
            Temporary password: <code className="font-mono font-bold">{state.tempPassword}</code>
          </p>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Copy this now — it won't be shown again. Send it to them securely and have them sign in at /login.
          </p>
        </div>
      )}
      {state && "error" in state && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm" style={{ background: "var(--danger-tint)", color: "var(--danger)" }}>
          {state.error}
        </div>
      )}

      <form action={formAction} className="grid grid-cols-2 gap-3">
        <input
          name="name" required placeholder="Full name"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          className="px-3 py-2 rounded-lg outline-none text-sm"
        />
        <input
          name="email" type="email" required placeholder="Email"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          className="px-3 py-2 rounded-lg outline-none text-sm"
        />
        <select
          name="role" value={role} onChange={(e) => setRole(e.target.value as "CLIENT" | "COACH")}
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          className="px-3 py-2 rounded-lg outline-none text-sm"
        >
          <option value="CLIENT">Client (their data only)</option>
          <option value="COACH">Admin (full access)</option>
        </select>
        {role === "CLIENT" ? (
          <select
            name="clientId" required
            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            className="px-3 py-2 rounded-lg outline-none text-sm"
          >
            <option value="">Choose a client...</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        ) : (
          <div />
        )}
        <button
          type="submit"
          className="col-span-2 px-4 py-2 rounded-lg text-sm font-bold"
          style={{ background: "var(--primary)", color: "#fff" }}
        >
          Create login
        </button>
      </form>
    </section>
  );
}