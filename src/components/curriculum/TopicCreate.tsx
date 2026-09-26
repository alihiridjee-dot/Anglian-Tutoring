import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRole";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { inputCls } from "@/components/curriculum/styles";

export function TopicCreate({
  subject,
  board,
  level,
  onCreated,
}: {
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  onCreated: () => void;
}) {
  const { userId } = useRoles();
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [open, setOpen] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    const { error } = await supabase.from("topics").insert({
      subject,
      board,
      level,
      code: code || null,
      title,
      created_by: userId,
    });
    if (error) return toast.error(error.message);
    setCode("");
    setTitle("");
    setOpen(false);
    onCreated();
    toast.success("Topic created");
  };
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full h-11 border border-dashed border-border rounded-xl flex items-center justify-center gap-2 text-xs font-semibold hover:border-primary/50 text-muted-foreground hover:text-primary mb-4 transition"
      >
        <Plus className="w-4 h-4" /> Add Topic
      </button>
    );
  }
  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-border p-4 mb-4 bg-muted/40 space-y-3"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        New Topic
      </p>
      <div className="grid grid-cols-1 md:grid-cols-[100px,1fr] gap-3">
        <div>
          <label className="text-[10px] uppercase text-muted-foreground">Code</label>
          <input
            className={inputCls}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="4.1"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase text-muted-foreground">Title</label>
          <input
            required
            className={inputCls}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Cell Biology"
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-11 sm:h-8 px-3 rounded-md text-xs hover:bg-secondary border border-border"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="h-11 sm:h-8 px-3 rounded-md text-xs btn-solid font-semibold"
        >
          Create
        </button>
      </div>
    </form>
  );
}
