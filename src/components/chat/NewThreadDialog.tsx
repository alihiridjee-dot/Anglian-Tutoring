import { useEffect, useRef, useState } from "react";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { ArrowRight, Loader2, MessageSquarePlus, X } from "lucide-react";
import { toast } from "sonner";
import { AbovePage, SciText, Spinner } from "@/components/Shared";
import { useQuestionIdeas, useStartThread, useTutorDirectory } from "@/hooks/data/useChat";
import { ContextPicker, StopTrail } from "@/components/chat/ContextPicker";
import { Squiggle } from "@/components/chat/EmptyInbox";
import { ErrorNote } from "@/components/Shared";
import { EMPTY_CONTEXT, type ChatContextSelection } from "@/lib/chat/chatContext";
import type { QuestionIdea } from "@/lib/chat/questionIdeas";
import { subjectTint } from "@/lib/curriculum/subjectTheme";
import { CHAT_MESSAGE_MAX } from "@/lib/platform/textLimits";
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
  // Pointing at Send makes the speech bubble at the top hop, as on the inbox.
  const [reaching, setReaching] = useState(false);

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

  // One question at a time. `start.isPending` turns true only on the next
  // render, so a quick second tap got through and opened a second thread,
  // which told every tutor twice. Same guard as ThreadView's send.
  const sendingRef = useRef(false);
  const submit = () => {
    if (!canSend || start.isPending || sendingRef.current) return;
    sendingRef.current = true;
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
        onSettled: () => {
          sendingRef.current = false;
        },
      },
    );
  };

  // Above the page, or the sticky top bar sits on the title.
  return (
    <AbovePage>
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
          box, and Send used to be the last thing in it, 286px below the fold.

          Playful minimalism, as on the empty inbox: a solid round dot, the
          title with the highlighter stroke, one dark line, plain bold labels,
          the choices as stops, and no lines across the box. */}
        <div
          data-reaching={reaching}
          className="ask-sheet tint-primary premium-card flex w-full max-w-lg flex-col overflow-hidden rounded-3xl shadow-xl max-h-[calc(100dvh-2rem)]"
        >
          <div className="shrink-0 px-5 pt-5 sm:px-7 sm:pt-7 short:px-4 short:pt-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-4">
                <span className="paywall-dot inbox-dot ask-dot">
                  <MessageSquarePlus />
                </span>
                <div className="min-w-0">
                  <h2
                    id="new-thread-title"
                    className="text-2xl leading-tight font-extrabold sm:text-3xl"
                  >
                    {about ? "Message a tutor" : "Ask your tutor"}
                  </h2>
                  <Squiggle className="w-28" />
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="btn-ghost flex size-11 shrink-0 items-center justify-center rounded-full"
              >
                <X className="size-5" />
              </button>
            </div>
            {/* Under the title beside the dot on a wide screen; the box's full
                width on a phone, where beside the dot it wrapped four times. */}
            <p className="mt-3 font-medium sm:pl-[4.5rem]">
              {about
                ? `About ${about.name}`
                : "It goes to the whole team, and they'll see what you attach straight away."}
            </p>
          </div>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-6 sm:px-7 short:px-4 short:py-4">
            {about && (
              <div>
                <h3 className="ask-label">Who are you writing to?</h3>
                {tutorsPending ? (
                  <Spinner label="Loading tutors" className="mt-2 py-3" />
                ) : tutors.length === 0 ? (
                  // A failed read leaves the list empty too, but it isn't "no tutors".
                  tutorsError ? (
                    <div className="mt-2">
                      <ErrorNote error={tutorsError} onRetry={() => void refetchTutors()} />
                    </div>
                  ) : (
                    <p className="mt-2 font-medium">
                      No tutors are available to message right now.
                    </p>
                  )
                ) : (
                  <div className="mt-3">
                    <StopTrail
                      label="Tutor"
                      stops={tutors.map((t) => ({
                        key: t.id,
                        label: t.display_name,
                        glyph: t.display_name.trim().charAt(0).toUpperCase() || "👋",
                      }))}
                      picked={tutorId}
                      onPick={setTutorId}
                    />
                  </div>
                )}
              </div>
            )}

            {!about && (
              <div>
                <h3 className="ask-label">What&apos;s it about?</h3>
                <div className="mt-3">
                  <ContextPicker value={context} onChange={setContext} />
                </div>
              </div>
            )}

            <div>
              <label htmlFor="thread-subject" className="ask-label">
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
                className="pop-input mt-2 h-12 w-full px-4 text-base"
              />
            </div>

            <div>
              <label htmlFor="thread-body" className="ask-label">
                {about ? "Your message" : "Your question"}
              </label>
              <textarea
                id="thread-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                maxLength={CHAT_MESSAGE_MAX}
                placeholder={
                  about
                    ? "Write your message"
                    : "Tell them what you've tried and where you got stuck — the more specific, the faster the answer."
                }
                className="pop-input mt-2 w-full p-4 text-base"
              />
              {ideas.length > 0 && (!body.trim() || ideas.some((i) => i.question === body)) && (
                <QuestionIdeas ideas={ideas} picked={body} onPick={pickIdea} />
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 px-5 pt-3 pb-5 sm:px-7 sm:pb-7 short:px-4 short:pb-3">
            <button onClick={onClose} className="paywall-link">
              Cancel
            </button>
            <button
              onClick={submit}
              onPointerEnter={() => setReaching(true)}
              onPointerLeave={() => setReaching(false)}
              onFocus={() => setReaching(true)}
              onBlur={() => setReaching(false)}
              disabled={!canSend || start.isPending}
              className="btn-solid paywall-btn ask-send"
            >
              {about ? "Send message" : "Send question"}
              {start.isPending ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <ArrowRight className="paywall-arrow size-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </AbovePage>
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
    <div className="mt-5">
      <h3 className="ask-label">Ask about a topic you found hard</h3>
      <ul className="mt-2 space-y-1">
        {ideas.map((idea) => {
          const chosen = idea.question === picked;
          return (
            <li key={idea.specPointId}>
              <button
                type="button"
                onClick={() => onPick(idea)}
                aria-pressed={chosen}
                className={cn(subjectTint(idea.subject), "ask-row ask-idea")}
              >
                <span aria-hidden className="ask-idea-dot">
                  💡
                </span>
                <span className="min-w-0">
                  <span className="block font-bold">
                    <SciText text={idea.topic} />
                  </span>
                  <span className="block text-sm">
                    <SciText text={idea.question} />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
