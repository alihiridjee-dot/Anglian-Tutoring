import { useState } from "react";
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
}

async function uploadFile(file: File, folder: string) {
  const path = `${folder}/${crypto.randomUUID()}-${file.name}`;
  const { error } = await supabase.storage.from("resources").upload(path, file, { upsert: false });
  if (error) throw error;
  return { path, name: file.name, mime: file.type, size: file.size };
}

export function HomeworkForm({ userId, taxonomy }: HomeworkFormProps) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [specPointIds, setSpecPointIds] = useState<string[]>([]);
  const [taskFile, setTaskFile] = useState<File | null>(null);
  const [msFile, setMsFile] = useState<File | null>(null);
  const [questions, setQuestions] = useState<BuilderQuestion[]>([]);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // A question with no prompt would render as an empty box the student can't
    // answer, so catch it here rather than shipping it.
    if (questions.some((q) => !q.prompt.trim())) {
      return toast.error("Every question needs a prompt — fill it in or delete it");
    }
    setLoading(true);
    try {
      let task: { path: string; name: string; mime: string; size: number } | null = null;
      let ms: { path: string; name: string; mime: string; size: number } | null = null;
      if (taskFile) task = await uploadFile(taskFile, "homework");
      if (msFile) ms = await uploadFile(msFile, "mark-schemes");
      const { data: created, error } = await supabase
        .from("resources")
        .insert({
          kind: "homework",
          title,
          instructions,
          due_at: dueAt ? new Date(dueAt).toISOString() : null,
          file_path: task?.path,
          file_name: task?.name,
          file_mime: task?.mime,
          file_size: task?.size,
          mark_scheme_path: ms?.path,
          mark_scheme_name: ms?.name,
          subject: taxonomy.subject,
          board: taxonomy.board,
          level: taxonomy.level,
          created_by: userId,
        })
        .select("id")
        .single();
      if (error) throw error;

      // The questions themselves. Figures are uploaded only now, so an abandoned
      // form leaves nothing behind in storage.
      if (questions.length > 0) {
        const rows = [];
        for (let i = 0; i < questions.length; i++) {
          const q = questions[i];
          const figure = q.image ? await uploadFile(q.image, "homework/figures") : null;
          rows.push({
            resource_id: created.id,
            position: i,
            prompt: q.prompt.trim(),
            marks: q.marks,
            answer_type: q.answer_type,
            image_path: figure?.path ?? null,
            image_name: figure?.name ?? null,
            mark_scheme: q.mark_scheme.trim() || null,
            spec_point_id: q.spec_point_id,
          });
        }
        const { error: qError } = await supabase.from("homework_questions").insert(rows);
        if (qError) throw qError;
      }

      // Curriculum links live in resource_spec_points, not resources.spec_point_id
      // (deprecated) — homework can hang off several points, and students find it
      // by browsing any of them.
      if (specPointIds.length > 0) {
        const { error: linkError } = await supabase
          .from("resource_spec_points")
          .insert(
            specPointIds.map((spec_point_id) => ({ resource_id: created.id, spec_point_id })),
          );
        if (linkError) throw linkError;
      }

      toast.success(
        questions.length > 0
          ? `Homework set — ${questions.length} question${questions.length === 1 ? "" : "s"} students answer on the site`
          : "Homework set",
      );
      qc.invalidateQueries({ queryKey: ["homework"] });
      setTitle("");
      setInstructions("");
      setDueAt("");
      setSpecPointIds([]);
      setTaskFile(null);
      setMsFile(null);
      setQuestions([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  };

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

      {/* The homework itself. Students answer these on the site — the files
          below are only for anything that can't be expressed as a question. */}
      <QuestionBuilder
        questions={questions}
        onChange={setQuestions}
        subject={taxonomy.subject}
        board={taxonomy.board}
        level={taxonomy.level}
        specPointIds={specPointIds}
      />

      <details className="rounded-xl border border-border px-4 py-3">
        <summary className="text-xs uppercase tracking-widest font-semibold text-muted-foreground cursor-pointer">
          Attachments (optional)
        </summary>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="Reference sheet">
            <input
              type="file"
              className="text-sm"
              onChange={(e) => setTaskFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <Field label="Mark scheme">
            <input
              type="file"
              className="text-sm"
              onChange={(e) => setMsFile(e.target.files?.[0] ?? null)}
            />
          </Field>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Only needed for material the questions can't carry — a data booklet or a long source. The
          questions above are what students actually answer.
        </p>
      </details>

      <button disabled={loading} className={submitBtn}>
        {loading ? "Uploading…" : "Set homework"}
      </button>
    </form>
  );
}
