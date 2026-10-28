import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BrandMark } from "@/components/auth/AuthShell";
import { validatePassword } from "@/lib/auth/validation";
import { readProviderError } from "@/lib/auth/ssoIntent";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password | Anglia Educate" },
      { name: "description", content: "Set a new password for your account." },
    ],
  }),
  component: ResetPasswordPage,
});

/** True when the session was opened from a reset link (GoTrue records AMR "recovery"). */
function isRecoverySession(amr: unknown): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) =>
    typeof entry === "string" ? entry === "recovery" : entry?.method === "recovery",
  );
}

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  // Signed in, but not from a reset link.
  const [ordinarySession, setOrdinarySession] = useState(false);
  // "failed": the link expired or was already used (a school mail scanner can
  // open it first). "missing": no link at all. Either way, nothing is coming.
  const [linkProblem, setLinkProblem] = useState<"failed" | "missing" | null>(null);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    // A link that didn't work comes back with its reason in the address, not a
    // session. Read it before anything else, then take it out of the address.
    const arrivedWithLink =
      /access_token|type=recovery/.test(window.location.hash) ||
      new URLSearchParams(window.location.search).has("code");
    if (readProviderError()) {
      setLinkProblem("failed");
      const url = new URL(window.location.href);
      for (const k of ["error", "error_code", "error_description"]) url.searchParams.delete(k);
      url.hash = "";
      window.history.replaceState(window.history.state, "", url);
    }

    // Only a session opened from the reset email may set a password here. An
    // ordinary signed-in session must go through the profile page, which asks
    // for the current password first — otherwise a borrowed laptop is enough to
    // take the account over.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    // The event can fire while the client initialises, before this listener is
    // attached, so also read how the current session was authenticated.
    supabase.auth.getClaims().then(({ data }) => {
      if (!data) {
        if (!arrivedWithLink) setLinkProblem((p) => p ?? "missing");
        return;
      }
      if (isRecoverySession(data.claims.amr)) setReady(true);
      else setOrdinarySession(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validatePassword(password);
    if (problem) {
      toast.error(problem);
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated. Signing you in…");
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update password");
    } finally {
      setLoading(false);
    }
  };

  const sendNewLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSending(false);
    if (error) toast.error(error.message);
    else toast.success("Password reset email sent");
  };

  // No usable link: ask for the email again instead of a password.
  const needsLink = !ready && linkProblem !== null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        {/* The shared lockup rather than a local copy — this page having its own
            hardcoded wordmark is exactly why it was still saying the old name
            long after everything else was rebranded. */}
        <div className="flex items-center justify-center mb-8">
          <BrandMark />
        </div>

        <div className="rounded-2xl premium-card p-6 shadow-lg">
          <h1 className="font-display text-2xl font-bold tracking-tight mb-1">
            Set a new password
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            {ready ? (
              "Enter and confirm your new password below."
            ) : linkProblem === "failed" ? (
              "This link has expired or has already been used. Send yourself a new one."
            ) : ordinarySession ? (
              <>
                This page only works from the link in a password reset email. To change your
                password while signed in, go to{" "}
                <Link to="/profile" className="underline underline-offset-2 text-foreground">
                  your profile
                </Link>
                .
              </>
            ) : linkProblem === "missing" ? (
              "Open the link in your password reset email, or send yourself a new one."
            ) : (
              "Waiting for your recovery link… If nothing happens, request a new email."
            )}
          </p>
          {needsLink && (
            <form onSubmit={sendNewLink} className="space-y-4">
              <div>
                <label
                  htmlFor="reset-email"
                  className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Email
                </label>
                <input
                  id="reset-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full h-10 rounded-lg bg-secondary border border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <button
                type="submit"
                disabled={sending}
                className="w-full h-11 sm:pointer-fine:h-10 rounded-lg btn-solid font-semibold text-sm hover:opacity-90 disabled:opacity-60"
              >
                {sending ? "Sending…" : "Send a new link"}
              </button>
              <Link
                to="/auth"
                className="flex w-full min-h-11 items-center justify-center text-xs text-muted-foreground hover:text-foreground sm:pointer-fine:min-h-0"
              >
                Back to log in
              </Link>
            </form>
          )}
          <form onSubmit={handleSubmit} hidden={needsLink} className="space-y-4">
            <div>
              <label
                htmlFor="reset-new-password"
                className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
              >
                New password
              </label>
              <input
                id="reset-new-password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full h-10 rounded-lg bg-secondary border border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label
                htmlFor="reset-confirm-password"
                className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
              >
                Confirm password
              </label>
              <input
                id="reset-confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="mt-1 w-full h-10 rounded-lg bg-secondary border border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !ready}
              className="w-full h-11 sm:pointer-fine:h-10 rounded-lg btn-solid font-semibold text-sm hover:opacity-90 disabled:opacity-60"
            >
              {loading ? "Updating…" : "Update password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
