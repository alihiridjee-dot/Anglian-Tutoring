import { useEffect, useState } from "react";
import { Loader2, MessageSquarePlus, X } from "lucide-react";
import { toast } from "sonner";
import { useStartThread, useTutorDirectory } from "@/hooks/data/useChat";
import { ContextPicker } from "@/components/chat/ContextPicker";
import { EMPTY_CONTEXT, type ChatContextSelection } from "@/lib/chatContext";

interface Props {
  /** Pre-attach something the student was already looking at. */
  initialContext?: ChatContextSelection;
  onClose: () => void;
  onCreated: (threadId: string) => void;
}

/**
 * A student's new question.
 *
 * Three decisions, in the order people make them: who am I asking, what is it
 * about, and what do I want to say. The tutor list comes from the tutor_directory
 * RPC, so it is whoever currently holds the tutor role — no names are baked in,
 * and a new tutor appears here the moment their account is granted the role.
 */
export function NewThreadDialog({ initialContext, onClose, onCreated }: Props) {
  const { data: tutors = [], isPending: tutorsPending } = useTutorDirectory();
  const start = useStartThread();

  const [tutorId, setTutorId] = useState<string>("");
  const [subjectLine, setSubjectLine] = useState("");
  const [body, setBody] = useState("");
  const [context, setContext] = useState<ChatContextSelection>(initialContext ?? EMPTY_CONTEXT);

  // Default to the first tutor so a student who doesn't care can just type and
  // send; the picker is there for when they do.
  useEffect(() => {
    if (!tutorId && tutors.length > 0) setTutorId(tutors[0].id);
  }, [tutors, tutorId]);

  // An attached spec point or homework already names the question better than a
  // student would in a hurry, so seed the subject line from it — still editable.
  useEffect(() => {
    if (context.label && !subjectLine.trim()) setSubjectLine(context.label.slice(0, 120));
    // Only seeds; re-running on every keystroke would fight the student.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.label]);

  const canSend = !!tutorId && subjectLine.trim().length > 0 && body.trim().length > 0;

  const submit = () => {
    if (!canSend) return;
    start.mutate(
      {
        tutorId,
        subjectLine: subjectLine.trim(),
        body: body.trim(),
        subject: context.subject ?? null,
        specPointId: context.specPointId ?? null,
        resourceId: context.resourceId ?? null,
        mcqSetId: context.mcqSetId ?? null,
        contextLabel: context.label ?? null,
      },
      {
        onSuccess: (threadId) => {
          toast.success("Sent — your tutor will get back to you.");
          onCreated(threadId);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary-deep/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-thread-title"
    >
      <div className="w-full max-w-lg rounded-2xl premium-card shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
              <MessageSquarePlus className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 id="new-thread-title" className="font-display text-lg font-bold leading-tight">
                Ask your tutor
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Attach the spec point, homework or quiz you're stuck on and they'll see it straight
                away.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Who are you asking?
            </label>
            {tutorsPending ? (
              <div className="mt-2 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : tutors.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No tutors are available to message right now.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {tutors.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTutorId(t.id)}
                    className={`h-9 px-3.5 rounded-lg border text-sm font-semibold transition ${
                      tutorId === t.id
                        ? "border-primary bg-primary/10"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {t.display_name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              What's it about?
            </label>
            <div className="mt-2">
              <ContextPicker value={context} onChange={setContext} />
            </div>
          </div>

          <div>
            <label
              htmlFor="thread-subject"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Subject
            </label>
            <input
              id="thread-subject"
              value={subjectLine}
              onChange={(e) => setSubjectLine(e.target.value)}
              maxLength={140}
              placeholder="e.g. I don't get why water moves out of the cell"
              className="mt-2 w-full h-11 rounded-xl border border-border bg-background px-3.5 text-sm transition focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
            />
          </div>

          <div>
            <label
              htmlFor="thread-body"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Your question
            </label>
            <textarea
              id="thread-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder="Tell them what you've tried and where you got stuck — the more specific, the faster the answer."
              className="mt-2 w-full rounded-xl border border-border bg-background p-3.5 text-sm transition focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 p-6 border-t border-border">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-lg border border-border text-sm font-semibold hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSend || start.isPending}
            className="btn-premium h-10 px-4 rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
          >
            {start.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Send question
          </button>
        </div>
      </div>
    </div>
  );
}
