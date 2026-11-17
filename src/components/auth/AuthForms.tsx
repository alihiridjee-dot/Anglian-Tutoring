import { User, Users, MailCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchEnabledSsoProviders } from "@/lib/auth/ssoIntent";
import { OtpInput } from "@/components/OtpInput";
import { PASSWORD_MIN } from "@/lib/auth/validation";
import { DISPLAY_NAME_MAX } from "@/lib/platform/textLimits";
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
        We've sent a {OTP_LENGTH}-digit code to{" "}
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

/**
 * Log in or sign up. `tier` is the plan picked on the pricing page, if any.
 * `joining` is the child's first name on a parent's "My parent is paying" link:
 * the account is a parent's and the link says which child, so there is no
 * role to pick and no invite code to type.
 */
export function CredentialsForm({
  flow,
  tier,
  joining,
}: {
  flow: AuthFlow;
  tier?: string;
  joining?: string;
}) {
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
  // One plain line under the heading, only when it says something: which
  // child a parent is paying for, or the plan picked on the pricing page.
  const subline = joining
    ? mode === "signin"
      ? `Log in, then pay for ${joining}'s plan.`
      : `Then you'll pay for ${joining}'s plan.`
    : mode === "signup" && tier
      ? `Great pick — you're signing up for the ${tier.replaceAll("_", " ")} plan.`
      : null;
  return (
    <>
      {/* One soft pill slides between the two, as in the sidebar. No track,
          no outline. */}
      <div className="auth-switch tint-primary mb-7" data-right={mode === "signup" || undefined}>
        <span className="auth-switch-pill" aria-hidden />
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className="auth-switch-btn min-h-11 rounded-xl py-2.5 text-base sm:pointer-fine:min-h-0"
          >
            {m === "signin" ? "Log in" : "Sign up"}
          </button>
        ))}
      </div>

      <h1 className="mb-6 text-[2rem] leading-tight font-extrabold">
        {mode === "signin" ? (
          <>
            Welcome back{" "}
            <span key="wave" className="tutor-wave" data-go aria-hidden>
              👋
            </span>
          </>
        ) : joining ? (
          <>
            Create your parent account{" "}
            <span key="spark" className="tutor-wave" data-go aria-hidden>
              ✨
            </span>
          </>
        ) : (
          <>
            Create your account{" "}
            <span key="spark" className="tutor-wave" data-go aria-hidden>
              ✨
            </span>
          </>
        )}
      </h1>
      {subline && <p className="-mt-3 mb-6 text-base leading-relaxed">{subline}</p>}

      {mode === "signup" && !joining && (
        <div className="auth-switch tint-accent mb-5" data-right={role === "parent" || undefined}>
          <span className="auth-switch-pill" aria-hidden />
          {(["student", "parent"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              aria-pressed={role === r}
              className="auth-switch-btn flex h-12 items-center justify-center gap-2 rounded-xl text-base"
            >
              {r === "student" ? <User className="size-5" /> : <Users className="size-5" />}
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
              maxLength={DISPLAY_NAME_MAX}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              placeholder="Jamie Doe"
            />
          </Field>
        )}
        {mode === "signup" && role === "parent" && !joining && (
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
            <p className="mt-1.5 text-sm">
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
            // Sign-up checks PASSWORD_MIN on submit, in the site's words, rather
            // than the browser's. Sign-in keeps the old floor of 6.
            minLength={mode === "signin" ? 6 : undefined}
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
            placeholder={`At least ${mode === "signin" ? 6 : PASSWORD_MIN} characters`}
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
            className="w-full min-h-11 text-sm font-bold text-foreground hover:text-primary sm:pointer-fine:min-h-0"
          >
            Forgot password?
          </button>
        )}
      </form>

      <SsoButtons flow={flow} />

      {mode === "signup" && !joining && (
        <p className="mt-5 text-center text-base font-semibold">
          Next you'll set up your profile and choose a plan.
        </p>
      )}
    </>
  );
}

/**
 * Google and Microsoft, under the email form. On sign-up they use the role and
 * invite code chosen above, so they sit below those fields rather than above.
 * Two white buttons side by side, logo and name, so they don't compete with
 * the main button. The logos keep their own brand colours and shapes, which
 * the providers' guidelines require.
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
  const list = [
    providers.includes("google") && {
      id: "google" as const,
      name: "Google",
      Logo: GoogleLogo,
    },
    providers.includes("azure") && {
      id: "azure" as const,
      name: "Microsoft",
      Logo: MicrosoftLogo,
    },
  ].filter((p) => !!p);

  return (
    <div className="tint-slate mt-6">
      <p className="mb-4 text-center text-base font-bold">or {verb.toLowerCase()} with</p>
      <div className="grid grid-cols-2 gap-3">
        {list.map(({ id, name, Logo }) => (
          <button
            key={id}
            type="button"
            disabled={loading}
            onClick={() => handleOAuth(id)}
            aria-label={`${verb} with ${name}`}
            className="auth-sso btn-soft flex h-14 w-full items-center justify-center gap-3 rounded-2xl text-base"
          >
            <Logo className="auth-sso-logo size-6" />
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
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

function MicrosoftLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 21 21" className={className} aria-hidden>
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
      <label htmlFor={htmlFor} className="text-sm font-bold text-foreground">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/** The kit's input, tinted by the brand. */
const inputCls = "pop-input tint-primary w-full h-12 px-4 text-base";
