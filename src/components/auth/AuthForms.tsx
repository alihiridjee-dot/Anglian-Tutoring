import { User, Users, BookOpen, MailCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchEnabledSsoProviders } from "@/lib/auth/ssoIntent";
import { OtpInput } from "@/components/OtpInput";
import { OTP_LENGTH, type AuthFlow } from "./useAuthFlow";

/** The code screen shown once a sign-up email has gone out. */
export function VerifyCodeScreen({ flow }: { flow: AuthFlow }) {
  const {
    emailSentTo,
    setEmailSentTo,
    otp,
    setOtp,
    setMode,
    loading,
    resendIn,
    handleVerify,
    handleResend,
  } = flow;
  return (
    <div className="text-center py-2">
      <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-5 text-primary">
        <MailCheck className="w-7 h-7" />
      </div>
      <h1 className="font-display text-2xl font-bold tracking-tight mb-2">Enter your code</h1>
      <p className="text-sm text-muted-foreground mb-7 leading-relaxed">
        We've sent an {OTP_LENGTH}-digit code to{" "}
        <strong className="text-foreground">{emailSentTo}</strong>.
        <br />
        It expires in 1 hour.
      </p>

      <form onSubmit={handleVerify} className="space-y-5">
        <OtpInput autoFocus length={OTP_LENGTH} value={otp} onChange={setOtp} disabled={loading} />
        <button
          type="submit"
          disabled={loading || otp.length < OTP_LENGTH}
          className="btn-premium w-full h-12 rounded-xl font-semibold text-sm"
        >
          {loading ? "Verifying…" : "Verify email"}
        </button>
      </form>

      <div className="mt-6 pt-5 border-t border-border/70 space-y-2">
        <button
          type="button"
          onClick={handleResend}
          disabled={resendIn > 0}
          className="w-full min-h-11 text-xs text-muted-foreground hover:text-primary disabled:hover:text-muted-foreground sm:pointer-fine:min-h-0"
        >
          {resendIn > 0 ? `Resend code in ${resendIn}s` : "Didn't get it? Resend code"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEmailSentTo(null);
            setOtp("");
            setMode("signin");
          }}
          className="w-full min-h-11 text-xs text-muted-foreground hover:text-foreground sm:pointer-fine:min-h-0"
        >
          Back to log in
        </button>
      </div>
    </div>
  );
}

/** Log in or sign up. `tier` is the plan picked on the pricing page, if any. */
export function CredentialsForm({ flow, tier }: { flow: AuthFlow; tier?: string }) {
  const {
    mode,
    setMode,
    role,
    setRole,
    name,
    setName,
    inviteCode,
    setInviteCode,
    email,
    setEmail,
    password,
    setPassword,
    loading,
    handleSubmit,
    handleForgotPassword,
  } = flow;
  return (
    <>
      <div className="grid grid-cols-2 gap-1 p-1 bg-secondary/70 border border-border/70 rounded-xl mb-7">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`min-h-11 py-2.5 rounded-lg text-sm font-semibold transition sm:pointer-fine:min-h-0 ${
              mode === m
                ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m === "signin" ? "Log in" : "Sign up"}
          </button>
        ))}
      </div>

      <h1 className="font-display text-[1.75rem] leading-tight font-bold tracking-tight mb-1.5">
        {mode === "signin" ? (
          <>
            Welcome <span className="text-gradient">back</span>
          </>
        ) : (
          <>
            Create your <span className="text-gradient">account</span>
          </>
        )}
      </h1>
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
        {mode === "signin"
          ? "Log in to see your lessons, quizzes, and homework."
          : tier
            ? `Great pick — you're signing up for the ${tier.replaceAll("_", " ")} plan.`
            : "Start with a student or parent account."}
      </p>

      {mode === "signup" && (
        <div className="grid grid-cols-2 gap-2.5 mb-5">
          {(["student", "parent"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={`flex items-center justify-center gap-2 h-12 rounded-xl border text-sm font-semibold transition ${
                role === r
                  ? "bg-primary/[0.07] border-primary text-primary ring-2 ring-primary/15"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              {r === "student" ? <User className="w-4 h-4" /> : <Users className="w-4 h-4" />}
              {r === "student" ? "Student" : "Parent"}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === "signup" && (
          <Field label="Full name" htmlFor="auth-name">
            <input
              id="auth-name"
              required
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              placeholder="Jamie Doe"
            />
          </Field>
        )}
        {mode === "signup" && role === "parent" && (
          <Field label="Student invite code" htmlFor="auth-invite-code">
            <input
              id="auth-invite-code"
              required
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className={inputCls}
              placeholder="e.g. ANG-4A2C"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Your child receives this code in their account settings.
            </p>
          </Field>
        )}
        <Field label="Email" htmlFor="auth-email">
          <input
            id="auth-email"
            required
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
            placeholder="you@example.com"
          />
        </Field>
        <Field label="Password" htmlFor="auth-password">
          <input
            id="auth-password"
            required
            minLength={6}
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
            placeholder="At least 6 characters"
          />
        </Field>

        <button
          type="submit"
          disabled={loading}
          className="btn-premium w-full h-12 rounded-xl font-semibold text-sm"
        >
          {loading ? "Please wait…" : mode === "signin" ? "Log in" : "Create account"}
        </button>

        {mode === "signin" && (
          <button
            type="button"
            onClick={handleForgotPassword}
            className="w-full min-h-11 text-xs text-muted-foreground hover:text-primary sm:pointer-fine:min-h-0"
          >
            Forgot password?
          </button>
        )}
      </form>

      <SsoButtons flow={flow} />

      {mode === "signup" && (
        <p className="mt-4 text-xs text-muted-foreground text-center">
          <BookOpen className="w-3 h-3 inline mr-1" />
          Next you'll set up your profile and choose a plan.
        </p>
      )}
    </>
  );
}

/**
 * Google and Microsoft, under the email form. On sign-up they use the role and
 * invite code chosen above, so they sit below those fields rather than above.
 * Slate-tinted so they don't compete with the main button; the logos keep
 * their own brand colours, which the providers' guidelines require.
 */
function SsoButtons({ flow }: { flow: AuthFlow }) {
  const { mode, loading, handleOAuth } = flow;
  const { data: providers = [] } = useQuery({
    queryKey: ["auth", "sso-providers"],
    queryFn: fetchEnabledSsoProviders,
    staleTime: 5 * 60_000,
  });
  if (providers.length === 0) return null;
  const verb = mode === "signin" ? "Log in" : "Sign up";
  return (
    <div className="tint-slate mt-5">
      <div className="flex items-center gap-3 mb-4" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        <span className="eyebrow eyebrow-bare">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid gap-2.5">
        {providers.includes("google") && (
          <button
            type="button"
            disabled={loading}
            onClick={() => handleOAuth("google")}
            className="btn-soft flex w-full h-12 items-center justify-center gap-2.5 rounded-xl text-sm"
          >
            <GoogleLogo />
            {verb} with Google
          </button>
        )}
        {providers.includes("azure") && (
          <button
            type="button"
            disabled={loading}
            onClick={() => handleOAuth("azure")}
            className="btn-soft flex w-full h-12 items-center justify-center gap-2.5 rounded-xl text-sm"
          >
            <MicrosoftLogo />
            {verb} with Microsoft
          </button>
        )}
      </div>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="w-[18px] h-[18px]" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" className="w-[17px] h-[17px]" aria-hidden>
      <path fill="#F25022" d="M1 1h9v9H1z" />
      <path fill="#7FBA00" d="M11 1h9v9h-9z" />
      <path fill="#00A4EF" d="M1 11h9v9H1z" />
      <path fill="#FFB900" d="M11 11h9v9h-9z" />
    </svg>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

const inputCls =
  "w-full h-11 rounded-xl bg-background border border-border px-3.5 text-sm placeholder:text-muted-foreground/70 " +
  "transition focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15";
