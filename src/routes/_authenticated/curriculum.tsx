import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRole";
import { SUBJECTS, BOARDS, LEVELS, type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { generateMcqSet } from "@/lib/mcq.functions";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Sparkles,
  ChevronRight,
  BookMarked,
  PlayCircle,
  Download,
  ClipboardList,
  CalendarClock,
  ListChecks,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/curriculum")({
  head: () => ({ meta: [{ title: "Curriculum | StudyHub" }] }),
  component: Curriculum,
});

type Topic = {
  id: string;
  code: string | null;
  title: string;
  description: string | null;
  sort_order: number;
};
type SpecPoint = {
  id: string;
  topic_id: string;
  code: string;
  title: string;
  description: string | null;
};
type Resource = {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  video_url: string | null;
  file_path: string | null;
  file_name: string | null;
  starts_at: string | null;
  join_url: string | null;
  due_at: string | null;
};
type McqSet = { id: string; title: string; published: boolean };

const inputCls =
  "w-full h-9 rounded-md bg-secondary border border-border px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";

function Curriculum() {
  const { isTutor } = useRoles();
  const [subject, setSubject] = useState<SubjectV>("biology");
  const [board, setBoard] = useState<BoardV>("edexcel");
  const [level, setLevel] = useState<LevelV>("gcse");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [openTopicId, setOpenTopicId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadTopics = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("topics")
      .select("id, code, title, description, sort_order")
      .eq("subject", subject)
      .eq("board", board)
      .eq("level", level)
      .order("sort_order")
      .order("code");
    setTopics(data ?? []);
    setLoading(false);
  };
  useEffect(() => {
    loadTopics(); /* eslint-disable-next-line */
  }, [subject, board, level]);

  return (
    <AppLayout title="Curriculum">
      <div className="rounded-2xl bg-card border border-border p-5 mb-6">
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
      </div>

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
            />
          ))}
        </div>
      )}
    </AppLayout>
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
    const { error } = await supabase
      .from("topics")
      .insert({ subject, board, level, code: code || null, title, created_by: userId });
    if (error) return toast.error(error.message);
    setCode("");
    setTitle("");
    setOpen(false);
    toast.success("Topic added");
    onCreated();
  };
  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-4 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold"
      >
        <Plus className="w-4 h-4" /> Add topic
      </button>
    );
  return (
    <form
      onSubmit={submit}
      className="mb-4 rounded-xl bg-card border border-border p-4 flex gap-2 items-end"
    >
      <div className="w-24">
        <label className="text-[10px] uppercase text-muted-foreground">Code</label>
        <input
          className={inputCls}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="1"
        />
      </div>
      <div className="flex-1">
        <label className="text-[10px] uppercase text-muted-foreground">Topic title</label>
        <input
          required
          className={inputCls}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Cell biology"
        />
      </div>
      <button className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold">
        Save
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="h-9 px-3 rounded-md border border-border text-sm"
      >
        Cancel
      </button>
    </form>
  );
}

function TopicCard({
  topic,
  open,
  onToggle,
  isTutor,
  onDeleted,
}: {
  topic: Topic;
  open: boolean;
  onToggle: () => void;
  isTutor: boolean;
  onDeleted: () => void;
}) {
  const [points, setPoints] = useState<SpecPoint[]>([]);
  const [activePointId, setActivePointId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    supabase
      .from("spec_points")
      .select("id, topic_id, code, title, description")
      .eq("topic_id", topic.id)
      .order("sort_order")
      .order("code")
      .then(({ data }) => setPoints(data ?? []));
  }, [open, topic.id]);

  const reload = async () => {
    const { data } = await supabase
      .from("spec_points")
      .select("id, topic_id, code, title, description")
      .eq("topic_id", topic.id)
      .order("sort_order")
      .order("code");
    setPoints(data ?? []);
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
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-secondary/40"
      >
        <div className="flex items-center gap-3">
          <ChevronRight className={`w-4 h-4 transition ${open ? "rotate-90" : ""}`} />
          {topic.code && (
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-primary/15 text-primary">
              {topic.code}
            </span>
          )}
          <span className="font-display font-semibold">{topic.title}</span>
        </div>
        {isTutor && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              del();
            }}
            className="text-muted-foreground hover:text-destructive p-1"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </button>
      {open && (
        <div className="border-t border-border p-5 space-y-4">
          {isTutor && <SpecPointCreate topicId={topic.id} onCreated={reload} />}
          {points.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No spec points yet.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[280px,1fr] gap-4">
              <ul className="space-y-1">
                {points.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => setActivePointId(p.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm flex gap-2 ${activePointId === p.id ? "bg-primary/15 border border-primary/30 text-foreground" : "hover:bg-secondary/60 text-muted-foreground"}`}
                    >
                      <span className="font-mono text-xs text-primary shrink-0 mt-0.5">
                        {p.code}
                      </span>
                      <span>{p.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {activePointId && (
                <SpecPointDetail
                  point={points.find((p) => p.id === activePointId)!}
                  isTutor={isTutor}
                  onChanged={reload}
                />
              )}
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
    onCreated();
    toast.success("Spec point added");
  };
  return (
    <form
      onSubmit={submit}
      className="rounded-lg bg-secondary/40 border border-border p-3 grid grid-cols-1 md:grid-cols-[80px,1fr,1fr,auto] gap-2 items-end"
    >
      <div>
        <label className="text-[10px] uppercase text-muted-foreground">Code</label>
        <input
          required
          className={inputCls}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="1.1"
        />
      </div>
      <div>
        <label className="text-[10px] uppercase text-muted-foreground">Title</label>
        <input
          required
          className={inputCls}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Structure of the cell"
        />
      </div>
      <div>
        <label className="text-[10px] uppercase text-muted-foreground">Description</label>
        <input
          className={inputCls}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional"
        />
      </div>
      <button className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold">
        Add point
      </button>
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
  const genFn = useServerFn(generateMcqSet);

  const reload = async () => {
    const [r, m] = await Promise.all([
      supabase
        .from("resources")
        .select(
          "id, kind, title, description, video_url, file_path, file_name, starts_at, join_url, due_at",
        )
        .eq("spec_point_id", point.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("mcq_sets")
        .select("id, title, published")
        .eq("spec_point_id", point.id)
        .order("created_at", { ascending: false }),
    ]);
    setResources(r.data ?? []);
    setMcqSets(m.data ?? []);
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
    <div className="space-y-4">
      <div className="rounded-xl bg-secondary/40 border border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-primary font-semibold">
              Spec point {point.code}
            </p>
            <h3 className="font-display text-lg font-semibold mt-0.5">{point.title}</h3>
            {point.description && (
              <p className="text-sm text-muted-foreground mt-1">{point.description}</p>
            )}
          </div>
        </div>
        {isTutor && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={generate}
              disabled={genLoading}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-accent/20 border border-accent/40 text-accent-foreground text-xs font-semibold hover:bg-accent/30 disabled:opacity-60"
            >
              <Sparkles className="w-3.5 h-3.5" /> {genLoading ? "Generating…" : "AI generate MCQs"}
            </button>
            <Link
              to="/tutor"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-xs"
            >
              <Plus className="w-3.5 h-3.5" /> Add resource in Tutor Studio
            </Link>
          </div>
        )}
      </div>

      <Section title="MCQ Sets" icon={ListChecks}>
        {mcqSets.length === 0 ? (
          <Empty label="No MCQ sets yet." />
        ) : (
          <ul className="space-y-2">
            {mcqSets.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between px-3 py-2 rounded-lg bg-secondary/40 border border-border"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded ${s.published ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}
                  >
                    {s.published ? "Published" : "Draft"}
                  </span>
                  <span className="text-sm">{s.title}</span>
                </div>
                <div className="flex items-center gap-2">
                  {(s.published || isTutor) && (
                    <Link
                      to="/mcq/$setId"
                      params={{ setId: s.id }}
                      className="text-xs px-2 py-1 rounded border border-border hover:border-primary/50"
                    >
                      Take
                    </Link>
                  )}
                  {isTutor && (
                    <>
                      <button
                        onClick={() => publish(s.id, s.published)}
                        className="text-xs px-2 py-1 rounded border border-border"
                      >
                        {s.published ? "Unpublish" : "Publish"}
                      </button>
                      <button
                        onClick={() => delSet(s.id)}
                        className="text-muted-foreground hover:text-destructive"
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
      </Section>

      <ResourceGroup
        label="Videos"
        icon={PlayCircle}
        items={resources.filter((r) => r.kind === "video")}
        render={(r) => (
          <a
            href={r.video_url ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="text-sm hover:text-primary"
          >
            {r.title}
          </a>
        )}
      />
      <ResourceGroup
        label="Live Sessions"
        icon={CalendarClock}
        items={resources.filter((r) => r.kind === "live_session")}
        render={(r) => (
          <div className="flex items-center gap-2 text-sm">
            <span>{r.title}</span>
            {r.starts_at && (
              <span className="text-xs text-muted-foreground">
                — {new Date(r.starts_at).toLocaleString()}
              </span>
            )}
            {r.join_url && (
              <a
                href={r.join_url}
                target="_blank"
                rel="noreferrer"
                className="ml-auto text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground"
              >
                Join
              </a>
            )}
          </div>
        )}
      />
      <ResourceGroup
        label="Homework"
        icon={ClipboardList}
        items={resources.filter((r) => r.kind === "homework")}
        render={(r) => (
          <span className="text-sm">
            {r.title}
            {r.due_at && (
              <span className="text-xs text-muted-foreground ml-2">
                due {new Date(r.due_at).toLocaleDateString()}
              </span>
            )}
          </span>
        )}
      />
      <ResourceGroup
        label="Downloads"
        icon={Download}
        items={resources.filter((r) => r.kind === "download")}
        render={(r) => <DownloadRow file_path={r.file_path} title={r.title} name={r.file_name} />}
      />
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-card border border-border p-4">
      <div className="flex items-center gap-2 mb-2 text-sm font-semibold">
        <Icon className="w-4 h-4 text-primary" />
        {title}
      </div>
      {children}
    </div>
  );
}

function ResourceGroup<T extends { id: string }>({
  label,
  icon,
  items,
  render,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: T[];
  render: (r: T) => React.ReactNode;
}) {
  return (
    <Section title={label} icon={icon}>
      {items.length === 0 ? (
        <Empty label={`No ${label.toLowerCase()} yet.`} />
      ) : (
        <ul className="space-y-1.5">
          {items.map((r) => (
            <li key={r.id} className="px-3 py-2 rounded-lg bg-secondary/40 border border-border">
              {render(r)}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="text-xs italic text-muted-foreground">{label}</p>;
}

function DownloadRow({
  file_path,
  title,
  name,
}: {
  file_path: string | null;
  title: string;
  name: string | null;
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
    <a
      href={url ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="text-sm hover:text-primary flex items-center gap-2"
    >
      <Download className="w-3.5 h-3.5" /> {title}{" "}
      {name && <span className="text-xs text-muted-foreground">({name})</span>}
    </a>
  );
}
