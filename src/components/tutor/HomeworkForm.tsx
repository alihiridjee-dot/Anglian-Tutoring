import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Field, inputCls, submitBtn } from "./Field";
import { TaxonomyFields } from "./TaxonomyFields";
import { SpecPointSelect } from "./SpecPointSelect";
import { UseWeeklyFocusButton } from "./UseWeeklyFocusButton";
import { QuestionBuilder } from "./QuestionBuilder";
import { type BuilderQuestion } from "@/lib/builderQuestion";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";

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

export function HomeworkForm({ userId, taxonomy, editing }: HomeworkFormProps) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [specPointIds, setSpecPointIds] = useState<string[]>([]);
  const [questions, setQuestions] = useState<BuilderQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(!!editing);

  // Which question rows existed when the form opened. Anything in here that the
  // tutor has since removed is what gets deleted on save.
  const [originalIds, setOriginalIds] = useState<string[]>([]);

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
          .select("id, position, prompt, marks, answer_type, mark_scheme, spec_point_id")
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

      const rows = (qs ?? []).map((q) => ({
        key: q.id,
        id: q.id,
        prompt: q.prompt,
        marks: q.marks,
        answer_type: q.answer_type as BuilderQuestion["answer_type"],
        mark_scheme: q.mark_scheme ?? "",
        spec_point_id: q.spec_point_id,
      }));
      setQuestions(rows);
      setOriginalIds(rows.map((r) => r.id));
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
    setOriginalIds([]);
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
      const resourceId = editingId ?? (await insertResource());
      if (editingId) await updateResource(editingId);
      await saveQuestions(resourceId);
      await saveSpecPoints(resourceId);

      toast.success(
        editingId
          ? "Homework updated"
          : questions.length > 0
            ? `Homework set — ${questions.length} question${questions.length === 1 ? "" : "s"} students answer on the site`
            : "Homework set",
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

  const insertResource = async (): Promise<string> => {
    const { data: created, error } = await supabase
      .from("resources")
      .insert({
        kind: "homework",
        title,
        instructions,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        subject: taxonomy.subject,
        board: taxonomy.board,
        level: taxonomy.level,
        created_by: userId,
        // A brief written here is a brief somebody decided to set, which is what
        // separates it from the generated library in the student's list.
        origin: "tutor",
      })
      .select("id")
      .single();
    if (error) throw error;
    return created.id;
  };

  const updateResource = async (id: string) => {
    const { error } = await supabase
      .from("resources")
      .update({
        title,
        instructions,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        subject: taxonomy.subject,
        board: taxonomy.board,
        level: taxonomy.level,
      })
      .eq("id", id);
    if (error) throw error;
  };

  /**
   * Reconcile the question list against what is in the database.
   *
   * Deletes go first: if a question is being removed and another is being added
   * at the same position, doing it the other way round would collide on
   * whatever uniqueness position carries.
   */
  const saveQuestions = async (resourceId: string) => {
    const keptIds = new Set(questions.map((q) => q.id).filter(Boolean) as string[]);
    const removed = originalIds.filter((id) => !keptIds.has(id));

    if (removed.length > 0) {
      const { error } = await supabase.from("homework_questions").delete().in("id", removed);
      if (error) throw error;
    }

    const updates = questions
      .map((q, i) => ({ q, i }))
      .filter(({ q }) => !!q.id)
      .map(({ q, i }) =>
        supabase
          .from("homework_questions")
          .update({
            position: i,
            prompt: q.prompt.trim(),
            marks: q.marks,
            answer_type: q.answer_type,
            mark_scheme: q.mark_scheme.trim() || null,
            spec_point_id: q.spec_point_id,
          })
          .eq("id", q.id!)
          .then(({ error }) => {
            if (error) throw error;
          }),
      );
    const results = await Promise.allSettled(updates);
    const failed = results.find((r) => r.status === "rejected");
    if (failed) throw (failed as PromiseRejectedResult).reason;

    const inserts = questions
      .map((q, i) => ({ q, i }))
      .filter(({ q }) => !q.id)
      .map(({ q, i }) => ({
        resource_id: resourceId,
        position: i,
        prompt: q.prompt.trim(),
        marks: q.marks,
        answer_type: q.answer_type,
        mark_scheme: q.mark_scheme.trim() || null,
        spec_point_id: q.spec_point_id,
      }));
    if (inserts.length > 0) {
      const { error } = await supabase.from("homework_questions").insert(inserts);
      if (error) throw error;
    }
  };

  /**
   * Curriculum links live in resource_spec_points, not resources.spec_point_id
   * (deprecated) — homework can hang off several points, and students find it
   * by browsing any of them.
   */
  const saveSpecPoints = async (resourceId: string) => {
    if (editingId) {
      const { error } = await supabase
        .from("resource_spec_points")
        .delete()
        .eq("resource_id", resourceId);
      if (error) throw error;
    }
    if (specPointIds.length === 0) return;
    const { error } = await supabase
      .from("resource_spec_points")
      .insert(specPointIds.map((spec_point_id) => ({ resource_id: resourceId, spec_point_id })));
    if (error) throw error;
  };

  if (hydrating) {
    return <p className="text-muted-foreground py-6 text-sm">Loading this homework…</p>;
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
        Homework with no due date sits in the student&apos;s practice list rather than their
        deadlines.
      </p>
      <TaxonomyFields {...taxonomy} />
      <UseWeeklyFocusButton
        subject={taxonomy.subject}
        board={taxonomy.board}
        level={taxonomy.level}
        value={specPointIds}
        onApply={setSpecPointIds}
      />
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
          {loading ? "Saving…" : editingId ? "Save changes" : "Set homework"}
        </button>
        {editing && (
          <button
            type="button"
            onClick={editing.onDone}
            disabled={loading}
            className="btn-premium h-10 shrink-0 rounded-lg px-4 text-sm font-semibold disabled:opacity-60"
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
