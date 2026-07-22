import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Link2, Mail, RefreshCw, Users, X } from "lucide-react";
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
  type InviteOutcome,
  type LinkChildOutcome,
} from "@/hooks/data/useParentLinks";
import { validateEmail } from "@/lib/validation";

export const Route = createFileRoute("/_authenticated/parents")({
  head: () => ({ meta: [{ title: "Linked Parents | StudyHub" }] }),
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
          <p className="text-sm text-muted-foreground">Loading…</p>
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
  children,
}: {
  title: string;
  description?: string;
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
  if (query.isLoading) return <Empty>Loading…</Empty>;
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

/** How each non-raising outcome of invite_parent_by_email reads to the student. */
const INVITE_MESSAGE: Record<InviteOutcome, string> = {
  invited: "Invitation sent.",
  no_account: "No account uses that email yet — share your invite code with them instead.",
  not_a_parent: "That account isn't a parent/guardian account.",
  already_linked: "That parent is already linked to you.",
};

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

  return (
    <>
      <Panel
        title="Invite a parent or guardian"
        description="They'll be asked to accept before they can see anything."
        icon={Mail}
      >
        <form onSubmit={submit} className="space-y-4 max-w-sm">
          <Field label="Their email">
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
              onBlur={() => email && setError(validateEmail(email))}
              placeholder="parent@example.com"
              aria-invalid={!!error}
              className={inputCls}
            />
            {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
          </Field>
          <button type="submit" disabled={invite.isPending} className={submitBtn}>
            {invite.isPending ? "Sending…" : "Send invitation"}
          </button>
        </form>
      </Panel>

      <Panel
        title="Share invite code"
        description="A parent who doesn't have an account yet enters this when they sign up."
        icon={Link2}
      >
        <div className="flex flex-wrap items-center gap-2">
          <code className="flex-1 min-w-40 h-10 rounded-lg bg-secondary border border-border px-3 flex items-center font-mono text-sm tracking-widest">
            {inviteCode ?? "—"}
          </code>
          <button
            type="button"
            onClick={copyCode}
            disabled={!inviteCode}
            className="h-10 px-3 rounded-lg border border-border hover:bg-muted text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60 cursor-pointer"
          >
            {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={doRotate}
            disabled={rotate.isPending}
            className="h-10 px-3 rounded-lg border border-border hover:bg-muted text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${rotate.isPending ? "animate-spin" : ""}`} />
            New code
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Treat it like a password — anyone who signs up with it can follow your progress. Generate
          a new one if you've shared it too widely.
        </p>
      </Panel>

      <Panel title="Pending invitations" icon={Mail}>
        <ListState query={outgoing} empty="No invitations waiting for a reply.">
          {outgoing.data?.length ? (
            <ul className="divide-y divide-border">
              {outgoing.data.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{i.parent_email}</p>
                    <p className="text-xs text-muted-foreground">
                      Expires {new Date(i.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        await revoke.mutateAsync(i.id);
                        toast.success("Invitation withdrawn");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Could not withdraw it");
                      }
                    }}
                    className="text-xs font-medium text-muted-foreground hover:text-destructive shrink-0 cursor-pointer"
                  >
                    Withdraw
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </ListState>
      </Panel>

      <Panel
        title="Linked parents"
        description="They can see your grades, homework and progress."
        icon={Users}
      >
        <ListState query={parents} empty="No parents are linked to your account.">
          {parents.data?.length ? (
            <ul className="divide-y divide-border">
              {parents.data.map((p) => (
                <li key={p.link_id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{p.display_name ?? p.email}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.email}</p>
                  </div>
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Remove ${p.display_name ?? p.email}'s access?`)) return;
                      try {
                        await unlink.mutateAsync(p.link_id);
                        toast.success("Parent unlinked");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Could not unlink them");
                      }
                    }}
                    className="text-xs font-medium text-muted-foreground hover:text-destructive shrink-0 cursor-pointer"
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

/** How each non-raising outcome of link_child_by_code reads to the parent. */
const LINK_CHILD_MESSAGE: Record<Exclude<LinkChildOutcome, "linked">, string> = {
  already_linked: "You're already linked to that student.",
  not_found: "No student matches that invite code. Check it and try again.",
  not_a_parent: "Only a parent/guardian account can link to a student.",
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
      >
        <form onSubmit={submitCode} className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-48">
            <Field label="Invite code">
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="ANG-XXXXXXXX"
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
                      className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold inline-flex items-center gap-1.5 hover:opacity-90 disabled:opacity-60 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" /> Accept
                    </button>
                    <button
                      onClick={() => answer(i.id, false)}
                      disabled={respond.isPending}
                      className="h-8 px-3 rounded-lg border border-border text-xs font-medium inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-60 cursor-pointer"
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
                    className="text-xs font-medium text-muted-foreground hover:text-destructive shrink-0 cursor-pointer"
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
