"use client";

import { useClerk } from "@clerk/nextjs";
import { useState } from "react";

export default function LoginError({ message }: { message: string }) {
  const { signOut } = useClerk();
  const [signingOut, setSigningOut] = useState(false);

  function retry() {
    setSigningOut(true);
    // Clears the stuck (authenticated but no-access) session so the sign-in
    // form actually shows again instead of Clerk treating this as "already
    // signed in" — without this, reloading /login just loops back here.
    signOut({ redirectUrl: "/login" });
  }

  return (
    <div className="w-full max-w-sm text-center">
      <div className="mb-6 p-4 rounded-xl text-sm" style={{ background: "#FEE2E2", color: "#B91C1C", border: "1px solid #FCA5A5" }}>
        {message}
      </div>
      <button
        onClick={retry}
        disabled={signingOut}
        className="px-4 py-2.5 rounded-lg text-sm font-bold disabled:opacity-50"
        style={{ background: "#0071E3", color: "#fff" }}
      >
        {signingOut ? "Trying again…" : "Try again"}
      </button>
    </div>
  );
}
