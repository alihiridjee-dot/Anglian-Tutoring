import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ImagePlus, Loader2, Send, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SignedImage } from "@/components/SignedImage";
import { prepareUpload, formatBytes, MAX_UPLOAD_BYTES } from "@/lib/uploadLimits";
import { clearDraft, loadDraft, saveDraft } from "@/lib/homeworkDrafts";
import type { HomeworkQuestion, HomeworkAnswer } from "@/hooks/data/useHomeworkQuestions";

/**
 * Homework as an on-site activity: the student reads each question and types the
 * answer here. Nothing is downloaded and nothing is handed in as a document.
 *
 * Photos are still allowed, but per question and as a supplement — working out
 * for a calculation, a labelled sketch — rather than as the submission itself.
 * They upload to the same `submissions/<student>/<homework>/…` prefix the old
 * flow used, so storage policies, the size trigger and the acknowledge-cleanup
 * all apply unchanged.
 *
 * Submitting writes the submission and every answer in one transaction
 * (`submit_homework_answers`), so a network failure mid-way can't leave a
 * submission with half its answers — and submissions stay final either way.
 */

type Draft = { text: string; images: File[] };

const TYPE_HINT: Record<HomeworkQuestion["answer_type"], string> = {
  short: "A sentence or two.",
  long: "Write in full — several sentences, using the marks as your guide.",
  numeric: "Give the value and its unit. Show your working if it helps.",
};

export function BuiltInHomework({
  hw,
  questions,
  userId,
  submission,
  answers,
  onChanged,
  readonly,
}: {
  hw: { id: string; title: string };
  questions: HomeworkQuestion[];
  userId: string | null;
  submission?: { id: string; graded_at: string | null };
  answers: Record<string, HomeworkAnswer>;
  onChanged: () => void;
  readonly: boolean;
}) {
  const submitted = !!submission;
  return submitted ? (
    <AnsweredView questions={questions} answers={answers} marked={!!submission?.graded_at} />
  ) : (
    <AnswerForm
      hw={hw}
      questions={questions}
      userId={userId}
      onChanged={onChanged}
      readonly={readonly}
    />
  );
}

/** What the student wrote, alongside the marks and comments once it's been marked. */
function AnsweredView({
  questions,
  answers,
  marked,
}: {
  questions: HomeworkQuestion[];
  answers: Record<string, HomeworkAnswer>;
  marked: boolean;
}) {
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Your answers
      </p>
      <ol className="space-y-3">
        {questions.map((q, i) => {
          const a = answers[q.id];
          return (
            <li key={q.id} className="rounded-xl border border-border p-4">
              <div className="flex items-start gap-2">
                <span className="text-xs font-semibold text-muted-foreground shrink-0">
                  Q{i + 1}
                </span>
                <p className="text-sm font-medium whitespace-pre-wrap flex-1">{q.prompt}</p>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {a?.awarded_marks != null
                    ? `${Number(a.awarded_marks)}/${q.marks}`
                    : `${q.marks} marks`}
                </span>
              </div>
              {q.image_path && (
                <div className="mt-2">
                  <SignedImage path={q.image_path} alt={q.image_name ?? "Question figure"} />
                </div>
              )}
              <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">
                {a?.answer_text || <span className="italic">Left blank</span>}
              </p>
              {a && a.images.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {a.images.map((img) => (
                    <SignedImage
                      key={img.path}
                      path={img.path}
                      alt={img.name}
                      className="max-h-40 rounded-lg border border-border object-contain"
                    />
                  ))}
                </div>
              )}
              {a?.feedback && (
                <p className="mt-2 text-xs text-accent whitespace-pre-wrap">{a.feedback}</p>
              )}
              {/* The mark scheme is the answer — it stays hidden until the work
                  has actually been marked. */}
              {marked && q.mark_scheme && (
                <div className="mt-2 pt-2 border-t border-border">
                  <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground mb-1">
                    Mark scheme
                  </p>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                    {q.mark_scheme}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function AnswerForm({
  hw,
  questions,
  userId,
  onChanged,
  readonly,
}: {
  hw: { id: string; title: string };
  questions: HomeworkQuestion[];
  userId: string | null;
  onChanged: () => void;
  readonly: boolean;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [restored, setRestored] = useState(false);

  const draftOf = (id: string): Draft => drafts[id] ?? { text: "", images: [] };
  const patch = (id: string, changes: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...draftOf(id), ...changes } }));

  // Bring back anything typed but never submitted. Answers only — attached
  // photos are File objects and can't be persisted, so those must be re-picked.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || !userId) return;
    hydrated.current = true;
    const saved = loadDraft(userId, hw.id);
    if (!saved) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const [qid, text] of Object.entries(saved.answers)) {
        next[qid] = { text, images: next[qid]?.images ?? [] };
      }
      return next;
    });
    setNotes(saved.notes);
    setRestored(true);
  }, [userId, hw.id]);

  // Persist as they type. Debounced so a fast typist isn't writing to storage
  // on every keystroke.
  useEffect(() => {
    if (!userId || !hydrated.current) return;
    const t = setTimeout(() => {
      saveDraft(userId, hw.id, {
        answers: Object.fromEntries(Object.entries(drafts).map(([k, v]) => [k, v.text])),
        notes,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [drafts, notes, userId, hw.id]);

  const hasUnsent =
    notes.trim().length > 0 || Object.values(drafts).some((d) => d.text.trim().length > 0);

  // A reload or a closed tab is recoverable now, but a student who navigates
  // away mid-answer still deserves the browser's own warning.
  useEffect(() => {
    if (!hasUnsent) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsent]);

  const answered = questions.filter((q) => draftOf(q.id).text.trim().length > 0).length;
  const totalMarks = questions.reduce((sum, q) => sum + q.marks, 0);

  const addImages = (id: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    patch(id, { images: [...draftOf(id).images, ...Array.from(files)] });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return toast.error("Not signed in");
    if (answered === 0) return toast.error("Answer at least one question before submitting");

    setSaving(true);
    try {
      // Upload every attached photo first: if one fails, nothing is submitted
      // and the student can retry with their answers still on screen.
      const payload: Array<{
        question_id: string;
        answer_text: string;
        images: Array<{ path: string; name: string }>;
      }> = [];

      let shrunk = 0;
      for (const q of questions) {
        const d = draftOf(q.id);
        const uploaded: Array<{ path: string; name: string }> = [];
        for (const file of d.images) {
          const result = await prepareUpload(file);
          if (!result.ok) {
            toast.error(result.reason);
            setSaving(false);
            return;
          }
          if (result.compressed) shrunk++;
          const path = `submissions/${userId}/${hw.id}/${crypto.randomUUID()}-${result.file.name}`;
          const { error } = await supabase.storage
            .from("resources")
            .upload(path, result.file, { upsert: false });
          if (error) throw error;
          uploaded.push({ path, name: result.file.name });
        }
        payload.push({ question_id: q.id, answer_text: d.text, images: uploaded });
      }
      if (shrunk > 0) {
        toast.info(`Compressed ${shrunk} image${shrunk === 1 ? "" : "s"} to fit the 1 MB limit`);
      }

      const { error } = await supabase.rpc("submit_homework_answers", {
        _resource_id: hw.id,
        _answers: payload,
        _notes: notes || undefined,
      });
      if (error) throw error;

      toast.success("Homework submitted");
      if (userId) clearDraft(userId, hw.id);
      setDrafts({});
      setNotes("");
      setRestored(false);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit");
    } finally {
      setSaving(false);
    }
  };

  if (readonly) {
    // The public demo has no session and can't write anything — show the paper,
    // not the pen.
    return (
      <div className="mt-4 space-y-3">
        {questions.map((q, i) => (
          <QuestionHeader key={q.id} q={q} index={i} />
        ))}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="border-t border-border p-6 bg-muted/40 space-y-4">
      {restored && (
        <p className="text-xs rounded-lg bg-primary/10 border border-primary/30 px-3 py-2">
          We brought back what you'd typed last time. Any photos you'd attached need adding again.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Answer on the page
        </p>
        <span className="text-xs text-muted-foreground">
          {answered}/{questions.length} answered · {totalMarks} marks
        </span>
      </div>

      <ol className="space-y-4">
        {questions.map((q, i) => {
          const d = draftOf(q.id);
          return (
            <li key={q.id} className="rounded-xl bg-card border border-border p-4 space-y-2">
              <QuestionHeader q={q} index={i} />
              <textarea
                value={d.text}
                onChange={(e) => patch(q.id, { text: e.target.value })}
                placeholder={TYPE_HINT[q.answer_type]}
                className={`w-full rounded-lg premium-input px-3 py-2 text-sm ${
                  q.answer_type === "long" ? "min-h-32" : "min-h-16"
                }`}
              />

              {d.images.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {d.images.map((f, idx) => (
                    <li
                      key={`${f.name}-${idx}`}
                      className="inline-flex items-center gap-2 text-xs premium-card rounded-lg px-2.5 py-1.5"
                    >
                      <span className="truncate max-w-40">{f.name}</span>
                      <span className="text-muted-foreground">{formatBytes(f.size)}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${f.name}`}
                        onClick={() =>
                          patch(q.id, { images: d.images.filter((_, j) => j !== idx) })
                        }
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                <ImagePlus className="w-3.5 h-3.5" />
                Attach a photo of your working
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addImages(q.id, e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            </li>
          );
        })}
      </ol>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Anything you'd like your tutor to know (optional)"
        className="w-full min-h-16 rounded-lg premium-input px-3 py-2 text-sm"
      />
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Submissions are final — once you submit you can't change your answers. Photos are compressed
        to {formatBytes(MAX_UPLOAD_BYTES)} each.
      </p>
      <button
        disabled={saving}
        className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60 inline-flex items-center justify-center gap-2"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        {saving ? "Submitting…" : "Submit answers"}
      </button>
    </form>
  );
}

function QuestionHeader({ q, index }: { q: HomeworkQuestion; index: number }) {
  return (
    <div>
      <div className="flex items-start gap-2">
        <span className="text-xs font-semibold text-muted-foreground shrink-0">Q{index + 1}</span>
        <p className="text-sm font-medium whitespace-pre-wrap flex-1">{q.prompt}</p>
        <span className="text-[11px] text-muted-foreground shrink-0">[{q.marks}]</span>
      </div>
      {q.image_path && (
        <div className="mt-2">
          <SignedImage path={q.image_path} alt={q.image_name ?? "Question figure"} />
        </div>
      )}
    </div>
  );
}

/** Small confirmation strip shown once a built-in homework has been handed in. */
export function SubmittedStrip({ count }: { count: number }) {
  return (
    <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
      {count} answer{count === 1 ? "" : "s"} submitted — your tutor will mark them here.
    </p>
  );
}
