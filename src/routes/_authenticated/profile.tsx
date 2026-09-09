import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, ImagePlus, KeyRound, Loader2, Mail, Trash2, UserCog } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
// Shared form primitives. They live under components/tutor for historical
// reasons but carry nothing tutor-specific; reusing them beats restating the
// same class strings a fourth time.
import { Field, inputCls, submitBtn } from "@/components/tutor/Field";
import { supabase } from "@/integrations/supabase/client";
import { useAvatarUrl } from "@/hooks/data/useAvatar";
import { AVATAR_ACCEPT, AVATAR_BUCKET, avatarObjectPath, prepareAvatar } from "@/lib/avatar";
import { resolveInitials } from "@/lib/displayName";
import { firstError, validateEmail, validatePassword, validatePhone } from "@/lib/validation";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [{ title: "Profile | Anglia Educate" }] }),
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
    <section className="rounded-2xl premium-card p-6">
      <div className="flex items-start gap-3 mb-5">
        <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight">{title}</h2>
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

/**
 * The profile row, read once for every card on this page.
 *
 * Both the photo and the name/phone form live on the same row, so they share a
 * query key and React Query serves the second caller from the cache. Saving
 * from either card invalidates this key, which is what keeps the photo preview
 * and the header avatar in step.
 */
function useProfileDetails() {
  return useQuery({
    queryKey: ["profile-details"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name, phone, avatar_path")
        .eq("id", u.user.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

/**
 * The profile photo.
 *
 * One object per account at a fixed path, overwritten in place, so there is
 * never a second file to garbage-collect when someone changes their mind.
 */
function PhotoCard({ currentEmail }: { currentEmail: string | null }) {
  const qc = useQueryClient();
  const { data, isLoading } = useProfileDetails();
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  // Two different questions, deliberately answered by two different values.
  // The path says whether a photo EXISTS, so "Remove" appears the moment the
  // row loads; the signed URL says whether it can be DRAWN yet, and arrives a
  // beat later. Driving both off the URL would flicker the buttons on every
  // re-sign.
  const avatarPath = data?.avatar_path ?? null;
  const avatarUrl = useAvatarUrl(avatarPath);

  /**
   * Every writer refreshes the same three readers: this card, the header, and
   * the signed URL — which must be re-minted after a replacement, or the token
   * already in hand would go on serving the previous photo.
   */
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["profile-details"] });
    qc.invalidateQueries({ queryKey: ["user-enrolments-and-profile"] });
    qc.invalidateQueries({ queryKey: ["avatar-signed-url"] });
  };

  const onPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clear the input before anything can fail: without this, choosing the same
    // file again after an error fires no change event and the picker looks dead.
    e.target.value = "";
    if (!file) return;

    setBusy("upload");
    try {
      const prepared = await prepareAvatar(file);
      if (!prepared.ok) {
        toast.error(prepared.reason);
        return;
      }

      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Your session has expired. Sign in again.");

      const path = avatarObjectPath(u.user.id);
      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(path, prepared.file, { upsert: true, contentType: "image/jpeg" });
      if (uploadError) throw new Error(uploadError.message);

      // The path, not a URL. A signed URL expires, so storing one would store
      // something that stops working a few minutes later; the path is stable
      // and the URL is minted per read.
      const { error: saveError } = await supabase
        .from("profiles")
        .update({ avatar_path: path })
        .eq("id", u.user.id);
      if (saveError) throw new Error(saveError.message);

      refresh();
      toast.success("Photo updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload your photo");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Your session has expired. Sign in again.");

      // Clear the row first. If the object delete then fails we are merely
      // holding an unreferenced file, whereas the other order would leave the
      // profile pointing at something that no longer exists.
      const { error: saveError } = await supabase
        .from("profiles")
        .update({ avatar_path: null })
        .eq("id", u.user.id);
      if (saveError) throw new Error(saveError.message);
      await supabase.storage.from(AVATAR_BUCKET).remove([avatarObjectPath(u.user.id)]);

      refresh();
      toast.success("Photo removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove your photo");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      title="Profile photo"
      description="Shown on your account menu across the site."
      icon={Camera}
    >
      {/* Stacked on a phone: side by side, the 80px disc leaves the buttons too
          little room and "Upload photo" wraps mid-label. */}
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-5">
        <div className="w-20 h-20 rounded-full overflow-hidden bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0 ring-2 ring-border">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt="Your profile photo"
              className="w-full h-full object-cover"
              width={80}
              height={80}
            />
          ) : (
            // Also what shows for the moment between the row loading and its
            // URL being signed, which is why it isn't a spinner.
            <span className="font-display text-xl font-bold text-primary-foreground">
              {resolveInitials(data?.display_name, currentEmail)}
            </span>
          )}
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => picker.current?.click()}
              disabled={isLoading || busy !== null}
              className="btn-premium h-10 px-4 rounded-lg text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap disabled:opacity-50"
            >
              {busy === "upload" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ImagePlus className="w-4 h-4" />
              )}
              {avatarPath ? "Change photo" : "Upload photo"}
            </button>

            {avatarPath && (
              <button
                type="button"
                onClick={remove}
                disabled={busy !== null}
                className="h-10 px-4 rounded-lg border border-border text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted disabled:opacity-50"
              >
                {busy === "remove" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                Remove
              </button>
            )}
          </div>
          <p className="mt-3 max-w-xs text-xs text-muted-foreground">
            A square JPEG, PNG or WebP. Larger photos are cropped to a square and resized for you.
            Only you can see it — it is stored privately, not on a public link.
          </p>
        </div>

        <input
          ref={picker}
          type="file"
          accept={AVATAR_ACCEPT}
          onChange={onPicked}
          className="hidden"
        />
      </div>
    </Card>
  );
}

/** Account details held on the profile row, as opposed to the auth user. */
function DetailsCard() {
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useProfileDetails();

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
        <PhotoCard currentEmail={user?.email ?? null} />
        <DetailsCard />
        <EmailCard currentEmail={user?.email ?? null} />
        <PasswordCard currentEmail={user?.email ?? null} />
      </div>
    </AppLayout>
  );
}
