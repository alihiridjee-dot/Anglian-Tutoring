import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Field, inputCls, submitBtn } from "./Field";
import { TaxonomyFields } from "./TaxonomyFields";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";

interface LiveFormProps {
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

export function LiveForm({ userId, taxonomy }: LiveFormProps) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [joinUrl, setJoinUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.from("resources").insert({
      kind: "live_session",
      title,
      description,
      starts_at: new Date(startsAt).toISOString(),
      join_url: joinUrl,
      subject: taxonomy.subject,
      board: taxonomy.board,
      level: taxonomy.level,
      created_by: userId,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Live session scheduled");
    qc.invalidateQueries({ queryKey: ["live"] });
    setTitle("");
    setDescription("");
    setStartsAt("");
    setJoinUrl("");
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts at">
          <input
            required
            type="datetime-local"
            className={inputCls}
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </Field>
        <Field label="Join URL">
          <input
            required
            type="url"
            className={inputCls}
            value={joinUrl}
            onChange={(e) => setJoinUrl(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Description">
        <textarea
          className={`${inputCls} h-24 py-2`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <TaxonomyFields {...taxonomy} />
      <button disabled={loading} className={submitBtn}>
        {loading ? "Saving…" : "Schedule session"}
      </button>
    </form>
  );
}
