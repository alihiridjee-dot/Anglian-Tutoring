import { useEffect, useState } from "react";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { Lightbulb, Loader2, MessageSquarePlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { SciText, Spinner } from "@/components/Shared";
import { useQuestionIdeas, useStartThread, useTutorDirectory } from "@/hooks/data/useChat";
import { ContextPicker } from "@/components/chat/ContextPicker";
import { ErrorNote } from "@/components/Shared";
import { EMPTY_CONTEXT, type ChatContextSelection } from "@/lib/chat/chatContext";
import type { QuestionIdea } from "@/lib/chat/questionIdeas";
import { subjectTint } from "@/lib/curriculum/subjectTheme";
import { cn } from "@/lib/utils";

interface Props {
  /** Pre-attach something the student was already looking at. */
  initialContext?: ChatContextSelection;
  /**
   * Set when a parent is writing: the linked child the message is about. The
   * spec point / homework / quiz picker goes — those are the student's pages,
   * which a parent can't open — and the copy speaks to a parent.
   */
  about?: { studentId: string; name: string };
  onClose: () => void;
  onCreated: (threadId: string) => void;
}

/**
 * A student's new question.
 *
 * A student asks the team: the thread names no tutor and every tutor is told.
 * Then two decisions, in the order people make them: what is it about, and
 * what do I want to say. Under the question box, questions about the topics
 * they did worst on lately, written by DeepSeek, fill the form in one tap.
 *
 * A parent still picks a tutor. That list comes from the tutor_directory RPC,
 * so it is whoever currently holds the tutor role — no names are baked in, and
 * a new tutor appears here the moment their account is granted the role.
 */
export function NewThreadDialog({ initialContext, about, onClose, onCreated }: Props) {
  const {
    data: tutors = [],
    isPending: tutorsPending,
    error: tutorsError,
    refetch: refetchTutors,
  } = useTutorDirectory();
  const start = useStartThread();

  const [tutorId, setTutorId] = useState<string>("");
  const [subjectLine, setSubjectLine] = useState("");
  const [body, setBody] = useState("");
  const [context, setContext] = useState<ChatContextSelection>(initialContext ?? EMPTY_CONTEXT);

  // A student's question goes to the team. Only a parent names a tutor.
  const toTeam = !about;
  // Opened from a page, the question already has its topic.
  const { data: ideas = [] } = useQuestionIdeas(toTeam && !initialContext);

  const pickIdea = (idea: QuestionIdea) => {
    setSubjectLine(idea.topic.slice(0, 140));
    setBody(idea.question);
    setContext({
      kind: "spec_point",
      specPointId: idea.specPointId,
      subject: idea.subject,
      label: `${idea.code} ${idea.topic}`,
    });
  };

  // Default a parent to the first tutor so one who doesn't care can just type
  // and send; the picker is there for when they do.
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

  const canSend = (toTeam || !!tutorId) && subjectLine.trim().length > 0 && body.trim().length > 0;

  // The sheet holds the page still underneath it. Escape and a tap on the
  // backdrop both close it, unless a half-written question would be lost —
  // Cancel and the X are the deliberate ways out. An Escape that ends an IME
  // composition belongs to the input method, so it never closes anything.
  useBodyScrollLock(true);
  const dirty = subjectLine.trim().length > 0 || body.trim().length > 0;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing && !dirty) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, dirty]);

  const submit = () => {
    if (!canSend || start.isPending) return;
    start.mutate(
      {
        tutorId: toTeam ? null : tutorId,
        subjectLine: subjectLine.trim(),
        body: body.trim(),
        subject: context.subject ?? null,
        specPointId: context.specPointId ?? null,
        resourceId: context.resourceId ?? null,
        mcqSetId: context.mcqSetId ?? null,
        contextLabel: context.label ?? null,
        aboutStudentId: about?.studentId ?? null,
      },
      {
        onSuccess: (threadId) => {
          toast.success(
            toTeam
              ? "Sent — the team will get back to you."
              : "Sent — your tutor will get back to you.",
          );
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
      onClick={(e) => {
        if (e.target === e.currentTarget && !dirty) onClose();
      }}
    >
      {/* The title and the Send row stay put and the form scrolls between
          them. On a phone turned sideways the form is twice the height of the
          box, and Send used to be the last thing in it, 286px below the fold. */}
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl premium-card shadow-xl max-h-[calc(100dvh-2rem)]">
        <div className="flex shrink-0 items-start justify-between gap-3 p-4 sm:p-6 short:p-3 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
              <MessageSquarePlus className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 id="new-thread-title" className="font-display text-lg font-bold leading-tight">
                {about ? "Message a tutor" : "Ask your tutor"}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {about
                  ? `About ${about.name}`
                  : "Attach the spec point, task or quiz you're stuck on and they'll see it straight away."}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="tap-target text-muted-foreground hover:text-foreground shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 short:p-4 space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {about ? "Who are you writing to?" : "Who are you asking?"}
            </label>
            {toTeam ? (
              <div className="mt-2 flex">
                <span className="inline-flex h-11 sm:pointer-fine:h-9 items-center gap-2 px-3.5 rounded-lg border border-primary bg-primary/10 text-sm font-semibold">
                  <Users className="w-4 h-4 text-primary" aria-hidden /> The team
                </span>
              </div>
            ) : tutorsPending ? (
              <Spinner label="Loading tutors" className="mt-2 py-3" />
            ) : tutors.length === 0 ? (
              // A failed read leaves the list empty too, but it isn't "no tutors".
              tutorsError ? (
                <div className="mt-2">
                  <ErrorNote error={tutorsError} onRetry={() => void refetchTutors()} />
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  No tutors are available to message right now.
                </p>
              )
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {tutors.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTutorId(t.id)}
                    className={`h-11 sm:pointer-fine:h-9 px-3.5 rounded-lg border text-sm font-semibold transition ${
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

          {!about && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                What's it about?
              </label>
              <div className="mt-2">
                <ContextPicker value={context} onChange={setContext} />
              </div>
            </div>
          )}

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
              placeholder={
                about ? `e.g. How is ${about.name} getting on with chemistry?` : "e.g. Osmosis"
              }
              className="mt-2 w-full h-11 rounded-xl border border-border bg-background px-3.5 text-sm transition focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
            />
          </div>

          <div>
            <label
              htmlFor="thread-body"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {about ? "Your message" : "Your question"}
            </label>
            <textarea
              id="thread-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder={
                about
                  ? "Write your message"
                  : "Tell them what you've tried and where you got stuck — the more specific, the faster the answer."
              }
              className="mt-2 w-full rounded-xl border border-border bg-background p-3.5 text-sm transition focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
            />
            {ideas.length > 0 && (!body.trim() || ideas.some((i) => i.question === body)) && (
              <QuestionIdeas ideas={ideas} picked={body} onPick={pickIdea} />
            )}
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 p-4 sm:p-6 short:p-3 border-t border-border">
          <button
            onClick={onClose}
            className="h-11 sm:pointer-fine:h-10 px-4 rounded-lg border border-border text-sm font-semibold hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSend || start.isPending}
            className="btn-premium h-11 sm:pointer-fine:h-10 px-4 rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
          >
            {start.isPending && <Loader2 className="w-4 h-4 animate-spin" />}{" "}
            {about ? "Send message" : "Send question"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Questions about the topics a student did worst on, one tap from sent. Each
 * wears its subject's tint; picking one fills the subject line, the question
 * and the attached spec point, all still editable. Gone once they write their
 * own question.
 */
function QuestionIdeas({
  ideas,
  picked,
  onPick,
}: {
  ideas: QuestionIdea[];
  picked: string;
  onPick: (idea: QuestionIdea) => void;
}) {
  return (
    <div className="mt-3">
      <p className="eyebrow">Ask about a topic you found hard</p>
      <div className="mt-2 space-y-2">
        {ideas.map((idea) => {
          const chosen = idea.question === picked;
          return (
            <button
              key={idea.specPointId}
              type="button"
              onClick={() => onPick(idea)}
              aria-pressed={chosen}
              className={cn(
                subjectTint(idea.subject),
                "flex w-full min-h-11 items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                chosen
                  ? "border-[color:var(--tint)] bg-[color:color-mix(in_oklab,var(--tint)_8%,var(--card))]"
                  : "border-border hover:border-[color:color-mix(in_oklab,var(--tint)_45%,transparent)]",
              )}
            >
              <span className={cn("icon-tile size-8 shrink-0", chosen && "icon-tile-solid")}>
                <Lightbulb className="w-4 h-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold">
                  <SciText text={idea.topic} />
                </span>
                <span className="block text-sm">
                  <SciText text={idea.question} />
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
