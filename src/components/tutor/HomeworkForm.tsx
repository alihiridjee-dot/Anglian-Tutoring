import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Field, inputCls, submitBtn } from "./Field";
import { TaxonomyFields } from "./TaxonomyFields";
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
  const [taskFile, setTaskFile] = useState<File | null>(null);
  const [msFile, setMsFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      let task: { path: string; name: string; mime: string; size: number } | null = null;
      let ms: { path: string; name: string; mime: string; size: number } | null = null;
      if (taskFile) task = await uploadFile(taskFile, "homework");
      if (msFile) ms = await uploadFile(msFile, "mark-schemes");
      const { error } = await supabase.from("resources").insert({
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
      });
      if (error) throw error;
      toast.success("Homework set");
      qc.invalidateQueries({ queryKey: ["homework"] });
      setTitle("");
      setInstructions("");
      setDueAt("");
      setTaskFile(null);
      setMsFile(null);
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="Task file (optional)">
          <input
            type="file"
            className="text-sm"
            onChange={(e) => setTaskFile(e.target.files?.[0] ?? null)}
          />
        </Field>
        <Field label="Mark scheme (optional)">
          <input
            type="file"
            className="text-sm"
            onChange={(e) => setMsFile(e.target.files?.[0] ?? null)}
          />
        </Field>
      </div>
      <TaxonomyFields {...taxonomy} />
      <button disabled={loading} className={submitBtn}>
        {loading ? "Uploading…" : "Set homework"}
      </button>
    </form>
  );
}
