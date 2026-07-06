import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Field, inputCls, submitBtn } from "./Field";
import { TaxonomyFields } from "./TaxonomyFields";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";

interface DownloadFormProps {
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

export function DownloadForm({ userId, taxonomy }: DownloadFormProps) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return toast.error("Choose a file");
    setLoading(true);
    try {
      const up = await uploadFile(file, "downloads");
      const { error } = await supabase.from("resources").insert({
        kind: "download",
        title,
        description,
        file_path: up.path,
        file_name: up.name,
        file_mime: up.mime,
        file_size: up.size,
        subject: taxonomy.subject,
        board: taxonomy.board,
        level: taxonomy.level,
        created_by: userId,
      });
      if (error) throw error;
      toast.success("File uploaded");
      qc.invalidateQueries({ queryKey: ["downloads"] });
      setTitle("");
      setDescription("");
      setFile(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
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
      <Field label="File">
        <input
          required
          type="file"
          className="text-sm"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </Field>
      <Field label="Description">
        <textarea
          className={`${inputCls} h-24 py-2`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <TaxonomyFields {...taxonomy} />
      <button disabled={loading} className={submitBtn}>
        {loading ? "Uploading…" : "Upload file"}
      </button>
    </form>
  );
}
