import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRole";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import { toast } from "sonner";
import { CurriculumDAL } from "@/lib/curriculum/curriculumDal";
import type { Topic, SpecPoint } from "@/lib/curriculum/types";
import {
  CoverageBox,
  TopicCoverage,
  TopicCoverageLoading,
} from "@/components/curriculum/ScheduleBadges";
import { type CourseSchedule } from "@/lib/planner/pointSchedule";
import { Plus, Trash2, ChevronRight } from "lucide-react";
import { inputCls } from "@/components/curriculum/styles";

export function TopicCard({
  topic,
  open,
  onToggle,
  isTutor,
  onDeleted,
  level,
  board,
  subject,
  onSelectSpecPoint,
  schedule,
  scheduleLoading,
}: {
  topic: Topic;
  open: boolean;
  onToggle: () => void;
  isTutor: boolean;
  onDeleted: () => void;
  level: LevelV;
  board: BoardV;
  subject: SubjectV;
  onSelectSpecPoint: (p: SpecPoint) => void;
  schedule: CourseSchedule | null;
  scheduleLoading: boolean;
}) {
  const coverage = schedule?.byTopic.get(topic.id);
  const [points, setPoints] = useState<SpecPoint[]>([]);

  useEffect(() => {
    const loadPoints = async () => {
      try {
        const data = await CurriculumDAL.getSpecPoints(topic.id);
        setPoints(data);
      } catch (e) {
        console.error(e);
      }
    };

    if (open) {
      loadPoints();
    }
  }, [open, topic.id, level, board, subject]);

  const reload = async () => {
    try {
      const data = await CurriculumDAL.getSpecPoints(topic.id);
      setPoints(data);
    } catch (e) {
      console.error(e);
    }
  };

  const del = async () => {
    if (!confirm(`Delete topic "${topic.title}" and all its spec points?`)) return;
    const { error } = await supabase.from("topics").delete().eq("id", topic.id);
    if (error) return toast.error(error.message);
    toast.success("Topic deleted");
    onDeleted();
  };

  return (
    <div className="rounded-2xl premium-card overflow-hidden">
      <div className="flex items-center hover:bg-secondary/40">
        <button
          onClick={onToggle}
          className="flex-1 min-w-0 flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-2 px-4 sm:px-5 py-4 text-left"
        >
          <ChevronRight className={`w-4 h-4 shrink-0 transition ${open ? "rotate-90" : ""}`} />
          {topic.code && (
            <span className="text-[11px] font-bold tracking-wide whitespace-nowrap px-2 py-0.5 rounded bg-[color:color-mix(in_oklab,var(--tint)_15%,transparent)] text-[color:var(--tint)]">
              {topic.code}
            </span>
          )}
          <span className="font-display font-bold truncate min-w-0 flex-1 sm:flex-initial">
            {topic.title}
          </span>
          {coverage ? <TopicCoverage {...coverage} /> : scheduleLoading && <TopicCoverageLoading />}
        </button>
        {isTutor && (
          <button
            onClick={del}
            className="tap-target text-muted-foreground hover:text-destructive p-1 mr-3 sm:mr-4 shrink-0"
            aria-label={`Delete topic ${topic.title}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      {open && (
        <div className="border-t border-border p-4 sm:p-5 space-y-4">
          {isTutor && <SpecPointCreate topicId={topic.id} onCreated={reload} />}
          {points.length === 0 ? (
            <p className="text-muted-foreground text-sm italic">
              No spec points in this topic yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {points.map((p) => {
                const covered = schedule?.byPoint.get(p.id)?.kind === "covered";
                return (
                  <button
                    key={p.id}
                    onClick={() => onSelectSpecPoint(p)}
                    className={`text-left p-4 rounded-xl border transition flex items-start gap-3 group ${covered ? "border-emerald-500/40 bg-emerald-500/[0.05] hover:border-emerald-500/60" : "border-border bg-secondary/10 hover:border-primary/50 hover:bg-secondary/30"}`}
                  >
                    <span className="text-[11px] font-bold tracking-wide text-primary bg-primary/10 px-2 py-0.5 rounded shrink-0 mt-0.5">
                      {p.code}
                    </span>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-sm text-foreground leading-tight group-hover:text-primary transition">
                        {p.title}
                      </h4>
                      {p.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-normal">
                          {p.description}
                        </p>
                      )}
                    </div>
                    {schedule && <CoverageBox covered={covered} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SpecPointCreate({ topicId, onCreated }: { topicId: string; onCreated: () => void }) {
  const { userId } = useRoles();
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [open, setOpen] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    const { error } = await supabase.from("spec_points").insert({
      topic_id: topicId,
      code,
      title,
      description: description || null,
      created_by: userId,
    });
    if (error) return toast.error(error.message);
    setCode("");
    setTitle("");
    setDescription("");
    setOpen(false);
    onCreated();
    toast.success("Spec point added");
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full h-11 sm:h-10 border border-dashed border-border rounded-xl flex items-center justify-center gap-1.5 text-xs font-semibold hover:border-primary/50 text-muted-foreground hover:text-primary transition"
      >
        <Plus className="w-3.5 h-3.5" /> Add Specification Point
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl bg-secondary/40 border border-border p-4 space-y-3"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        New Spec Point
      </p>
      <div className="grid grid-cols-1 md:grid-cols-[100px,1fr] gap-3">
        <div>
          <label className="text-[10px] uppercase text-muted-foreground">Code</label>
          <input
            required
            className={inputCls}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="4.1.1"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase text-muted-foreground">Title</label>
          <input
            required
            className={inputCls}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Structure of organelles"
          />
        </div>
      </div>
      <div>
        <label className="text-[10px] uppercase text-muted-foreground">Description</label>
        <textarea
          className="w-full min-h-16 rounded-md bg-secondary border border-border px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Syllabus specification requirements detail"
        />
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
          Add Point
        </button>
      </div>
    </form>
  );
}
