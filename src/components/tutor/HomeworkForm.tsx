import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { QUESTION_COLUMNS, withMarkSchemes } from "@/lib/homework/markSchemes";
import { toast } from "sonner";
import { Field, inputCls, submitBtn } from "./Field";
import { TaxonomyFields } from "./TaxonomyFields";
import { SpecPointSelect } from "./SpecPointSelect";
import { QuestionBuilder } from "./QuestionBuilder";
import { type BuilderQuestion } from "@/lib/homework/builderQuestion";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";

/**
 * Writing a homework, and — with `editing` — correcting one already set.
 *
 * Editing matters more than it sounds. Most homework on the platform is now
 * drafted by a model, and a model occasionally writes a question with a typo, a
 * wrong unit, or a mark scheme that doesn't match what it asked. Until this
 * existed the only remedy was to delete the sheet for everybody, which also
 * threw away every answer already written against it.
 *
 * So questions keep their identity through an edit: a question that already has
 * a row is updated in place, and the answers pointing at it stay pointing at
 * it. Only a question the tutor actually removes is deleted — and that does
 * take its answers with it, which is why the builder says so.
 */

interface HomeworkFormProps {
  /** Unused: save_homework_brief credits the brief to the signed-in tutor. */
  userId: string;
  taxonomy: {
    subject: SubjectV;
    setSubject: (v: SubjectV) => void;
    board: BoardV;
    setBoard: (v: BoardV) => void;
    level: LevelV;
    setLevel: (v: LevelV) => void;
  };
  /** Present when correcting an existing brief rather than writing a new one. */
  editing?: { id: string; onDone: () => void };
}

export function HomeworkForm({ taxonomy, editing }: HomeworkFormProps) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [specPointIds, setSpecPointIds] = useState<string[]>([]);
  const [questions, setQuestions] = useState<BuilderQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(!!editing);

  const editingId = editing?.id;
  useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    setHydrating(true);

    void (async () => {
      const [{ data: hw }, { data: qs }, { data: links }] = await Promise.all([
        supabase
          .from("resources")
          .select("title, instructions, due_at, subject, board, level")
          .eq("id", editingId)
          .single(),
        supabase
          .from("homework_questions")
          .select(QUESTION_COLUMNS)
          .eq("resource_id", editingId)
          .order("position", { ascending: true }),
        supabase.from("resource_spec_points").select("spec_point_id").eq("resource_id", editingId),
      ]);
      if (cancelled) return;

      if (hw) {
        setTitle(hw.title ?? "");
        setInstructions(hw.instructions ?? "");
        // datetime-local wants `YYYY-MM-DDTHH:mm` in local time, which is what
        // slicing a locale-independent ISO string would get wrong by the offset.
        setDueAt(hw.due_at ? toLocalInput(new Date(hw.due_at)) : "");
        if (hw.subject) taxonomy.setSubject(hw.subject as SubjectV);
        if (hw.board) taxonomy.setBoard(hw.board as BoardV);
        if (hw.level) taxonomy.setLevel(hw.level as LevelV);
      }

      // Saving writes every scheme back, so one that failed to load must never
      // become a blank one. Stay on the spinner, where nothing can be saved.
      let withSchemes: Awaited<ReturnType<typeof withMarkSchemes<NonNullable<typeof qs>[number]>>>;
      try {
        withSchemes = await withMarkSchemes(qs ?? []);
      } catch {
        if (!cancelled)
          toast.error("Couldn't load this task's mark schemes. Close it and try again.");
        return;
      }
      if (cancelled) return;

      const rows = withSchemes.map((q) => ({
        key: q.id,
        id: q.id,
        prompt: q.prompt,
        marks: q.marks,
        answer_type: q.answer_type as BuilderQuestion["answer_type"],
        mark_scheme: q.mark_scheme ?? "",
        spec_point_id: q.spec_point_id,
      }));
      setQuestions(rows);
      setSpecPointIds((links ?? []).map((l) => l.spec_point_id));
      setHydrating(false);
    })();

    return () => {
      cancelled = true;
    };
    // `taxonomy` holds fresh setter identities on every render; the id is what
    // decides whether this should run again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  const reset = () => {
    setTitle("");
    setInstructions("");
    setDueAt("");
    setSpecPointIds([]);
    setQuestions([]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // A question with no prompt would render as an empty box the student can't
    // answer, so catch it here rather than shipping it.
    if (questions.some((q) => !q.prompt.trim())) {
      return toast.error("Every question needs a prompt — fill it in or delete it");
    }
    setLoading(true);
    try {
      // One call writes the brief, its questions and its curriculum links, or
      // nothing (S-11, M-20). Saving them one request at a time collided on the
      // question order whenever two questions swapped places, and a failure
      // part-way left an empty brief that a retry duplicated.
      const { error } = await supabase.rpc("save_homework_brief", {
        _id: editingId ?? null,
        _title: title,
        _instructions: instructions,
        _due_at: dueAt ? new Date(dueAt).toISOString() : null,
        _subject: taxonomy.subject,
        _board: taxonomy.board,
        _level: taxonomy.level,
        _spec_point_ids: specPointIds,
        // In sheet order. A question with an id is updated in place, so the
        // answers pointing at it stay; one the tutor removed is deleted, and
        // takes its answers with it, which is why the builder says so.
        _questions: questions.map((q) => ({
          id: q.id ?? null,
          prompt: q.prompt.trim(),
          marks: q.marks,
          answer_type: q.answer_type,
          mark_scheme: q.mark_scheme.trim() || null,
          spec_point_id: q.spec_point_id,
        })),
      });
      if (error) throw error;

      toast.success(
        editingId
          ? "Task updated"
          : questions.length > 0
            ? `Task set — ${questions.length} question${questions.length === 1 ? "" : "s"} students answer on the site`
            : "Task set",
      );
      qc.invalidateQueries({ queryKey: ["homework"] });
      if (editing) editing.onDone();
      else reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  };

  if (hydrating) {
    return <p className="text-muted-foreground py-6 text-sm">Loading this task…</p>;
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Title">
        <input
          required
          className={inputCls}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>
      <Field label="Instructions">
        <textarea
          className={`${inputCls} h-28 py-2`}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </Field>
      <Field label="Due at">
        <input
          type="datetime-local"
          className={inputCls}
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
        />
      </Field>
      <p className="text-muted-foreground text-xs">
        A task with no due date sits in the student&apos;s practice list rather than their
        deadlines.
      </p>
      <TaxonomyFields {...taxonomy} />
      <SpecPointSelect
        subject={taxonomy.subject}
        board={taxonomy.board}
        level={taxonomy.level}
        value={specPointIds}
        onChange={setSpecPointIds}
      />

      <QuestionBuilder
        questions={questions}
        onChange={setQuestions}
        subject={taxonomy.subject}
        board={taxonomy.board}
        level={taxonomy.level}
        specPointIds={specPointIds}
        editing={!!editingId}
      />

      <div className="flex flex-wrap gap-2">
        <button disabled={loading} className={submitBtn}>
          {loading ? "Saving…" : editingId ? "Save changes" : "Set task"}
        </button>
        {editing && (
          <button
            type="button"
            onClick={editing.onDone}
            disabled={loading}
            className="btn-premium h-11 sm:pointer-fine:h-10 shrink-0 rounded-lg px-4 text-sm font-semibold disabled:opacity-60"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** `YYYY-MM-DDTHH:mm` in the viewer's own timezone, which is what the input wants. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}
