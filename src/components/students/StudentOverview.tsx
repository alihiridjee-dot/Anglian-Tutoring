import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, Mail, Phone, School, Ticket, Users, X } from "lucide-react";
import { toast } from "sonner";
import { SectionHeading } from "@/components/Shared";
import { useUnlinkParent } from "@/hooks/data/useStudents";
import { resolveDisplayName } from "@/lib/profile/displayName";
import type { LinkedParent, StudentRecord } from "@/lib/students/studentsDal";
import { StudentCourseEditor } from "./StudentCourseEditor";
import { formatDate } from "./studentPresentation";

function Fact({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) {
  return (
    <div className="surface-soft flex items-start gap-3 rounded-xl p-3.5">
      <span className="icon-tile size-8 shrink-0">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
          {label}
        </p>
        <p className="truncate text-sm font-semibold">{value}</p>
      </div>
    </div>
  );
}

function ParentRow({ parent, studentId }: { parent: LinkedParent; studentId: string }) {
  const unlink = useUnlinkParent();
  const [confirming, setConfirming] = useState(false);
  const name = resolveDisplayName(parent.display_name, null);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div>
        <p className="text-sm font-semibold">{name === "there" ? "Parent" : name}</p>
        <p className="text-muted-foreground text-xs">Linked {formatDate(parent.linked_at)}</p>
      </div>
      {confirming ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={unlink.isPending}
            onClick={() =>
              unlink.mutate(
                { linkId: parent.link_id, studentId },
                {
                  onSuccess: () => toast.success("Parent unlinked."),
                  onError: (e) => toast.error(e.message),
                  onSettled: () => setConfirming(false),
                },
              )
            }
            className="btn-solid tint-rose inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold"
          >
            {unlink.isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Yes, unlink
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="btn-soft inline-flex h-8 items-center rounded-lg px-3 text-xs font-semibold"
          >
            Keep
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-semibold"
        >
          <X className="size-3.5" aria-hidden /> Unlink
        </button>
      )}
    </li>
  );
}

/**
 * Who the student is, what they are studying, and who is linked to them.
 * The course block is where a tutor corrects a level, a board or a grade.
 */
export function StudentOverview({
  record,
  email,
}: {
  record: StudentRecord;
  email: string | null;
}) {
  const { profile, parents, pendingInvites } = record;

  return (
    <div className="space-y-6">
      <section className="premium-card rounded-2xl p-5 sm:p-6">
        <SectionHeading title="Details" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {email && <Fact icon={Mail} label="Email" value={email} />}
          {profile.phone && <Fact icon={Phone} label="Phone" value={profile.phone} />}
          {profile.school && <Fact icon={School} label="School" value={profile.school} />}
          {profile.student_invite_code && (
            <Fact icon={Ticket} label="Parent invite code" value={profile.student_invite_code} />
          )}
        </div>
        {!profile.onboarding_completed_at && (
          <p className="chip tint-amber mt-4 text-[10px]">Hasn't finished onboarding</p>
        )}
      </section>

      <StudentCourseEditor record={record} />

      <section className="premium-card rounded-2xl p-5 sm:p-6">
        <SectionHeading title="Parents" hint="Linked parents see grades, feedback and billing.">
          <Link
            to="/parents"
            className="btn-soft inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold"
          >
            <Users className="size-4" aria-hidden /> Parent links
          </Link>
        </SectionHeading>
        {parents.length > 0 && (
          <ul className="divide-border mt-2 divide-y">
            {parents.map((p) => (
              <ParentRow key={p.link_id} parent={p} studentId={profile.id} />
            ))}
          </ul>
        )}
        {pendingInvites.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {pendingInvites.map((i) => (
              <li key={i.id} className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
                <span className="chip tint-amber text-[10px]">Invited</span>
                <span className="font-semibold">{i.parent_email}</span>
                <span>expires {formatDate(i.expires_at)}</span>
              </li>
            ))}
          </ul>
        )}
        {parents.length === 0 && pendingInvites.length === 0 && (
          <p className="text-muted-foreground mt-3 text-sm">No parent is linked yet.</p>
        )}
      </section>
    </div>
  );
}
