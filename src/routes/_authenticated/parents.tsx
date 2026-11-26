import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Link2, Mail, QrCode, RefreshCw, Send, Users, X } from "lucide-react";
import { Spinner } from "@/components/Shared";
import { AppLayout } from "@/components/AppLayout";
import { Field, inputCls, submitBtn } from "@/components/tutor/Field";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import {
  useChildLinks,
  useIncomingInvites,
  useInviteParent,
  useLinkChildByCode,
  useOutgoingInvites,
  useParentLinks,
  useRespondToInvite,
  useRevokeInvite,
  useRotateInviteCode,
  useUnlinkParent,
  INVITE_MESSAGE,
  type LinkChildOutcome,
} from "@/hooks/data/useParentLinks";
import { validateEmail } from "@/lib/auth/validation";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/parents")({
  head: () => ({ meta: [{ title: "Linked Parents | Anglia Educate" }] }),
  component: ParentsPage,
});

/**
 * Both sides of the parent link, on one route.
 *
 * Branching on the profile role rather than splitting the route keeps the two
 * halves of a single relationship together: a student manages who can see their
 * work, a parent answers invitations and sees who they follow. Nothing here is
 * a cross-persona escape hatch — neither side can reach the other's surface.
 */
function ParentsPage() {
  const { role, loading } = useEnrolments();

  // Same route, two seats: a parent follows their linked *students*, so the
  // heading names them — matching the "Linked Students" sidebar item. A student
  // manages their linked *parents*.
  const title = role === "parent" ? "Linked Students" : "Linked Parents";

  return (
    <AppLayout title={title}>
      <div className="max-w-2xl space-y-6">
        {loading ? (
          <Spinner label="Loading" className="py-8" />
        ) : role === "parent" ? (
          <ParentView />
        ) : role === "tutor" ? (
          // Tutors link families from Students; the header hides this item for
          // them, so this only catches a typed URL.
          <Panel title="Not applicable" icon={Users}>
            <p className="text-sm text-muted-foreground">
              Parent links are managed per family from the Students page.
            </p>
          </Panel>
        ) : (
          <StudentView />
        )}
      </div>
    </AppLayout>
  );
}

function Panel({
  title,
  description,
  icon: Icon,
  guide,
  children,
}: {
  title: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Where the welcome tour points, on the one panel it describes. */
  guide?: string;
  children: React.ReactNode;
}) {
  return (
    <section data-guide={guide} className="rounded-2xl premium-card p-4 sm:p-6">
      <div className="flex items-start gap-3 mb-5">
        <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold tracking-tight">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="text-sm text-muted-foreground py-2">{children}</p>;
}

/**
 * Renders a list's loading/failed/empty states, or `children` when it has rows.
 *
 * The failed case is called out separately on purpose: these queries resolve to
 * undefined when they throw, so folding that into the empty state would render
 * "no parents are linked" to a student whose parents *are* linked and whose read
 * merely broke — the one wrong answer that looks completely normal.
 */
function ListState({
  query,
  empty,
  children,
}: {
  query: { isLoading: boolean; isError: boolean; error: unknown };
  empty: string;
  children: React.ReactNode;
}) {
  if (query.isLoading) return <Spinner label="Loading" className="py-8" />;
  if (query.isError) {
    return (
      <p className="text-sm text-destructive py-2">
        Couldn&apos;t load this
        {query.error instanceof Error ? ` — ${query.error.message}` : ""}. Refresh to try again.
      </p>
    );
  }
  return <>{children ?? <Empty>{empty}</Empty>}</>;
}

function StudentView() {
  const { inviteCode } = useEnrolments();
  const parents = useParentLinks();
  const outgoing = useOutgoingInvites();
  const invite = useInviteParent();
  const revoke = useRevokeInvite();
  const unlink = useUnlinkParent();
  const rotate = useRotateInviteCode();

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  // Scanned, it opens sign-up as a parent with this code already filled in.
  const inviteUrl = inviteCode
    ? `${window.location.origin}/auth?mode=signup&invite=${encodeURIComponent(inviteCode)}`
    : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateEmail(email);
    setError(problem);
    if (problem) return;

    try {
      const outcome = await invite.mutateAsync(email.trim().toLowerCase());
      if (outcome === "invited") {
        toast.success(INVITE_MESSAGE.invited);
        setEmail("");
      } else {
        // Not a failure — a "we can't link this yet" the student can act on.
        toast.info(INVITE_MESSAGE[outcome]);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the invitation");
    }
  };

  const copyCode = async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is permission-gated; the code is on screen to read either way.
      toast.error("Could not copy — select the code and copy it manually.");
    }
  };

  const doRotate = async () => {
    if (
      !window.confirm(
        "Generate a new code? The old one stops working for new sign-ups. Parents already linked stay linked.",
      )
    ) {
      return;
    }
    try {
      await rotate.mutateAsync();
      toast.success("New invite code generated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate a new code");
    }
  };

  const withdraw = async (id: string) => {
    try {
      await revoke.mutateAsync(id);
      toast.success("Invitation withdrawn");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not withdraw it");
    }
  };

  const remove = async (p: { link_id: string; display_name: string | null; email: string }) => {
    if (
      !window.confirm(
        `Remove ${p.display_name ?? p.email}'s access? Your invite code will change too.`,
      )
    )
      return;
    try {
      await unlink.mutateAsync(p.link_id);
      toast.success("Parent unlinked");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not unlink them");
    }
  };

  const peopleLoading = parents.isLoading || outgoing.isLoading;
  // A broken read is said out loud: folded into "nobody", it would tell a
  // student whose parents *are* linked that no one is.
  const peopleError = parents.isError ? parents.error : outgoing.isError ? outgoing.error : null;
  const linked = parents.data ?? [];
  const waiting = outgoing.data ?? [];

  return (
    <div className="pop-in">
      <div data-guide="invite-parent">
        {/* The parent pass: the code on the front, the same code as a QR code
            on the back. The round button turns it over. */}
        <div className="plink-ticket-wrap" data-flipped={showQr}>
          <div className="plink-ticket-inner">
            <div className="plink-ticket premium-card tint-amber" inert={showQr}>
              <span aria-hidden className="plink-stub">
                🎟️
              </span>
              <div className="min-w-0 flex-1 text-center">
                <h2 className="text-lg font-extrabold">Your parent pass</h2>
                <p className="plink-code mt-1">{inviteCode ?? "—"}</p>
                <p className="mt-1 font-medium">
                  A parent types this when they sign up. Treat it like a password.
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-1">
                  <button
                    type="button"
                    onClick={copyCode}
                    disabled={!inviteCode}
                    className="paywall-link"
                  >
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    type="button"
                    onClick={doRotate}
                    disabled={rotate.isPending}
                    className="paywall-link"
                  >
                    <RefreshCw className={cn("size-4", rotate.isPending && "animate-spin")} />
                    New code
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowQr(true)}
                disabled={!inviteUrl}
                className="plink-flip"
                aria-label="Show the QR code"
              >
                <QrCode className="size-6" />
              </button>
            </div>
            <div className="plink-ticket plink-ticket-back premium-card tint-amber" inert={!showQr}>
              {inviteUrl && (
                <div className="plink-qr">
                  <QRCodeSVG
                    value={inviteUrl}
                    size={132}
                    marginSize={1}
                    title="Invite code for your parent"
                  />
                </div>
              )}
              <p className="min-w-0 flex-1 text-lg font-medium">
                Scan with your parent&apos;s phone. Sign-up opens with your code filled in.
              </p>
              <button
                type="button"
                onClick={() => setShowQr(false)}
                className="plink-flip"
                aria-label="Show the code"
              >
                <RefreshCw className="size-6" />
              </button>
            </div>
          </div>
        </div>

        <section className="tint-primary mt-10">
          <h2 className="text-2xl font-extrabold">Or send it by email</h2>
          <p className="mt-1 text-lg font-medium">
            They&apos;re asked to accept before they can see anything.
          </p>
          <form onSubmit={submit} className="mt-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="email"
                autoComplete="email"
                aria-label="Their email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError(null);
                }}
                onBlur={() => email && setError(validateEmail(email))}
                placeholder="parent@example.com"
                aria-invalid={!!error}
                className="pop-input h-14 w-full min-w-0 px-4 text-base sm:flex-1"
              />
              <button
                type="submit"
                disabled={invite.isPending}
                className="btn-solid paywall-btn contact-send shrink-0 px-7"
              >
                {invite.isPending ? "Sending…" : "Send"}
                <Send
                  className={cn("contact-plane size-5", invite.isPending && "contact-plane-off")}
                  aria-hidden
                />
              </button>
            </div>
            {error && <p className="text-destructive mt-2 font-semibold">{error}</p>}
          </form>
        </section>
      </div>

      {peopleLoading ? (
        <Spinner label="Loading" className="py-8" />
      ) : peopleError ? (
        <p className="text-destructive mt-12 font-semibold">
          Couldn&apos;t load your parents
          {peopleError instanceof Error ? ` — ${peopleError.message}` : ""}. Refresh to try again.
        </p>
      ) : linked.length + waiting.length > 0 ? (
        <section className="mt-12">
          <h2 className="text-2xl font-extrabold">Who&apos;s on your pass</h2>
          <ul className="mt-5 flex flex-wrap gap-6">
            {linked.map((p, i) => (
              <li key={p.link_id} className="plink-seat">
                <span className={cn("plink-face", FACE_TINTS[i % FACE_TINTS.length])}>
                  {initials(p.display_name ?? p.email)}
                  <span aria-hidden className="focus-wave plink-wave">
                    👋
                  </span>
                </span>
                <span className="text-lg font-bold">{p.display_name ?? p.email}</span>
                <button type="button" onClick={() => remove(p)} className="paywall-link">
                  Remove
                </button>
              </li>
            ))}
            {waiting.map((inv) => (
              <li key={inv.id} className="plink-seat">
                <span className="plink-face plink-face-wait tint-primary">
                  <span aria-hidden className="plink-hourglass">
                    ⏳
                  </span>
                  <span className="sr-only">Waiting for them to accept</span>
                </span>
                <span className="text-lg font-bold">{inv.parent_email}</span>
                <button type="button" onClick={() => withdraw(inv.id)} className="paywall-link">
                  Withdraw
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** A parent's round dot takes one of these, in turn, so two parents differ. */
const FACE_TINTS = ["tint-amber", "tint-emerald", "tint-rose", "tint-primary"];

/** Up to two letters for a parent's dot, from their name or their email. */
function initials(name: string) {
  const parts = name
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** How each non-raising outcome of link_child_by_code reads to the parent. */
const LINK_CHILD_MESSAGE: Record<Exclude<LinkChildOutcome, "linked">, string> = {
  already_linked: "You're already linked to that student.",
  not_found: "No student matches that invite code. Check it and try again.",
  not_a_parent: "Only a parent/guardian account can link to a student.",
  rate_limited: "Too many attempts. Please wait a little while, then try again.",
};

function ParentView() {
  const incoming = useIncomingInvites();
  const children = useChildLinks();
  const respond = useRespondToInvite();
  const unlink = useUnlinkParent();
  const linkByCode = useLinkChildByCode();

  const [code, setCode] = useState("");

  const answer = async (inviteId: string, accept: boolean) => {
    try {
      await respond.mutateAsync({ inviteId, accept });
      toast.success(accept ? "Invitation accepted" : "Invitation declined");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not answer the invitation");
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    try {
      const result = await linkByCode.mutateAsync(code);
      if (result.status === "linked") {
        toast.success(
          result.student_name ? `Linked to ${result.student_name}.` : "Linked to your student.",
        );
        setCode("");
      } else {
        // Not a failure — a "we can't link this" the parent can act on.
        toast.info(LINK_CHILD_MESSAGE[result.status]);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not link with that code");
    }
  };

  return (
    <>
      <Panel
        title="Link a student by invite code"
        description="Ask your child for their invite code, then enter it here to follow their progress."
        icon={Link2}
        guide="link-child"
      >
        <form onSubmit={submitCode} className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-48">
            <Field label="Invite code">
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="ANG-XXXXXXXX"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className={`${inputCls} font-mono tracking-widest uppercase`}
              />
            </Field>
          </div>
          <button
            type="submit"
            disabled={linkByCode.isPending || !code.trim()}
            className={submitBtn}
          >
            {linkByCode.isPending ? "Linking…" : "Link"}
          </button>
        </form>
        <p className="text-xs text-muted-foreground mt-3">
          Linking with a code takes effect straight away — no acceptance needed. Your child can
          unlink you or reset their code at any time.
        </p>
      </Panel>

      <Panel
        title="Invitations"
        description="Students who have asked you to follow their progress."
        icon={Mail}
      >
        <ListState query={incoming} empty="No invitations waiting for you.">
          {incoming.data?.length ? (
            <ul className="divide-y divide-border">
              {incoming.data.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">A student has invited you</p>
                    <p className="text-xs text-muted-foreground">
                      Expires {new Date(i.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => answer(i.id, true)}
                      disabled={respond.isPending}
                      className="h-11 sm:pointer-fine:h-8 px-3 rounded-lg btn-solid text-xs font-semibold inline-flex items-center gap-1.5 hover:opacity-90 disabled:opacity-60 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" /> Accept
                    </button>
                    <button
                      onClick={() => answer(i.id, false)}
                      disabled={respond.isPending}
                      className="h-11 sm:pointer-fine:h-8 px-3 rounded-lg border border-border text-xs font-medium inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-60 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" /> Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </ListState>
      </Panel>

      <Panel title="Linked students" description="Whose progress you can follow." icon={Users}>
        <ListState query={children} empty="You aren't linked to any students yet.">
          {children.data?.length ? (
            <ul className="divide-y divide-border">
              {children.data.map((c) => (
                <li key={c.link_id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{c.display_name ?? c.email}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                  </div>
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Stop following ${c.display_name ?? c.email}?`)) return;
                      try {
                        await unlink.mutateAsync(c.link_id);
                        toast.success("Unlinked");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Could not unlink");
                      }
                    }}
                    className="inline-flex min-h-11 items-center px-2 text-xs font-medium text-muted-foreground hover:text-destructive shrink-0 cursor-pointer sm:pointer-fine:min-h-0"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </ListState>
      </Panel>
    </>
  );
}
