import { SignIn } from "@clerk/nextjs";
import LoginError from "@/components/LoginError";

const ERROR_MESSAGES: Record<string, string> = {
  "no-access": "That account doesn't have access to Hive HQ yet. Ask an admin to add you from Settings, then try again.",
};

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  const errorMessage = searchParams.error ? ERROR_MESSAGES[searchParams.error] ?? "Something went wrong signing you in. Please try again." : null;

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
          {/* White version of the blue logo — blue-on-blue would disappear on this panel */}
          <img src="/logo.webp" alt="Hive HQ" width={48} height={48} className="w-12 h-12" style={{ filter: "brightness(0) invert(1)" }} />
        </div>
        <div className="relative">
          <h1 className="font-heading font-bold text-white mb-4" style={{ fontSize: "3.25rem", lineHeight: 1.05, letterSpacing: "-0.02em" }}>
            Hive HQ
          </h1>
          <p className="text-lg max-w-md" style={{ color: "rgba(255,255,255,0.85)" }}>
            Hive Social's internal client portal — leads, ad performance, revenue,
            and referrals, all in one place.
          </p>
        </div>
        <div className="relative text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>
          © {new Date().getFullYear()} Hive HQ
        </div>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center p-6">
        {errorMessage ? (
          <LoginError message={errorMessage} />
        ) : (
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
        )}
      </div>
    </div>
  );
}
