import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Field, inputCls, submitBtn } from "./Field";
import { TaxonomyFields } from "./TaxonomyFields";
import { SpecPointSelect } from "./SpecPointSelect";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";

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

export function VideoForm({ taxonomy }: VideoFormProps) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [specPointIds, setSpecPointIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // The video and its links to the chosen curriculum points (same M2M as live
    // sessions and homework, so it surfaces on each spec point's page and in the
    // student "From your tutor" card when the tutor pins one of its points) are
    // written in one transaction.
    const { error } = await supabase.rpc("create_linked_resource", {
      _kind: "video",
      _title: title,
      _description: description,
      _subject: taxonomy.subject,
      _level: taxonomy.level,
      _board: taxonomy.board,
      _spec_point_ids: specPointIds,
      _video_url: videoUrl,
    });

    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Video added");
    qc.invalidateQueries({ queryKey: ["videos"] });
    qc.invalidateQueries({ queryKey: ["weekly-focus-videos"] });
    setTitle("");
    setDescription("");
    setVideoUrl("");
    setSpecPointIds([]);
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
          inputMode="url"
          className={inputCls}
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
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

      <SpecPointSelect
        subject={taxonomy.subject}
        board={taxonomy.board}
        level={taxonomy.level}
        value={specPointIds}
        onChange={setSpecPointIds}
      />

      <button disabled={loading} className={submitBtn}>
        {loading ? "Saving…" : "Publish video"}
      </button>
    </form>
  );
}
