import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, MessageSquarePlus, X } from "lucide-react";
import { toast } from "sonner";
import { AbovePage, ErrorNote, Spinner } from "@/components/Shared";
import { StopTrail } from "@/components/chat/ContextPicker";
import { Squiggle } from "@/components/chat/EmptyInbox";
import { useStartThread } from "@/hooks/data/useChat";
import { studentKey, useStudentDirectory, useStudentRecord } from "@/hooks/data/useStudents";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { CHAT_MESSAGE_MAX } from "@/lib/platform/textLimits";

interface Props {
  /** Opened from a student's record: that student, already picked. */
  studentId?: string;
  onClose: () => void;
  onCreated: (threadId: string) => void;
}

/** The one stop that means the student themself, beside their parents' ids. */
const STUDENT = "student";

const initial = (name: string) => name.trim().charAt(0).toUpperCase() || "👋";

/**
 * A tutor writes first.
 *
 * The same sheet as a student's "Ask your tutor": pick who it is for, then
 * what to say. Who is a student from the roster, then the student or one of
 * their linked parents. A parent's message lands in the Parent Portal, as a
 * reply to them does. The thread names no tutor, so whoever answers, every
 * tutor hears about it (20261121160000_tutors_start_conversations).
 */
export function TutorNewThreadDialog({ studentId: fixedId, onClose, onCreated }: Props) {
  const qc = useQueryClient();
  const directory = useStudentDirectory();
  const start = useStartThread();

  const [studentId, setStudentId] = useState(fixedId ?? "");
  const [query, setQuery] = useState("");
  const [to, setTo] = useState<string>(STUDENT);
  const [subjectLine, setSubjectLine] = useState("");
  const [body, setBody] = useState("");
  // Pointing at Send makes the speech bubble at the top hop, as on the inbox.
  const [reaching, setReaching] = useState(false);

  // The record is the one the student's page already holds: their name, and
  // the parents linked to them right now.
  const record = useStudentRecord(studentId || null);
  const parents = record.data?.parents ?? [];

  const students = useMemo(
    () =>
      (directory.data ?? [])
        .map((s) => ({ id: s.id, name: s.display_name?.trim() || s.email, email: s.email }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [directory.data],
  );
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? students.filter(
          (s) => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q),
        )
      : students;
  }, [students, query]);

  const studentName =
    record.data?.profile.display_name?.trim() ||
    students.find((s) => s.id === studentId)?.name ||
    "";
  const parent = to === STUDENT ? null : parents.find((p) => p.parent_id === to);
  const parentName = parent?.display_name?.trim() || "Parent";

  // A new student starts at the student again: the old pick was someone
  // else's parent.
  useEffect(() => setTo(STUDENT), [studentId]);

  const canSend =
    !!studentId &&
    (to === STUDENT || !!parent) &&
    subjectLine.trim().length > 0 &&
    body.trim().length > 0;

  // As the student's sheet: Escape and the backdrop close it unless a
  // half-written message would be lost.
  useBodyScrollLock(true);
  const dirty = subjectLine.trim().length > 0 || body.trim().length > 0;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing && !dirty) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, dirty]);

  // One message at a time: a quick second tap used to open a second thread.
  const sendingRef = useRef(false);
  const submit = () => {
    if (!canSend || start.isPending || sendingRef.current) return;
    sendingRef.current = true;
    start.mutate(
      {
        tutorId: null,
        memberId: parent ? parent.parent_id : studentId,
        aboutStudentId: parent ? studentId : null,
        subjectLine: subjectLine.trim(),
        body: body.trim(),
      },
      {
        onSuccess: (threadId) => {
          // The student's record lists their conversations too.
          void qc.invalidateQueries({ queryKey: [...studentKey(studentId), "threads"] });
          toast.success(`Sent to ${parent ? parentName : studentName || "the student"}.`);
          onCreated(threadId);
        },
        onError: (err) => toast.error(err.message),
        onSettled: () => {
          sendingRef.current = false;
        },
      },
    );
  };

  return (
    <AbovePage>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-primary-deep/50 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutor-new-thread-title"
        onClick={(e) => {
          if (e.target === e.currentTarget && !dirty) onClose();
        }}
      >
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
                    id="tutor-new-thread-title"
                    className="text-2xl leading-tight font-extrabold sm:text-3xl"
                  >
                    New message
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
            <p className="mt-3 font-medium sm:pl-[4.5rem]">
              {!studentId || !studentName
                ? "Write to a student or one of their parents."
                : parent
                  ? `To ${parentName}, about ${studentName}`
                  : `To ${studentName}`}
            </p>
          </div>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-6 sm:px-7 short:px-4 short:py-4">
            <div>
              <h3 className="ask-label">Who&apos;s it for?</h3>
              {studentId ? (
                <div className="ask-attached point-panel">
                  <span aria-hidden className="text-xl leading-none">
                    🎓
                  </span>
                  <span className="min-w-0 flex-1 truncate font-bold">
                    {studentName || "Loading…"}
                  </span>
                  {!fixedId && (
                    <button
                      type="button"
                      onClick={() => setStudentId("")}
                      aria-label="Pick another student"
                      className="btn-ghost flex size-11 shrink-0 items-center justify-center rounded-full sm:pointer-fine:size-9"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              ) : directory.error ? (
                <div className="mt-3">
                  <ErrorNote error={directory.error} onRetry={() => void directory.refetch()} />
                </div>
              ) : (
                <div className="point-panel mt-3">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by name or email"
                    aria-label="Search students"
                    className="pop-input h-12 w-full px-4 text-base"
                  />
                  <div className="ask-list point-panel scroll-slim max-h-56 short:max-h-32 overflow-y-auto">
                    {directory.isPending ? (
                      <Spinner className="py-4" />
                    ) : matches.length === 0 ? (
                      <p className="px-3 py-4 text-center font-medium">
                        {students.length === 0 ? "No students yet." : "No student matches that."}
                      </p>
                    ) : (
                      matches.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setStudentId(s.id)}
                          className="ask-row"
                        >
                          <span className="block truncate font-bold">{s.name}</span>
                          {s.name !== s.email && (
                            <span className="block truncate text-sm">{s.email}</span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* The student, or a parent linked to them right now. Nothing is
                drawn for a student with no parent: it goes to the student. */}
            {studentId &&
              (record.error ? (
                <ErrorNote error={record.error} onRetry={() => void record.refetch()} />
              ) : record.isPending ? (
                <Spinner label="Loading parents" className="py-3" />
              ) : (
                parents.length > 0 && (
                  <div>
                    <h3 className="ask-label">Send it to</h3>
                    <div className="mt-3">
                      <StopTrail
                        label="Send it to"
                        stops={[
                          {
                            key: STUDENT,
                            label: studentName || "Student",
                            glyph: initial(studentName),
                          },
                          ...parents.map((p) => {
                            const name = p.display_name?.trim() || "Parent";
                            return {
                              key: p.parent_id,
                              label: `${name} · parent`,
                              glyph: initial(name),
                            };
                          }),
                        ]}
                        picked={to}
                        onPick={setTo}
                      />
                    </div>
                  </div>
                )
              ))}

            <div>
              <label htmlFor="tutor-thread-subject" className="ask-label">
                Subject
              </label>
              <input
                id="tutor-thread-subject"
                value={subjectLine}
                onChange={(e) => setSubjectLine(e.target.value)}
                maxLength={140}
                placeholder="e.g. This week's plan"
                className="pop-input mt-2 h-12 w-full px-4 text-base"
              />
            </div>

            <div>
              <label htmlFor="tutor-thread-body" className="ask-label">
                Your message
              </label>
              <textarea
                id="tutor-thread-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                maxLength={CHAT_MESSAGE_MAX}
                placeholder="Write your message"
                className="pop-input mt-2 w-full p-4 text-base"
              />
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
              Send message
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
