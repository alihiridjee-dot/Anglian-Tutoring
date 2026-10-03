import { useEffect, useState } from "react";
import { type useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { invalidateGuardState } from "@/lib/auth/guardState";
import {
  finishSsoSignUp,
  readProviderError,
  rememberSsoIntent,
  type SsoProvider,
} from "@/lib/auth/ssoIntent";

// Supabase's Email OTP Length is a project setting (6–10); this project is set
// to 8, and the digit boxes have to match it exactly.
export const OTP_LENGTH = 8;

export type SearchParams = {
  mode?: "signin" | "signup";
  tier?: string;
  level?: string;
  subjects?: string;
  board?: string;
  redirect?: string;
  /** A free-trial code from the emailed link; remembered for the plan page. */
  trial?: string;
};

type Role = "student" | "parent";

/**
 * Sign-in, sign-up, email verification and password reset: the state, the
 * effects and the calls to Supabase Auth. The page only lays the result out.
 */
export function useAuthFlow(navigate: ReturnType<typeof useNavigate>, search: SearchParams) {
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

  const queryClient = useQueryClient();

  // Also where Google / Microsoft send the visitor back: the session arrives in
  // the URL, and the choices made on this form before leaving are applied here.
  useEffect(() => {
    const providerError = readProviderError();
    if (providerError) {
      toast.error(providerError);
      const url = new URL(window.location.href);
      for (const k of ["error", "error_code", "error_description"]) url.searchParams.delete(k);
      url.hash = "";
      window.history.replaceState(window.history.state, "", url);
    }
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      await finishSsoSignUp();
      invalidateGuardState(queryClient);
      navigate({ to: dest as never });
    });
  }, [navigate, dest, queryClient]);

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
              parent_invite_code: role === "parent" ? inviteCode.trim() || null : null,
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
        toast.success("Signed in", { duration: 2000 });
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

  // Google / Microsoft. On sign-up the role and invite code chosen above go
  // with the visitor (see `@/lib/auth/ssoIntent`); on log in nothing does, and
  // an unknown account is made as a student, as an email sign-up defaults to.
  const handleOAuth = async (provider: SsoProvider) => {
    if (mode === "signup" && role === "parent" && !inviteCode.trim()) {
      return toast.error("Enter your child's invite code first");
    }
    if (mode === "signup") {
      rememberSsoIntent({
        role,
        inviteCode: role === "parent" ? inviteCode.trim() : null,
        tier: search.tier ?? null,
        level: search.level ?? null,
        subjects: search.subjects ?? null,
        board: search.board ?? null,
      });
    }
    setLoading(true);
    const back = new URL("/auth", window.location.origin);
    if (dest !== "/dashboard") back.searchParams.set("redirect", dest);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: back.toString(),
        // Microsoft only returns the email address when asked for it.
        scopes: provider === "azure" ? "email" : undefined,
      },
    });
    // On success the browser is already leaving for the provider.
    if (error) {
      toast.error(error.message);
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) return toast.error("Enter your email above first");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) toast.error(error.message);
    else toast.success("Password reset email sent");
  };

  return {
    mode,
    setMode,
    role,
    setRole,
    email,
    setEmail,
    password,
    setPassword,
    name,
    setName,
    inviteCode,
    setInviteCode,
    loading,
    emailSentTo,
    setEmailSentTo,
    otp,
    setOtp,
    resendIn,
    handleSubmit,
    handleVerify,
    handleResend,
    handleOAuth,
    handleForgotPassword,
  };
}

export type AuthFlow = ReturnType<typeof useAuthFlow>;
