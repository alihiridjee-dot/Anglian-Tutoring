import { useEffect, useState } from "react";
import { Loader2, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { SectionHeading } from "@/components/Shared";
import { inputCls } from "@/components/tutor/Field";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { useAccountDeletion, useScheduleDeletion, useUndoDeletion } from "@/hooks/data/useStudents";
import { formatDate } from "./studentPresentation";

/** Must match COOLING_OFF_DAYS in supabase/functions/delete-account. */
const COOLING_OFF_DAYS = 7;

/**
 * The tutor's kill switch for a student account, at the foot of Billing.
 *
 * Booking it locks the student out and pauses the plan at once; the account
 * and everything in it are deleted seven days later by the delete-account
 * function. Until then the booking shows here with an Undo, and in the record's
 * header, so nobody opens a student who is about to disappear without knowing.
 */
export function DeleteAccountSection({ studentId, name }: { studentId: string; name: string }) {
  const { data: deletion } = useAccountDeletion(studentId);
  const undo = useUndoDeletion();
  const [confirming, setConfirming] = useState(false);

  if (deletion) {
    const date = formatDate(deletion.purge_after);
    return (
      <section className="premium-card tint-rose rounded-2xl p-5 sm:p-6">
        <SectionHeading title="Delete account">
          <span className="chip tint-rose text-[10px]">Deleting {date}</span>
        </SectionHeading>
        <p className="mt-2 text-sm">
          {name} is locked out and the plan is paused. On {date} the account and everything in it is
          deleted for good.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={undo.isPending}
            onClick={() =>
              undo.mutate(
                { studentId },
                {
                  onSuccess: (r) => {
                    toast.success(`Deletion cancelled. ${name} can sign in again.`);
                    if (r.plan_error) {
                      toast.error(`The plan couldn't be restarted: ${r.plan_error}`);
                    }
                  },
                  onError: (e) => toast.error(e.message),
                },
              )
            }
            className="btn-soft inline-flex h-11 items-center gap-1.5 rounded-lg px-3.5 text-sm sm:h-9"
          >
            {undo.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Undo2 className="size-4" aria-hidden />
            )}
            Undo
          </button>
          {deletion.last_error && (
            <span className="chip tint-amber text-[10px]">{deletion.last_error}</span>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="premium-card tint-rose rounded-2xl p-5 sm:p-6">
      <SectionHeading title="Delete account">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="btn-solid tint-rose inline-flex h-11 items-center gap-1.5 rounded-lg px-3.5 text-sm sm:h-9"
        >
          <Trash2 className="size-4" aria-hidden /> Delete account
        </button>
      </SectionHeading>
      <p className="mt-2 text-sm">
        Locks {name} out and stops billing today. Everything is deleted {COOLING_OFF_DAYS} days
        later.
      </p>
      {confirming && (
        <DeleteAccountDialog
          studentId={studentId}
          name={name}
          onClose={() => setConfirming(false)}
        />
      )}
    </section>
  );
}

/**
 * What happens, when, and a typed name before the button unlocks — the name
 * rather than a fixed word, so the tutor has to look at whose record this is.
 */
function DeleteAccountDialog({
  studentId,
  name,
  onClose,
}: {
  studentId: string;
  name: string;
  onClose: () => void;
}) {
  const schedule = useScheduleDeletion();
  const [typed, setTyped] = useState("");
  const date = formatDate(new Date(Date.now() + COOLING_OFF_DAYS * 86_400_000).toISOString());
  const matches = typed.trim().toLowerCase() === name.trim().toLowerCase();

  // The record underneath holds still; a tap outside closes the sheet until the
  // name has been started, after which only the buttons or Escape do.
  useBodyScrollLock(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !schedule.isPending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, schedule.isPending]);

  const confirm = () =>
    schedule.mutate(
      { studentId },
      {
        onSuccess: (r) => {
          toast.success(
            `Booked. ${name}'s account will be deleted on ${formatDate(r.purge_after)}.`,
          );
          if (r.emails_failed > 0) {
            toast.error(
              `${r.emails_failed} email${r.emails_failed === 1 ? "" : "s"} couldn't be sent.`,
            );
          }
          onClose();
        },
        onError: (e) => toast.error(e.message),
      },
    );

  return (
    <div
      className="bg-primary-deep/50 fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-account-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !typed.trim() && !schedule.isPending) onClose();
      }}
    >
      <div className="premium-card tint-rose max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl">
        <div className="border-border flex items-start justify-between gap-3 border-b p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="icon-tile size-10 shrink-0">
              <Trash2 className="size-5" aria-hidden />
            </span>
            <h2 id="delete-account-title" className="min-w-0 text-lg leading-tight break-words">
              Delete {name}'s account
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={schedule.isPending}
            aria-label="Close"
            className="tap-target text-muted-foreground hover:text-foreground shrink-0"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-4 p-4 sm:p-6 text-sm">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Today</strong> {name} is locked out and the plan is paused. No more charges,
              and no refund.
            </li>
            <li>{name}, any linked parent and you get an email.</li>
            <li>
              <strong>On {date}</strong> the account, work, marks, messages, files and billing
              details are deleted. This can't be undone.
            </li>
            <li>Until then you can undo it from this page.</li>
          </ul>

          <label className="block">
            <span className="font-semibold">Type {name} to confirm</span>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches && !schedule.isPending) confirm();
              }}
              className={`${inputCls} mt-2`}
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={schedule.isPending}
              className="btn-soft tint-slate inline-flex h-11 items-center rounded-lg px-3.5 text-sm sm:h-9"
            >
              Keep account
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={!matches || schedule.isPending}
              className="btn-solid tint-rose inline-flex h-11 items-center gap-1.5 rounded-lg px-3.5 text-sm sm:h-9"
            >
              {schedule.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="size-4" aria-hidden />
              )}
              Delete account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
