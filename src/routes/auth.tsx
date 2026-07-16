import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { GraduationCap, ArrowLeft, User, Users, BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";

type SearchParams = {
  mode?: "signin" | "signup";
  tier?: string;
  level?: string;
  redirect?: string;
};

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in | Anglian Learning" },
      { name: "description", content: "Log in or create your Anglian Learning account." },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    mode: search.mode === "signup" ? "signup" : "signin",
    tier: typeof search.tier === "string" ? search.tier : undefined,
    level: typeof search.level === "string" ? search.level : undefined,
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: {
              display_name: name || email.split("@")[0],
              role,
              signup_tier: search.tier ?? null,
              signup_level: search.level ?? null,
              parent_invite_code: role === "parent" ? inviteCode || null : null,
            },
          },
        });
        if (error) throw error;
        if (data.session) {
          toast.success("Account created");
          navigate({ to: dest as never });
        } else {
          toast.success("Check your email to confirm your account.");
          setEmailSentTo(email);
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-md">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to home
        </Link>
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl font-semibold tracking-tight">
            Anglian Learning
          </span>
        </div>

        <div className="rounded-2xl bg-card border border-border p-6 shadow-lg">
          {emailSentTo ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6 text-primary">
                <BookOpen className="w-8 h-8" />
              </div>
              <h1 className="font-display text-2xl font-semibold tracking-tight mb-3">
                Verify your email
              </h1>
              <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                We've sent an email verification link to{" "}
                <strong className="text-foreground">{emailSentTo}</strong>. Please check your inbox
                and click the link to confirm your account.
              </p>
              <div className="bg-muted p-4 rounded-xl text-xs text-left text-muted-foreground mb-6 leading-relaxed space-y-1.5">
                <p className="font-bold text-foreground">Next steps:</p>
                <p>1. Open your email client inbox.</p>
                <p>2. Find the confirmation email from Anglian Learning.</p>
                <p>3. Click the link to activate your account and access your dashboard.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEmailSentTo(null);
                  setMode("signin");
                }}
                className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 transition text-sm shadow-sm"
              >
                Back to Log In
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-lg mb-6">
                {(["signin", "signup"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`py-2 rounded-md text-sm font-semibold transition ${
                      mode === m
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m === "signin" ? "Log in" : "Sign up"}
                  </button>
                ))}
              </div>

              <h1 className="font-display text-2xl font-semibold tracking-tight mb-1">
                {mode === "signin" ? "Welcome back" : "Create your account"}
              </h1>
              <p className="text-sm text-muted-foreground mb-6">
                {mode === "signin"
                  ? "Log in to see your lessons, quizzes, and homework."
                  : search.tier
                    ? `Great pick — you're signing up for the ${search.tier.replaceAll("_", " ")} plan.`
                    : "Start with a student or parent account."}
              </p>

              {mode === "signup" && (
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {(["student", "parent"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={`flex items-center justify-center gap-2 h-10 rounded-lg border text-sm font-semibold ${
                        role === r
                          ? "bg-primary/10 border-primary text-primary"
                          : "border-border text-muted-foreground hover:text-foreground"
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
                  className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 disabled:opacity-60 text-sm shadow-sm"
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
                  Payment for your plan is set up on the next screen.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
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
  "w-full h-10 rounded-lg bg-muted border border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";
