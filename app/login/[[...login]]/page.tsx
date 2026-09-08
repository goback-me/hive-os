import { SignIn } from "@clerk/nextjs";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex" style={{ background: "var(--surface)" }}>
      {/* Brand panel — hidden on narrow screens, the Apple-Store-style bold
          statement half. Just the app's own --primary token + the existing
          .glow-tile radial gradient, no new colors. */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-between p-16 relative overflow-hidden"
        style={{ background: "var(--primary)" }}
      >
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(circle at 70% 20%, rgba(255,255,255,0.16), transparent 55%)" }}
        />
        <div className="relative">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-white font-bold text-lg" style={{ background: "rgba(255,255,255,0.15)" }}>
            H
          </div>
        </div>
        <div className="relative">
          <h1 className="font-heading font-bold text-white mb-4" style={{ fontSize: "3.25rem", lineHeight: 1.05, letterSpacing: "-0.02em" }}>
            Hive OS
          </h1>
          <p className="text-lg max-w-md" style={{ color: "rgba(255,255,255,0.85)" }}>
            Hive Social's internal client portal — leads, ad performance, revenue,
            and referrals, all in one place.
          </p>
        </div>
        <div className="relative text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>
          © {new Date().getFullYear()} Hive OS
        </div>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center p-6">
        <SignIn
          path="/login"
          routing="path"
          fallbackRedirectUrl="/dashboard"
          // No self-serve accounts in this app — a coach creates every login
          // from Settings. This just hides the "Sign up" link/footer; the real
          // lock is disabling sign-up in the Clerk dashboard (see README/setup notes).
          appearance={{
            variables: {
              colorPrimary: "#0071E3",
              colorText: "#1D1D1F",
              colorTextSecondary: "#86868B",
              colorBackground: "#ffffff",
              colorInputBackground: "#ffffff",
              colorInputText: "#1D1D1F",
              borderRadius: "0.75rem",
              fontFamily: "\"Inter\", \"SF Pro Text\", \"SF Pro Icons\", \"Helvetica Neue\", Helvetica, Arial, sans-serif",
            },
            elements: {
              footerAction: "hidden",
              footer: "hidden",
              card: "shadow-none border border-[#D2D2D7]",
            },
          }}
        />
      </div>
    </div>
  );
}
