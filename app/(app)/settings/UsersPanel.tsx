"use client";

import { useFormState } from "react-dom";
import { useState } from "react";
import { createUser, deleteUser, saveUserClickUp } from "@/lib/actions";
import type { CreateClientState } from "@/lib/actions";
import AddClientModal from "../clients/AddClientModal";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "COACH" | "CLIENT" | "AGENT";
  clientName: string | null;
  clickupUserId: string | null;
};

const ROLE_LABELS: Record<UserRow["role"], string> = {
  ADMIN: "Admin (all clients + integrations)",
  COACH: "Manager (all clients)",
  AGENT: "Agent (only the clients they run the weekly call for)",
  CLIENT: "Client (their data only)",
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
  canManageAdmins,
  clickupMembers,
}: {
  users: UserRow[];
  clients: ClientOption[];
  onCreateClient: (prev: CreateClientState, formData: FormData) => Promise<CreateClientState>;
  canManageAdmins: boolean;
  clickupMembers: { id: string; name: string }[] | null; // null = ClickUp not set up
}) {
  const [state, formAction] = useFormState(createUserAction, null);
  const [role, setRole] = useState<UserRow["role"]>("CLIENT");

  return (
    <section className="card rounded-2xl p-6">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="font-heading font-bold text-lg" style={{ color: "var(--text-primary)" }}>
          Users & logins
        </h3>
        <AddClientModal action={onCreateClient} team={users.filter((u) => u.role !== "CLIENT").map((u) => ({ id: u.id, name: u.name }))} />
      </div>
      <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
        Admins and managers see every client; only admins manage the Google connection and other admins. Client logins only ever see their own data. Need a new client first? Use "Add Client" above.
      </p>

      <div className="space-y-2 mb-5">
        {users.map((u) => (
          <div key={u.id} className="flex items-center justify-between rounded-lg p-3" style={{ background: "var(--surface)" }}>
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                {u.name} <span style={{ color: "var(--text-muted)" }}>· {u.email}</span>
              </p>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {u.role === "CLIENT" ? `Client · ${u.clientName ?? "—"}` : ROLE_LABELS[u.role]}
              </p>
            </div>
            {/* Team member ↔ ClickUp user: weekly call tasks get assigned to them. */}
            {u.role !== "CLIENT" && clickupMembers && (
              <select
                defaultValue={u.clickupUserId ?? ""}
                onChange={(e) => saveUserClickUp(u.id, e.target.value || null)}
                className="ml-auto mr-3 px-2 py-1.5 rounded-lg outline-none text-xs"
                style={{ background: "var(--surface-card)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                aria-label={`${u.name}'s ClickUp user`}
              >
                <option value="">No ClickUp user</option>
                {clickupMembers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            )}
            {(u.role !== "ADMIN" || canManageAdmins) && <form action={deleteUser.bind(null, u.id)}>
              <button
                type="submit"
                className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                style={{ color: "var(--danger)", border: "1px solid var(--border-strong)" }}
              >
                Remove
              </button>
            </form>}
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
          name="role" value={role} onChange={(e) => setRole(e.target.value as UserRow["role"])}
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          className="px-3 py-2 rounded-lg outline-none text-sm"
        >
          <option value="CLIENT">{ROLE_LABELS.CLIENT}</option>
          <option value="COACH">{ROLE_LABELS.COACH}</option>
          <option value="AGENT">{ROLE_LABELS.AGENT}</option>
          {canManageAdmins && <option value="ADMIN">{ROLE_LABELS.ADMIN}</option>}
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