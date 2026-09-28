import { prisma } from "@/lib/prisma";
import { submitPublicReferral } from "@/lib/actions";
import { notFound } from "next/navigation";

export default async function PublicReferralPage({ params }: { params: { code: string } }) {
  const link = await prisma.referralLink.findUnique({ where: { code: params.code } });
  if (!link) notFound();

  const action = submitPublicReferral.bind(null, params.code);

  return (
    <div className="dark min-h-screen flex items-center justify-center p-6" style={{ background: "var(--surface, #000000)" }}>
      <div
        className="w-full max-w-md rounded-2xl p-8"
        style={{ background: "var(--surface-card, #1D1D1F)", border: "1px solid var(--border, #2C2C2E)" }}
      >
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold mb-6"
          style={{ background: "var(--primary)" }}
        >
          C
        </div>
        <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--text-primary, #F5F5F7)" }}>
          Refer someone
        </h1>
        <p className="mb-6" style={{ color: "var(--text-secondary, #A1A1A6)" }}>
          You're using {link.label}'s link. Tell us who to reach out to.
        </p>

        <form action={action} className="space-y-4">
          {/* Honeypot — hidden from humans, bots fill it and get silently dropped. */}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
          />
          <div>
            <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-secondary, #A1A1A6)" }}>
              Their name
            </label>
            <input
              name="name"
              required
              style={{ width: "100%", background: "var(--surface, #000000)", border: "1px solid var(--border, #2C2C2E)", color: "var(--text-primary, #F5F5F7)" }}
              className="px-3 py-2.5 rounded-lg outline-none"
              placeholder="Full name"
            />
          </div>
          <div>
            <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-secondary, #A1A1A6)" }}>
              Best way to reach them
            </label>
            <input
              name="source"
              style={{ width: "100%", background: "var(--surface, #000000)", border: "1px solid var(--border, #2C2C2E)", color: "var(--text-primary, #F5F5F7)" }}
              className="px-3 py-2.5 rounded-lg outline-none"
              placeholder="WhatsApp, Instagram, phone number..."
            />
          </div>
          <div>
            <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-secondary, #A1A1A6)" }}>
              Anything we should know?
            </label>
            <textarea
              name="note"
              rows={3}
              style={{ width: "100%", background: "var(--surface, #000000)", border: "1px solid var(--border, #2C2C2E)", color: "var(--text-primary, #F5F5F7)" }}
              className="px-3 py-2.5 rounded-lg outline-none resize-none"
              placeholder="How do you know them, what are they looking for..."
            />
          </div>
          <button
            type="submit"
            className="w-full py-3 rounded-lg font-bold"
            style={{ background: "var(--primary)", color: "#fff" }}
          >
            Submit referral
          </button>
        </form>
      </div>
    </div>
  );
}
