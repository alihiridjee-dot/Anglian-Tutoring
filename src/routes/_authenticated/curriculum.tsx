import { createFileRoute, Link } from "@tanstack/react-router";
import { guardStudentSection } from "@/lib/routeGuards";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { motion, AnimatePresence } from "motion/react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRole";
import { useEntitlements, type Entitlements } from "@/lib/entitlements";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { SUBJECTS, BOARDS, LEVELS, type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { generateMcqSet } from "@/lib/mcq.functions";
import { toast } from "sonner";
import {
  CurriculumDAL,
  type Topic,
  type SpecPoint,
  type Resource,
  type McqSet,
} from "@/lib/curriculumDal";
import { CurriculumSyncPanel } from "@/components/CurriculumSyncPanel";
import { VideoModal, VideoThumbnail } from "@/components/VideoPlayer";
import { parseVideoUrl, type VideoEmbed } from "@/lib/videoEmbed";
import {
  Plus,
  Trash2,
  Sparkles,
  ChevronRight,
  ChevronDown,
  BookMarked,
  PlayCircle,
  Download,
  ClipboardList,
  CalendarClock,
  ListChecks,
  ChevronLeft,
  GraduationCap,
  Award,
  BookOpen,
  Lock,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/curriculum")({
  beforeLoad: guardStudentSection,
  head: () => ({ meta: [{ title: "Curriculum | Anglian Learning" }] }),
  component: Curriculum,
});

const inputCls =
  "w-full h-9 rounded-md bg-secondary border border-border px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";

export function Curriculum() {
  const { isTutor } = useRoles();
  // Students are scoped to the subjects (and board/level) their subscription
  // covers; tutors author freely across everything. This is the client half of
  // the guardrail — topics/spec_points RLS enforces the same thing server-side.
  const ent = useEntitlements();
  const { level: profileLevel } = useEnrolments();
  const [subject, setSubject] = useState<SubjectV>("biology");
  const [board, setBoard] = useState<BoardV>("edexcel");
  const [level, setLevel] = useState<LevelV>("gcse");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [openTopicId, setOpenTopicId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Snap a student's filters onto their entitlement: the first subject they're
  // enrolled in, at their board and level. Guards against the "biology/edexcel"
  // defaults exposing a subject they don't pay for.
  useEffect(() => {
    if (isTutor || ent.loading) return;
    if (ent.entitledSubjects.length && !ent.entitledSubjects.includes(subject)) {
      setSubject(ent.entitledSubjects[0]);
    }
    if (profileLevel) setLevel(profileLevel);
  }, [isTutor, ent.loading, ent.entitledSubjects, profileLevel, subject]);

  // A student's board is fixed to the one they sit the selected subject with.
  useEffect(() => {
    if (isTutor) return;
    const b = ent.boardBySubject[subject];
    if (b && b !== board) setBoard(b);
  }, [isTutor, subject, ent.boardBySubject, board]);

  // Selected specification point state to handle full sub-page navigation
  const [selectedSpecPoint, setSelectedSpecPoint] = useState<SpecPoint | null>(null);

  const loadTopics = async () => {
    setLoading(true);
    try {
      const data = await CurriculumDAL.getTopics(level, board, subject);
      setTopics(data);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load curriculum");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTopics(); /* eslint-disable-next-line */
  }, [subject, board, level]);

  // Handle viewing full-page specification point details
  if (selectedSpecPoint) {
    return (
      <AppLayout title="Curriculum Point">
        <div className="max-w-4xl mx-auto space-y-6">
          <button
            onClick={() => setSelectedSpecPoint(null)}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition font-semibold"
          >
            <ChevronLeft className="w-4 h-4" /> Back to Curriculum
          </button>

          <div className="rounded-2xl border border-border bg-card p-6 relative overflow-hidden shadow-xs">
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary to-accent" />

            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-[10px] px-2.5 py-1 rounded-full uppercase tracking-wider font-extrabold bg-primary/10 text-primary">
                {level === "alevel" ? "A-Level" : "GCSE"}
              </span>
              <span className="text-[10px] px-2.5 py-1 rounded-full uppercase tracking-wider font-extrabold bg-accent/10 text-accent">
                {board.toUpperCase()}
              </span>
              <span className="text-[10px] px-2.5 py-1 rounded-full uppercase tracking-wider font-extrabold bg-secondary text-foreground">
                {subject.toUpperCase()}
              </span>
            </div>

            <p className="font-mono text-xs text-primary font-bold">
              Specification Point {selectedSpecPoint.code}
            </p>
            <h2 className="font-display text-2xl font-bold text-foreground mt-1.5 leading-snug">
              {selectedSpecPoint.title}
            </h2>
            {selectedSpecPoint.description && (
              <p className="text-sm text-muted-foreground mt-3 leading-relaxed whitespace-pre-wrap">
                {selectedSpecPoint.description}
              </p>
            )}
          </div>

          <div className="mt-8">
            <SpecPointDetail point={selectedSpecPoint} isTutor={isTutor} onChanged={loadTopics} />
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Curriculum">
      <p className="text-muted-foreground mb-6 max-w-2xl">
        Explore interactive specification points across chemistry, physics, and biology. Select your
        level, exam board, and subject to begin.
      </p>

      <div className="rounded-2xl bg-card border border-border p-5 mb-6">
        {isTutor ? (
          <div className="grid grid-cols-3 gap-3">
            <Filter
              label="Subject"
              value={subject}
              onChange={(v) => setSubject(v as SubjectV)}
              opts={SUBJECTS}
            />
            <Filter
              label="Board"
              value={board}
              onChange={(v) => setBoard(v as BoardV)}
              opts={BOARDS}
            />
            <Filter
              label="Level"
              value={level}
              onChange={(v) => setLevel(v as LevelV)}
              opts={LEVELS}
            />
          </div>
        ) : (
          <StudentSubjectPicker
            subject={subject}
            onSelect={setSubject}
            board={board}
            level={level}
            entitlements={ent}
          />
        )}
      </div>

      {isTutor && (
        <CurriculumSyncPanel subject={subject} board={board} level={level} onSynced={loadTopics} />
      )}

      {isTutor && (
        <TopicCreate subject={subject} board={board} level={level} onCreated={loadTopics} />
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading topics…</p>
      ) : topics.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <BookMarked className="w-8 h-8 mx-auto mb-3 opacity-50" />
          No topics yet for this subject/board/level.
          {isTutor && <p className="mt-2 text-xs">Add one above to get started.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {topics.map((t) => (
            <TopicCard
              key={t.id}
              topic={t}
              open={openTopicId === t.id}
              onToggle={() => setOpenTopicId(openTopicId === t.id ? null : t.id)}
              isTutor={isTutor}
              onDeleted={loadTopics}
              level={level}
              board={board}
              subject={subject}
              onSelectSpecPoint={(p) => setSelectedSpecPoint(p)}
            />
          ))}
        </div>
      )}
    </AppLayout>
  );
}

const labelOf = (list: readonly { value: string; label: string }[], v: string) =>
  list.find((x) => x.value === v)?.label ?? v;

/**
 * The student's subject switcher: entitled subjects are selectable chips; the
 * rest are shown locked and greyed, so a student sees exactly what their plan
 * covers and a clear, low-pressure nudge to add the others. Board and level are
 * fixed to their enrolment (read-only labels) — they don't get to browse other
 * boards. Tutors use the free three-dropdown Filter row instead.
 */
function StudentSubjectPicker({
  subject,
  onSelect,
  board,
  level,
  entitlements,
}: {
  subject: SubjectV;
  onSelect: (s: SubjectV) => void;
  board: BoardV;
  level: LevelV;
  entitlements: Entitlements;
}) {
  const { isEntitled, lockedSubjects } = entitlements;
  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
          Your subjects
        </label>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <GraduationCap className="w-3.5 h-3.5" />
          {labelOf(LEVELS, level)} · {labelOf(BOARDS, board)}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {SUBJECTS.map((s) => {
          const entitled = isEntitled(s.value);
          const active = s.value === subject;
          if (!entitled) {
            return (
              <span
                key={s.value}
                title="Not included in your plan — add it from Billing."
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-dashed border-border bg-muted/40 text-sm font-semibold text-muted-foreground/70 cursor-not-allowed select-none"
              >
                <Lock className="w-3.5 h-3.5" /> {s.label}
              </span>
            );
          }
          return (
            <button
              key={s.value}
              onClick={() => onSelect(s.value)}
              className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border text-sm font-semibold transition ${
                active
                  ? "border-primary bg-primary/10 text-primary ring-2 ring-primary/20"
                  : "border-border hover:bg-muted"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {lockedSubjects.length > 0 && (
        <Link
          to="/billing"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Add {lockedSubjects.map((s) => labelOf(SUBJECTS, s)).join(" & ")} to your plan
        </Link>
      )}
    </div>
  );
}

function Filter<T extends string>({
  label,
  value,
  onChange,
  opts,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  opts: readonly { value: T; label: string }[];
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
        {label}
      </label>
      <select
        className={inputCls + " h-10 mt-1"}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TopicCreate({
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
          className="h-8 px-3 rounded-md text-xs hover:bg-secondary border border-border"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="h-8 px-3 rounded-md text-xs bg-primary text-primary-foreground font-semibold"
        >
          Create
        </button>
      </div>
    </form>
  );
}

function TopicCard({
  topic,
  open,
  onToggle,
  isTutor,
  onDeleted,
  level,
  board,
  subject,
  onSelectSpecPoint,
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
}) {
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
    <div className="rounded-2xl bg-card border border-border overflow-hidden">
      <div className="flex items-center hover:bg-secondary/40">
        <button
          onClick={onToggle}
          className="flex-1 min-w-0 flex items-center gap-3 px-5 py-4 text-left"
        >
          <ChevronRight className={`w-4 h-4 shrink-0 transition ${open ? "rotate-90" : ""}`} />
          {topic.code && (
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-primary/15 text-primary">
              {topic.code}
            </span>
          )}
          <span className="font-display font-semibold truncate">{topic.title}</span>
        </button>
        {isTutor && (
          <button
            onClick={del}
            className="text-muted-foreground hover:text-destructive p-1 mr-4 shrink-0"
            aria-label={`Delete topic ${topic.title}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      {open && (
        <div className="border-t border-border p-5 space-y-4">
          {isTutor && <SpecPointCreate topicId={topic.id} onCreated={reload} />}
          {points.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No spec points yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {points.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onSelectSpecPoint(p)}
                  className="text-left p-4 rounded-xl border border-border bg-secondary/10 hover:border-primary/50 hover:bg-secondary/30 transition flex items-start gap-3 group"
                >
                  <span className="font-mono text-xs text-primary bg-primary/10 px-2 py-0.5 rounded shrink-0 mt-0.5">
                    {p.code}
                  </span>
                  <div>
                    <h4 className="font-semibold text-sm text-foreground leading-tight group-hover:text-primary transition">
                      {p.title}
                    </h4>
                    {p.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-normal">
                        {p.description}
                      </p>
                    )}
                  </div>
                </button>
              ))}
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
        className="w-full h-10 border border-dashed border-border rounded-xl flex items-center justify-center gap-1.5 text-xs font-semibold hover:border-primary/50 text-muted-foreground hover:text-primary transition"
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
          className="h-8 px-3 rounded-md text-xs hover:bg-secondary border border-border"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="h-8 px-3 rounded-md text-xs bg-primary text-primary-foreground font-semibold"
        >
          Add Point
        </button>
      </div>
    </form>
  );
}

function SpecPointDetail({
  point,
  isTutor,
  onChanged,
}: {
  point: SpecPoint;
  isTutor: boolean;
  onChanged: () => void;
}) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [mcqSets, setMcqSets] = useState<McqSet[]>([]);
  const [genLoading, setGenLoading] = useState(false);
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
      const res = await genFn({
        data: {
          specPointId: point.id,
          title: point.title,
          context: point.description || "",
          count: 6,
        },
      });
      toast.success(`Generated ${res.count} questions — review & publish`);
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
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-accent/20 border border-accent/40 text-accent-foreground text-xs font-semibold hover:bg-accent/30 disabled:opacity-60"
          >
            <Sparkles className="w-3.5 h-3.5" /> {genLoading ? "Generating…" : "AI generate MCQs"}
          </button>
          <Link
            to="/tutor"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-xs text-foreground font-semibold hover:bg-secondary/40 transition"
          >
            <Plus className="w-3.5 h-3.5" /> Add resource in Tutor Studio
          </Link>
        </div>
      )}

      <div className="space-y-4">
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
                  className="flex items-center justify-between px-3.5 py-3 rounded-xl bg-secondary/10 border border-border"
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
                        to="/mcq/$setId"
                        params={{ setId: s.id }}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-border bg-background hover:border-primary/50 text-foreground font-medium transition"
                      >
                        Take
                      </Link>
                    )}
                    {isTutor && (
                      <>
                        <button
                          onClick={() => publish(s.id, s.published)}
                          className="text-xs px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition"
                        >
                          {s.published ? "Unpublish" : "Publish"}
                        </button>
                        <button
                          onClick={() => delSet(s.id)}
                          className="text-muted-foreground hover:text-destructive p-1 transition"
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
              <button
                type="button"
                disabled={!embed}
                onClick={() =>
                  embed && setActiveVideo({ embed, title: r.title, description: r.description })
                }
                className="group text-left rounded-xl bg-card border border-border overflow-hidden hover:border-primary/40 transition w-full disabled:opacity-60 disabled:cursor-default"
              >
                <VideoThumbnail embed={embed} />
                <div className="p-3">
                  <p className="text-sm font-semibold text-foreground leading-snug">{r.title}</p>
                  {r.description && (
                    <p className="text-xs font-normal text-muted-foreground mt-0.5 leading-normal line-clamp-2">
                      {r.description}
                    </p>
                  )}
                </div>
              </button>
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
                    className="text-[10px] px-2 py-0.5 rounded bg-primary text-primary-foreground font-bold"
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
                  to="/homework"
                  className="text-[10px] px-2 py-0.5 rounded bg-secondary text-foreground hover:bg-primary hover:text-primary-foreground font-bold transition"
                >
                  View Desk
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

        {/* Revision Downloads Section */}
        <CollapsibleResourceGroup
          label="Revision Downloads"
          icon={Download}
          items={resources.filter((r) => r.kind === "download")}
          render={(r) => (
            <DownloadRow
              file_path={r.file_path}
              title={r.title}
              name={r.file_name}
              description={r.description}
            />
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
    </div>
  );
}

function CollapsibleSection({
  title,
  icon: Icon,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="rounded-2xl bg-card border border-border overflow-hidden transition-all duration-200">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-secondary/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10 text-primary">
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display font-bold text-sm text-foreground leading-none">{title}</h3>
            <p className="text-[11px] text-muted-foreground mt-1">
              {count} {count === 1 ? "item" : "items"} available
            </p>
          </div>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180 text-primary" : ""}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden border-t border-border bg-muted/20"
          >
            <div className="p-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CollapsibleResourceGroup<T extends { id: string }>({
  label,
  icon,
  items,
  render,
  cards = false,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: T[];
  render: (r: T) => React.ReactNode;
  /** Render items as bare cards in a grid instead of padded list rows. */
  cards?: boolean;
}) {
  return (
    <CollapsibleSection
      title={label}
      icon={icon}
      count={items.length}
      defaultOpen={items.length > 0}
    >
      {items.length === 0 ? (
        <Empty label={`No ${label.toLowerCase()} yet.`} />
      ) : cards ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((r) => (
            <li key={r.id}>{render(r)}</li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-2.5">
          {items.map((r) => (
            <li
              key={r.id}
              className="p-3.5 rounded-xl bg-secondary/10 border border-border flex flex-col items-start hover:border-primary/20 transition-all"
            >
              {render(r)}
            </li>
          ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="text-xs italic text-muted-foreground">{label}</p>;
}

function DownloadRow({
  file_path,
  title,
  name,
  description,
}: {
  file_path: string | null;
  title: string;
  name: string | null;
  description?: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file_path) return;
    supabase.storage
      .from("resources")
      .createSignedUrl(file_path, 3600)
      .then(({ data }) => setUrl(data?.signedUrl ?? null));
  }, [file_path]);

  return (
    <div className="w-full">
      <a
        href={url ?? "#"}
        target="_blank"
        rel="noreferrer"
        className="text-sm font-semibold text-foreground hover:text-primary flex items-center gap-2 leading-tight"
      >
        <Download className="w-4 h-4 text-primary shrink-0" />
        <div>
          <span>{title}</span>
          {name && (
            <span className="text-xs font-normal text-muted-foreground ml-1.5">({name})</span>
          )}
        </div>
      </a>
      {description && (
        <p className="text-xs text-muted-foreground font-normal leading-normal mt-1 pl-6">
          {description}
        </p>
      )}
    </div>
  );
}
