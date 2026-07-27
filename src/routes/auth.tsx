import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { User, Users, BookOpen, MailCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { OtpInput } from "@/components/OtpInput";
import { AuthShell, BrandPanel } from "@/components/auth/AuthShell";

// Supabase's Email OTP Length is a project setting (6–10); this project is set
// to 8, and the digit boxes have to match it exactly.
const OTP_LENGTH = 8;

type SearchParams = {
  mode?: "signin" | "signup";
  tier?: string;
  level?: string;
  subjects?: string;
  board?: string;
  redirect?: string;
};

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in | Anglia Educate" },
      { name: "description", content: "Log in or create your Anglia Educate account." },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    mode: search.mode === "signup" ? "signup" : "signin",
    tier: typeof search.tier === "string" ? search.tier : undefined,
    level: typeof search.level === "string" ? search.level : undefined,
    subjects: typeof search.subjects === "string" ? search.subjects : undefined,
    board: typeof search.board === "string" ? search.board : undefined,
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: AuthPage,
});

type Role = "student" | "parent";

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">(search.mode ?? "signin");
  const [role, setRole] = useState<Role>("student");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [resendIn, setResendIn] = useState(0);

  // Level, exam board and subjects are captured in /onboarding now, not here.
  // Sign-up is only "who are you"; what you study — and whether you've paid for
  // it — is settled after the email is verified.

  // Honor the guard's ?redirect= deep link, but only for safe in-app paths
  // (must start with "/" and not "//") to avoid open-redirects.
  const dest =
    search.redirect && search.redirect.startsWith("/") && !search.redirect.startsWith("//")
      ? search.redirect
      : "/dashboard";

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: dest as never });
    });
  }, [navigate, dest]);

  // Cooldown between "resend code" presses. GoTrue rate-limits these server
  // side anyway; this just stops people hammering the button and eating the
  // limit before the first email has even landed.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: name || email.split("@")[0],
              role,
              parent_invite_code: role === "parent" ? inviteCode || null : null,
              // The plan the student picked on the pricing page. Stashed here so
              // it survives the email-verification round-trip and can seed the
              // onboarding steps. Every one of these stays editable there.
              intended_tier: search.tier ?? null,
              intended_level: search.level ?? null,
              intended_subjects: search.subjects ?? null,
              intended_board: search.board ?? null,
            },
          },
        });
        if (error) throw error;
        // Signing up with an address that already has a confirmed account is a
        // silent no-op server side — GoTrue won't confirm or deny that the email
        // is registered, so it returns a success-shaped user with no session and
        // sends nothing. The empty identities array is the only tell. Without
        // this branch the user waits on a code screen for a code that will never
        // arrive.
        if (data.user && data.user.identities?.length === 0) {
          toast.error("That email already has an account. Try logging in.");
          setMode("signin");
          setPassword("");
        } else if (data.session) {
          toast.success("Account created");
          navigate({ to: dest as never });
        } else {
          toast.success("We've emailed you a verification code.");
          setEmailSentTo(email);
          setResendIn(60);
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Signed in");
        navigate({ to: dest as never });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  // Codes rather than magic links: school and university mail systems run link
  // scanners (Microsoft Safe Links and friends) that fetch every URL in an
  // inbound message, which burns a single-use confirmation link before the
  // student ever sees it. A code can't be consumed by a scanner.
  const handleVerify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!emailSentTo || loading || otp.length < OTP_LENGTH) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: emailSentTo,
        token: otp.trim(),
        type: "signup",
      });
      if (error) throw error;
      toast.success("Email verified");
      // verifyOtp returns a session, so the onboarding guard will let them in.
      navigate({ to: "/onboarding/board" as never });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That code didn't work");
      setOtp("");
    } finally {
      setLoading(false);
    }
  };

  // Submit as soon as the last box is filled — typing or pasting a full code
  // and then reaching for a button is the bit that feels clunky.
  useEffect(() => {
    if (emailSentTo && otp.length === OTP_LENGTH && !loading) void handleVerify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, emailSentTo]);

  const handleResend = async () => {
    if (!emailSentTo || resendIn > 0) return;
    const { error } = await supabase.auth.resend({ type: "signup", email: emailSentTo });
    if (error) return toast.error(error.message);
    toast.success("New code sent");
    setOtp("");
    setResendIn(60);
  };

  return (
    <AuthShell>
      <div className="grid lg:grid-cols-[1.05fr_1fr] gap-8 items-stretch">
        <BrandPanel />
        <div className="premium-card rounded-3xl p-6 sm:p-8 rise-in [--rise-delay:80ms] self-center w-full">
          {emailSentTo ? (
            <div className="text-center py-2">
              <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-5 text-primary">
                <MailCheck className="w-7 h-7" />
              </div>
              <h1 className="font-display text-2xl font-semibold tracking-tight mb-2">
                Enter your code
              </h1>
              <p className="text-sm text-muted-foreground mb-7 leading-relaxed">
                We've sent an {OTP_LENGTH}-digit code to{" "}
                <strong className="text-foreground">{emailSentTo}</strong>.
                <br />
                It expires in 1 hour.
              </p>

              <form onSubmit={handleVerify} className="space-y-5">
                <OtpInput
                  autoFocus
                  length={OTP_LENGTH}
                  value={otp}
                  onChange={setOtp}
                  disabled={loading}
                />
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
                  className="w-full text-xs text-muted-foreground hover:text-primary disabled:hover:text-muted-foreground"
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
                  className="w-full text-xs text-muted-foreground hover:text-foreground"
                >
                  Back to log in
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-1 p-1 bg-secondary/70 border border-border/70 rounded-xl mb-7">
                {(["signin", "signup"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`py-2.5 rounded-lg text-sm font-semibold transition ${
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
                  : search.tier
                    ? `Great pick — you're signing up for the ${search.tier.replaceAll("_", " ")} plan.`
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
                      {r === "student" ? (
                        <User className="w-4 h-4" />
                      ) : (
                        <Users className="w-4 h-4" />
                      )}
                      {r === "student" ? "Student" : "Parent"}
                    </button>
                  ))}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === "signup" && (
                  <Field label="Full name">
                    <input
                      required
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={inputCls}
                      placeholder="Jamie Doe"
                    />
                  </Field>
                )}
                {mode === "signup" && role === "parent" && (
                  <Field label="Student invite code">
                    <input
                      required
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
                <Field label="Email">
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputCls}
                    placeholder="you@example.com"
                  />
                </Field>
                <Field label="Password">
                  <input
                    required
                    minLength={6}
                    type="password"
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
                    onClick={async () => {
                      if (!email) return toast.error("Enter your email above first");
                      const { error } = await supabase.auth.resetPasswordForEmail(email, {
                        redirectTo: `${window.location.origin}/reset-password`,
                      });
                      if (error) toast.error(error.message);
                      else toast.success("Password reset email sent");
                    }}
                    className="w-full text-xs text-muted-foreground hover:text-primary"
                  >
                    Forgot password?
                  </button>
                )}
              </form>

              {mode === "signup" && (
                <p className="mt-4 text-xs text-muted-foreground text-center">
                  <BookOpen className="w-3 h-3 inline mr-1" />
                  Next you'll set up your profile and choose a plan.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </AuthShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

const inputCls =
  "w-full h-11 rounded-xl bg-background border border-border px-3.5 text-sm placeholder:text-muted-foreground/70 " +
  "transition focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15";
