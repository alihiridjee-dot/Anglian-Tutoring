import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRole";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import { generateMcqSet } from "@/lib/mcq/mcq.functions";
import { toast } from "sonner";
import { CurriculumDAL } from "@/lib/curriculum/curriculumDal";
import type { SpecPoint, Resource, McqSet } from "@/lib/curriculum/types";
import { VideoModal, VideoThumbnail } from "@/components/VideoPlayer";
import { isDemoStudent } from "@/lib/demo/studentDemo";
import { parseVideoUrl, type VideoEmbed } from "@/lib/curriculum/videoEmbed";
import { SpecPointVideoEditor, type EditableVideo } from "@/components/tutor/SpecPointVideoEditor";
import {
  Plus,
  Pencil,
  Trash2,
  Sparkles,
  PlayCircle,
  ClipboardList,
  CalendarClock,
  ListChecks,
} from "lucide-react";
import {
  CollapsibleSection,
  CollapsibleResourceGroup,
  Empty,
} from "@/components/curriculum/Collapsible";

export function SpecPointDetail({
  point,
  isTutor,
  onChanged,
  taxonomy,
}: {
  point: SpecPoint;
  isTutor: boolean;
  onChanged: () => void;
  taxonomy: { subject: SubjectV; board: BoardV; level: LevelV };
}) {
  const { userId } = useRoles();
  const [resources, setResources] = useState<Resource[]>([]);
  const [mcqSets, setMcqSets] = useState<McqSet[]>([]);
  const [genLoading, setGenLoading] = useState(false);
  // `null` inside the object means "creating"; the outer null means closed.
  const [editingVideo, setEditingVideo] = useState<{ video: EditableVideo | null } | null>(null);
  const [activeVideo, setActiveVideo] = useState<{
    embed: VideoEmbed;
    title: string;
    description?: string | null;
  } | null>(null);
  const genFn = useServerFn(generateMcqSet);

  const reload = async () => {
    try {
      const { resources: resList, mcqSets: mList } =
        await CurriculumDAL.getResourcesAndMcqSets(point);
      setResources(resList);
      setMcqSets(mList);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    reload(); /* eslint-disable-next-line */
  }, [point.id]);

  const generate = async () => {
    setGenLoading(true);
    try {
      const res = await genFn({ data: { specPointId: point.id } });
      toast.success(
        res.created
          ? "Generated this point's MCQs — every student now shares them"
          : "This point already has its MCQs — nothing new was generated",
      );
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenLoading(false);
    }
  };

  const publish = async (setId: string, published: boolean) => {
    const { error } = await supabase
      .from("mcq_sets")
      .update({ published: !published })
      .eq("id", setId);
    if (error) return toast.error(error.message);
    reload();
  };

  const delSet = async (setId: string) => {
    if (!confirm("Delete this MCQ set?")) return;
    const { error } = await supabase.from("mcq_sets").delete().eq("id", setId);
    if (error) return toast.error(error.message);
    reload();
  };

  return (
    <div className="space-y-6">
      {isTutor && (
        <div className="rounded-xl bg-secondary/40 border border-border p-4 flex flex-wrap gap-2">
          <button
            onClick={generate}
            disabled={genLoading}
            className="inline-flex items-center gap-2 px-3 py-1.5 min-h-11 sm:min-h-0 rounded-md bg-accent/20 border border-accent/40 text-accent-foreground text-xs font-semibold hover:bg-accent/30 disabled:opacity-60"
          >
            <Sparkles className="w-3.5 h-3.5" /> {genLoading ? "Generating…" : "AI generate MCQs"}
          </button>
          <button
            onClick={() => setEditingVideo({ video: null })}
            className="inline-flex items-center gap-2 px-3 py-1.5 min-h-11 sm:min-h-0 rounded-md border border-border text-xs text-foreground font-semibold hover:bg-secondary/40 transition"
          >
            <PlayCircle className="w-3.5 h-3.5" /> Add video to this point
          </button>
          <Link
            to="/tutor"
            className="inline-flex items-center gap-2 px-3 py-1.5 min-h-11 sm:min-h-0 rounded-md border border-border text-xs text-foreground font-semibold hover:bg-secondary/40 transition"
          >
            <Plus className="w-3.5 h-3.5" /> Add resource in Tutor Studio
          </Link>
        </div>
      )}

      <div data-guide="point-sections" className="space-y-4">
        {/* MCQ Sets Section */}
        <CollapsibleSection
          title="MCQ Sets"
          icon={ListChecks}
          count={mcqSets.length}
          defaultOpen={mcqSets.length > 0}
        >
          {mcqSets.length === 0 ? (
            <Empty label="No MCQ sets yet." />
          ) : (
            <ul className="space-y-2.5">
              {mcqSets.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-3 rounded-xl bg-secondary/10 border border-border"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0 uppercase tracking-wider ${s.published ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}
                    >
                      {s.published ? "Published" : "Draft"}
                    </span>
                    <span className="text-sm font-semibold truncate text-foreground">
                      {s.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(s.published || isTutor) && (
                      <Link
                        to={isDemoStudent() ? "/demo/student/mcq/$setId" : "/mcq/$setId"}
                        params={{ setId: s.id }}
                        className="inline-flex items-center text-xs px-2.5 py-1.5 min-h-11 sm:min-h-0 rounded-lg border border-border bg-background hover:border-primary/50 text-foreground font-medium transition"
                      >
                        Take
                      </Link>
                    )}
                    {isTutor && (
                      <>
                        <button
                          onClick={() => publish(s.id, s.published)}
                          className="inline-flex items-center text-xs px-2.5 py-1.5 min-h-11 sm:min-h-0 rounded-lg border border-border text-muted-foreground hover:text-foreground transition"
                        >
                          {s.published ? "Unpublish" : "Publish"}
                        </button>
                        <button
                          onClick={() => delSet(s.id)}
                          aria-label={`Delete MCQ set ${s.title}`}
                          className="tap-target text-muted-foreground hover:text-destructive p-1 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>

        {/* Syllabus Videos Section */}
        <CollapsibleResourceGroup
          label="Syllabus Videos"
          icon={PlayCircle}
          cards
          items={resources.filter((r) => r.kind === "video")}
          render={(r) => {
            const embed = parseVideoUrl(r.video_url);
            return (
              <div className="relative w-full">
                <button
                  type="button"
                  disabled={!embed}
                  onClick={() =>
                    embed && setActiveVideo({ embed, title: r.title, description: r.description })
                  }
                  className="group text-left rounded-xl premium-card overflow-hidden hover:border-primary/40 transition w-full disabled:opacity-60 disabled:cursor-default"
                >
                  <VideoThumbnail embed={embed} />
                  <div className="p-3">
                    <p className="font-display text-foreground text-sm leading-snug font-bold">
                      {r.title}
                    </p>
                    {r.description && (
                      <p className="text-xs font-normal text-muted-foreground mt-0.5 leading-normal line-clamp-2">
                        {r.description}
                      </p>
                    )}
                  </div>
                </button>
                {isTutor && (
                  <button
                    type="button"
                    onClick={() =>
                      setEditingVideo({
                        video: {
                          id: r.id,
                          title: r.title,
                          description: r.description,
                          video_url: r.video_url,
                        },
                      })
                    }
                    className="tap-target absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-background/90 border border-border text-[10px] font-bold uppercase tracking-wider text-foreground hover:border-primary/50 shadow-xs transition"
                  >
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                )}
              </div>
            );
          }}
        />

        {/* Live Sessions Section */}
        <CollapsibleResourceGroup
          label="Live Sessions"
          icon={CalendarClock}
          items={resources.filter((r) => r.kind === "live_session")}
          render={(r) => (
            <div className="flex flex-col gap-1.5 w-full">
              <div className="flex items-start justify-between gap-2 text-sm font-semibold text-foreground leading-snug">
                <span>{r.title}</span>
                {r.join_url && (
                  <a
                    href={r.join_url}
                    target="_blank"
                    rel="noreferrer"
                    className="tap-target inline-flex items-center shrink-0 text-[10px] px-2 py-0.5 rounded btn-solid font-bold"
                  >
                    Join
                  </a>
                )}
              </div>
              {r.description && (
                <p className="text-xs font-normal text-muted-foreground leading-normal">
                  {r.description}
                </p>
              )}
              {r.starts_at && (
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">
                  Starts: {new Date(r.starts_at).toLocaleString()}
                </span>
              )}
            </div>
          )}
        />

        {/* Homework Assignments Section */}
        <CollapsibleResourceGroup
          label="Homework Assignments"
          icon={ClipboardList}
          items={resources.filter((r) => r.kind === "homework")}
          render={(r) => (
            <div className="flex flex-col gap-1.5 w-full">
              <div className="flex items-start justify-between gap-2 text-sm font-semibold text-foreground leading-snug">
                <span className="font-semibold">{r.title}</span>
                <Link
                  to={
                    isDemoStudent() ? "/demo/student/homework/$homeworkId" : "/homework/$homeworkId"
                  }
                  params={{ homeworkId: r.id }}
                  className="tap-target inline-flex items-center shrink-0 text-[10px] px-2 py-0.5 rounded bg-secondary text-foreground hover:bg-primary hover:text-primary-foreground font-bold transition"
                >
                  Open
                </Link>
              </div>
              {r.description && (
                <p className="text-xs text-muted-foreground leading-normal font-normal">
                  {r.description}
                </p>
              )}
              {r.due_at && (
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">
                  due {new Date(r.due_at).toLocaleDateString()}
                </span>
              )}
            </div>
          )}
        />
      </div>

      {activeVideo && (
        <VideoModal
          embed={activeVideo.embed}
          title={activeVideo.title}
          description={activeVideo.description}
          onClose={() => setActiveVideo(null)}
        />
      )}

      {editingVideo && userId && (
        <SpecPointVideoEditor
          video={editingVideo.video}
          specPointId={point.id}
          taxonomy={taxonomy}
          userId={userId}
          onClose={() => setEditingVideo(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
