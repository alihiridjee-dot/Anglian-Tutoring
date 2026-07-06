import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Field, inputCls, submitBtn } from "./Field";
import { TaxonomyFields } from "./TaxonomyFields";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";

interface VideoFormProps {
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

export function VideoForm({ userId, taxonomy }: VideoFormProps) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.from("resources").insert({
      kind: "video",
      title,
      description,
      video_url: videoUrl,
      subject: taxonomy.subject,
      board: taxonomy.board,
      level: taxonomy.level,
      created_by: userId,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Video added");
    qc.invalidateQueries({ queryKey: ["videos"] });
    setTitle("");
    setDescription("");
    setVideoUrl("");
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
      <Field label="Video URL (YouTube / Vimeo / mp4)">
        <input
          required
          type="url"
          className={inputCls}
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
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
        {loading ? "Saving…" : "Publish video"}
      </button>
    </form>
  );
}
