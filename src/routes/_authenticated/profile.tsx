import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, Mail, UserCog } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
// Shared form primitives. They live under components/tutor for historical
// reasons but carry nothing tutor-specific; reusing them beats restating the
// same class strings a fourth time.
import { Field, inputCls, submitBtn } from "@/components/tutor/Field";
import { supabase } from "@/integrations/supabase/client";
import { firstError, validateEmail, validatePassword, validatePhone } from "@/lib/validation";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [{ title: "Profile | StudyHub" }] }),
  component: ProfilePage,
});

function Card({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-card border border-border p-6">
      <div className="flex items-start gap-3 mb-5">
        <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function ErrorText({ children }: { children: string | null }) {
  if (!children) return null;
  return <p className="mt-1 text-xs text-destructive">{children}</p>;
}

/** Account details held on the profile row, as opposed to the auth user. */
function DetailsCard() {
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["profile-details"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name, phone")
        .eq("id", u.user.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  // Seed the inputs from the row exactly once.
  //
  // React Query hands back a new `data` object on every refetch, and the client
  // is built with default options — so refetchOnWindowFocus is on. Seeding on
  // every `data` change therefore wipes whatever you had typed the moment the
  // window regains focus, and the stale value gets saved over your edit while
  // the form still reports success. The ref pins seeding to the first row that
  // arrives; after that the inputs belong to the user.
  const seeded = useRef(false);
  useEffect(() => {
    if (!data || seeded.current) return;
    seeded.current = true;
    setDisplayName(data.display_name ?? "");
    setPhone(data.phone ?? "");
  }, [data]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const error = validatePhone(phone);
    setPhoneError(error);
    if (error) return;

    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Your session has expired. Sign in again.");

      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          display_name: displayName.trim() || null,
          // Empty clears the number rather than storing "".
          phone: phone.trim() || null,
        })
        .eq("id", u.user.id);
      if (updateError) throw new Error(updateError.message);

      // The header initials and the invite notifications both read these.
      qc.invalidateQueries({ queryKey: ["profile-details"] });
      qc.invalidateQueries({ queryKey: ["user-enrolments-and-profile"] });
      toast.success("Details saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save your details");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Account details" description="Your name and contact number." icon={UserCog}>
      <form onSubmit={submit} className="space-y-4 max-w-sm">
        <Field label="Display name">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={80}
            placeholder={isLoading ? "Loading…" : "e.g. Alex Taylor"}
            className={inputCls}
          />
        </Field>
        <Field label="Phone number">
          <input
            type="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              if (phoneError) setPhoneError(null);
            }}
            onBlur={() => setPhoneError(validatePhone(phone))}
            placeholder="e.g. +44 7700 900123"
            aria-invalid={!!phoneError}
            className={inputCls}
          />
          <ErrorText>{phoneError}</ErrorText>
        </Field>
        <button type="submit" disabled={saving || isLoading} className={submitBtn}>
          {saving ? "Saving…" : "Save details"}
        </button>
      </form>
    </Card>
  );
}

function EmailCard({ currentEmail }: { currentEmail: string | null }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = email.trim().toLowerCase();
    let problem = validateEmail(next);
    if (!problem && next === currentEmail?.toLowerCase()) {
      problem = "That is already your email address";
    }
    setError(problem);
    if (problem) return;

    setSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ email: next });
      if (updateError) throw new Error(updateError.message);
      // Supabase does not move the address until the link is clicked, so the
      // header will keep showing the old one until then — say so, or this reads
      // as a silent no-op.
      toast.success(`Confirmation sent to ${next}. Your email changes once you click the link.`);
      setEmail("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update your email");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Email address"
      description="Used to sign in and to receive updates about your work."
      icon={Mail}
    >
      <form onSubmit={submit} className="space-y-4 max-w-sm">
        <Field label="Current email">
          <input value={currentEmail ?? "—"} disabled className={`${inputCls} opacity-60`} />
        </Field>
        <Field label="New email">
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError(null);
            }}
            onBlur={() => email && setError(validateEmail(email))}
            aria-invalid={!!error}
            className={inputCls}
          />
          <ErrorText>{error}</ErrorText>
        </Field>
        <button type="submit" disabled={saving} className={submitBtn}>
          {saving ? "Sending…" : "Send confirmation"}
        </button>
      </form>
    </Card>
  );
}

function PasswordCard({ currentEmail }: { currentEmail: string | null }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    let problem = firstError(next, validatePassword);
    if (!problem && next !== confirm) problem = "The new passwords do not match";
    if (!problem && next === current)
      problem = "Your new password must differ from the current one";
    if (!problem && !current) problem = "Enter your current password";
    setError(problem);
    if (problem) return;

    if (!currentEmail) {
      toast.error("Your session has expired. Sign in again.");
      return;
    }

    setSaving(true);
    try {
      // Re-authenticate first: an open session alone shouldn't be enough to
      // change the password on it, or a borrowed laptop becomes an account
      // takeover. A failed sign-in leaves the existing session intact.
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: currentEmail,
        password: current,
      });
      if (reauthError) {
        setError("Your current password is incorrect");
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: next });
      // Surfaces Supabase's own rejections (minimum length, and breached-password
      // checks if leaked-password protection is ever enabled — it is currently
      // off on the live project despite config.toml claiming otherwise).
      if (updateError) throw new Error(updateError.message);

      toast.success("Password updated");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update your password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Password"
      description="Confirm your current password to set a new one."
      icon={KeyRound}
    >
      <form onSubmit={submit} className="space-y-4 max-w-sm">
        <Field label="Current password">
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="New password">
          <input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => {
              setNext(e.target.value);
              if (error) setError(null);
            }}
            className={inputCls}
          />
        </Field>
        <Field label="Confirm new password">
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (error) setError(null);
            }}
            aria-invalid={!!error}
            className={inputCls}
          />
          <ErrorText>{error}</ErrorText>
        </Field>
        <button type="submit" disabled={saving} className={submitBtn}>
          {saving ? "Updating…" : "Update password"}
        </button>
      </form>
    </Card>
  );
}

function ProfilePage() {
  const { data: user } = useQuery({
    queryKey: ["auth-user-email"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user ?? null;
    },
  });

  return (
    <AppLayout title="Profile">
      <div className="max-w-2xl space-y-6">
        <DetailsCard />
        <EmailCard currentEmail={user?.email ?? null} />
        <PasswordCard currentEmail={user?.email ?? null} />
      </div>
    </AppLayout>
  );
}
