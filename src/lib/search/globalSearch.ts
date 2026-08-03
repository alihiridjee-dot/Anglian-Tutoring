import {
  LayoutDashboard,
  BookMarked,
  Layers,
  ClipboardList,
  CalendarClock,
  PlayCircle,
  Download,
  ListChecks,
  Users,
  CreditCard,
  Settings,
  UserRound,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { buildAuthedNav } from "@/lib/nav";
import { SUBJECTS, BOARDS, LEVELS, type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import {
  DEMO_CURRICULUM_TOPICS,
  DEMO_CURRICULUM_SPEC_POINTS,
  DEMO_HOMEWORK,
  DEMO_LIVE,
  DEMO_VIDEOS,
  DEMO_DOWNLOADS,
  DEMO_MCQ_SETS,
} from "@/lib/demo/studentDemo";
import {
  queryTerms,
  scoreRecord,
  matchesAllTerms,
  ilikeValue,
  ilikePattern,
  broadestTerm,
  MIN_QUERY_LENGTH,
} from "./match";
import {
  GROUP_LABEL,
  SEARCH_GROUPS,
  type SearchContext,
  type SearchGroup,
  type SearchHit,
} from "./types";

/**
 * The global search: one query answered across every surface the caller can
 * reach — pages, the specification, homework, live sessions, videos, downloads,
 * quizzes, and (for a tutor) students.
 *
 * Two independent layers keep results honest. RLS decides what the database
 * will hand back at all, and {@link isVisible} narrows what survives to the
 * subjects, board and level the caller actually sits — so a student never sees
 * a hit they'd be bounced from, and never sees one from a locked subject.
 *
 * The showcase under /demo/* has no session, so it searches the same fixtures
 * its pages render, and links to the /demo/* mounts of those pages.
 */

/** Rows pulled per table before ranking. Generous — ranking does the real work. */
const FETCH_LIMIT = 120;
/** Hits kept per group once ranked, so no one group can crowd out the rest. */
const PER_GROUP_LIMIT = 5;

const labelOf = (list: readonly { value: string; label: string }[], v: string | null | undefined) =>
  list.find((x) => x.value === v)?.label ?? v ?? "";

/** "Biology · AQA · GCSE" — the chips that tell a hit apart from its neighbours. */
function taxonomyTags(row: {
  subject?: string | null;
  board?: string | null;
  level?: string | null;
}): string[] {
  return [
    labelOf(SUBJECTS, row.subject),
    labelOf(BOARDS, row.board),
    labelOf(LEVELS, row.level),
  ].filter(Boolean);
}

/**
 * Is this row worth showing to the caller?
 *
 * Tutors author across everything, so nothing is filtered. For a student the
 * rule is the one the curriculum page already enforces: their entitled
 * subjects, at their level, on the board they sit *that* subject with. A null
 * board means board-agnostic (live sessions span boards) and always passes.
 */
function isVisible(
  ctx: SearchContext,
  row: { subject?: string | null; board?: string | null; level?: string | null },
): boolean {
  if (ctx.isTutor) return true;
  if (row.subject && !ctx.entitledSubjects.includes(row.subject as SubjectV)) return false;
  if (row.level && ctx.level && row.level !== ctx.level) return false;
  if (row.board && row.subject) {
    const sat = ctx.boardBySubject[row.subject];
    if (sat && row.board !== sat) return false;
  }
  return true;
}

/** Where a spec point or topic opens: the curriculum page, pre-filtered to it. */
export function curriculumTarget(
  opts: {
    subject?: string | null;
    board?: string | null;
    level?: string | null;
    pointId?: string;
    topicId?: string;
  },
  isDemo: boolean,
) {
  const search: Record<string, string> = {};
  if (opts.subject) search.subject = opts.subject;
  if (opts.board) search.board = opts.board;
  if (opts.level) search.level = opts.level;
  if (opts.pointId) search.point = opts.pointId;
  if (opts.topicId) search.topic = opts.topicId;
  return { to: isDemo ? "/demo/student/curriculum" : "/curriculum", search };
}

interface PageEntry {
  to: string;
  label: string;
  icon: SearchHit["icon"];
}

/** Nav destinations, matched on their own labels so "bill" finds Billing. */
function pageHits(ctx: SearchContext, terms: string[]): SearchHit[] {
  const nav: PageEntry[] = ctx.isDemo
    ? ctx.demoRole === "parent"
      ? [{ to: "/demo/parent/dashboard", label: "Parent Portal", icon: LayoutDashboard }]
      : [
          { to: "/demo/student/dashboard", label: "Dashboard", icon: LayoutDashboard },
          { to: "/demo/student/curriculum", label: "Curriculum", icon: BookMarked },
          { to: "/demo/student/homework", label: "Homework & Grades", icon: ClipboardList },
          { to: "/demo/student/live", label: "Live Sessions", icon: CalendarClock },
          { to: "/demo/student/mcqs", label: "MCQs", icon: ListChecks },
          { to: "/demo/student/videos", label: "Videos", icon: PlayCircle },
          { to: "/demo/student/downloads", label: "Downloads", icon: Download },
        ]
    : [
        ...buildAuthedNav({ isTutor: ctx.isTutor, role: ctx.role }),
        // Real pages that aren't in the sidebar — the palette is the fastest
        // way to reach them, which is half the point of having one.
        ...(ctx.role === "parent"
          ? []
          : [
              { to: "/videos", label: "Videos", icon: PlayCircle },
              { to: "/downloads", label: "Downloads", icon: Download },
            ]),
        { to: "/billing", label: "Billing", icon: CreditCard },
        { to: "/profile", label: "Profile", icon: UserRound },
        { to: "/settings", label: "Settings", icon: Settings },
      ];

  // A parent's sidebar already carries /billing; without this it would appear twice.
  const seen = new Set<string>();
  const unique = nav.filter((item) => {
    if (seen.has(item.to)) return false;
    seen.add(item.to);
    return true;
  });

  return unique
    .map((item) => ({
      key: `page:${item.to}`,
      group: "page" as const,
      title: item.label,
      subtitle: item.to,
      icon: item.icon,
      to: item.to,
      score: scoreRecord([{ text: item.label, weight: 1 }], terms),
    }))
    .filter((h) => h.score > 0);
}

const RESOURCE_ICON: Record<string, SearchHit["icon"]> = {
  homework: ClipboardList,
  live_session: CalendarClock,
  video: PlayCircle,
  download: Download,
};

const RESOURCE_ROUTE: Record<string, (isDemo: boolean) => string> = {
  homework: (d) => (d ? "/demo/student/homework" : "/homework"),
  live_session: (d) => (d ? "/demo/student/live" : "/live"),
  video: (d) => (d ? "/demo/student/videos" : "/videos"),
  download: (d) => (d ? "/demo/student/downloads" : "/downloads"),
};

/**
 * The second line under a spec point hit.
 *
 * Normally the topic it sits under — that's the context a searcher is missing.
 * But when the query matched only the description, showing the topic would
 * leave a row with no visible reason for being there, so the description takes
 * over and the highlight lands somewhere the eye can find it.
 */
function specPointSubtitle(
  point: { code: string; title: string; description: string | null },
  topic: { code: string | null; title: string },
  terms: string[],
): string {
  const topicLine = topic.code ? `${topic.code} · ${topic.title}` : topic.title;
  const visible = `${point.code} ${point.title} ${topicLine}`;
  if (point.description && !matchesAllTerms(visible, terms)) return point.description;
  return topicLine;
}

/** The most useful second line per kind: when it happens, or what it is. */
function resourceSubtitle(row: {
  kind: string;
  description: string | null;
  starts_at?: string | null;
  due_at?: string | null;
  file_name?: string | null;
}): string | null {
  if (row.kind === "live_session" && row.starts_at)
    return `Starts ${new Date(row.starts_at).toLocaleString()}`;
  if (row.kind === "homework" && row.due_at)
    return `Due ${new Date(row.due_at).toLocaleDateString()}`;
  if (row.kind === "download" && row.file_name) return row.file_name;
  return row.description;
}

type SpecPointRow = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  topic_id: string;
  topics: {
    id: string;
    code: string | null;
    title: string;
    subject: string;
    board: string;
    level: string;
  } | null;
};

/** Runs the live (authenticated) half of the search. */
async function searchLive(ctx: SearchContext, terms: string[]): Promise<SearchHit[]> {
  const value = ilikeValue(broadestTerm(terms));
  const pattern = ilikePattern(broadestTerm(terms));
  if (!value) return [];

  const subjects = ctx.entitledSubjects;
  // A student with no enrolment yet has nothing to scope to; skip the content
  // queries rather than sending an empty `in()` that matches nothing anyway.
  const scopedOut = !ctx.isTutor && subjects.length === 0;

  const specPointsQ = () => {
    let q = supabase
      .from("spec_points")
      .select(
        "id, code, title, description, topic_id, topics!inner(id, code, title, subject, board, level)",
      )
      .or(`code.ilike.${value},title.ilike.${value},description.ilike.${value}`)
      .limit(FETCH_LIMIT);
    if (!ctx.isTutor) {
      q = q.in("topics.subject", subjects);
      if (ctx.level) q = q.eq("topics.level", ctx.level);
    }
    return q;
  };

  const topicsQ = () => {
    let q = supabase
      .from("topics")
      .select("id, code, title, description, subject, board, level")
      .or(`code.ilike.${value},title.ilike.${value},description.ilike.${value}`)
      .limit(FETCH_LIMIT);
    if (!ctx.isTutor) {
      q = q.in("subject", subjects);
      if (ctx.level) q = q.eq("level", ctx.level);
    }
    return q;
  };

  const resourcesQ = () => {
    let q = supabase
      .from("resources")
      .select(
        "id, kind, title, description, instructions, subject, board, level, starts_at, due_at, file_name",
      )
      .or(`title.ilike.${value},description.ilike.${value},instructions.ilike.${value}`)
      .limit(FETCH_LIMIT);
    if (!ctx.isTutor) {
      q = q.in("subject", subjects);
      if (ctx.level) q = q.eq("level", ctx.level);
    }
    return q;
  };

  const mcqSetsQ = () => {
    let q = supabase
      .from("mcq_sets")
      .select("id, title, description, published, subject, spec_point_id")
      .or(`title.ilike.${value},description.ilike.${value}`)
      .limit(FETCH_LIMIT);
    // Drafts are a tutor's working state; a student only ever sees published sets.
    if (!ctx.isTutor) q = q.eq("published", true);
    return q;
  };

  const [specPoints, topics, resources, mcqSets, students] = await Promise.all([
    scopedOut ? null : specPointsQ(),
    scopedOut ? null : topicsQ(),
    scopedOut ? null : resourcesQ(),
    scopedOut ? null : mcqSetsQ(),
    // Only a tutor has a student roster to search; for anyone else this is both
    // useless and, by RLS, empty.
    ctx.isTutor && pattern
      ? supabase
          .from("profiles")
          .select("id, display_name, role, level, school")
          .eq("role", "student")
          .ilike("display_name", pattern)
          .limit(FETCH_LIMIT)
      : null,
  ]);

  const hits: SearchHit[] = [];

  for (const row of (specPoints?.data ?? []) as unknown as SpecPointRow[]) {
    const topic = row.topics;
    if (!topic || !isVisible(ctx, topic)) continue;
    const score = scoreRecord(
      [
        { text: row.code, weight: 1.4 },
        { text: row.title, weight: 1 },
        { text: row.description, weight: 0.3 },
        { text: topic.title, weight: 0.2 },
      ],
      terms,
    );
    if (!score) continue;
    hits.push({
      key: `spec_point:${row.id}`,
      group: "spec_point",
      title: row.title,
      code: row.code,
      subtitle: specPointSubtitle(row, topic, terms),
      tags: taxonomyTags(topic),
      icon: BookMarked,
      score,
      ...curriculumTarget(
        { subject: topic.subject, board: topic.board, level: topic.level, pointId: row.id },
        ctx.isDemo,
      ),
    });
  }

  for (const row of topics?.data ?? []) {
    if (!isVisible(ctx, row)) continue;
    const score = scoreRecord(
      [
        { text: row.code, weight: 1.4 },
        { text: row.title, weight: 1 },
        { text: row.description, weight: 0.3 },
      ],
      terms,
    );
    if (!score) continue;
    hits.push({
      key: `topic:${row.id}`,
      group: "topic",
      title: row.title,
      code: row.code,
      subtitle: row.description,
      tags: taxonomyTags(row),
      icon: Layers,
      score,
      ...curriculumTarget(
        { subject: row.subject, board: row.board, level: row.level, topicId: row.id },
        ctx.isDemo,
      ),
    });
  }

  for (const row of resources?.data ?? []) {
    if (!isVisible(ctx, row)) continue;
    const score = scoreRecord(
      [
        { text: row.title, weight: 1 },
        { text: row.description, weight: 0.3 },
        { text: row.instructions, weight: 0.2 },
      ],
      terms,
    );
    if (!score) continue;
    const kind = row.kind as "homework" | "live_session" | "video" | "download";
    hits.push({
      key: `${kind}:${row.id}`,
      group: kind,
      title: row.title,
      subtitle: resourceSubtitle(row),
      tags: taxonomyTags(row),
      icon: RESOURCE_ICON[kind] ?? ClipboardList,
      score,
      to: RESOURCE_ROUTE[kind](ctx.isDemo),
    });
  }

  for (const row of mcqSets?.data ?? []) {
    if (!isVisible(ctx, { subject: row.subject })) continue;
    const score = scoreRecord(
      [
        { text: row.title, weight: 1 },
        { text: row.description, weight: 0.3 },
      ],
      terms,
    );
    if (!score) continue;
    hits.push({
      key: `mcq_set:${row.id}`,
      group: "mcq_set",
      title: row.title,
      subtitle: row.published ? "Published quiz" : "Draft — not visible to students",
      tags: taxonomyTags({ subject: row.subject }),
      icon: ListChecks,
      score,
      to: "/mcq/$setId",
      params: { setId: row.id },
    });
  }

  for (const row of students?.data ?? []) {
    const score = scoreRecord([{ text: row.display_name, weight: 1 }], terms);
    if (!score || !row.display_name) continue;
    hits.push({
      key: `student:${row.id}`,
      group: "student",
      title: row.display_name,
      subtitle: row.school,
      tags: [labelOf(LEVELS, row.level)].filter(Boolean),
      icon: Users,
      score,
      to: "/students",
    });
  }

  return hits;
}

/**
 * The showcase half: the same fixtures the /demo/* pages render.
 *
 * Without this the palette would be visibly dead on the marketing demo, since
 * there is no session behind it for a Supabase read to use.
 */
function searchDemo(ctx: SearchContext, terms: string[]): SearchHit[] {
  // The parent showcase is a single page; there is no content to search.
  if (ctx.demoRole === "parent") return [];

  const hits: SearchHit[] = [];

  for (const [subject, topics] of Object.entries(DEMO_CURRICULUM_TOPICS)) {
    for (const topic of topics) {
      const topicScore = scoreRecord(
        [
          { text: topic.code, weight: 1.4 },
          { text: topic.title, weight: 1 },
          { text: topic.description, weight: 0.3 },
        ],
        terms,
      );
      if (topicScore) {
        hits.push({
          key: `topic:${topic.id}`,
          group: "topic",
          title: topic.title,
          code: topic.code,
          subtitle: topic.description,
          tags: taxonomyTags({ subject }),
          icon: Layers,
          score: topicScore,
          ...curriculumTarget({ subject, topicId: topic.id }, true),
        });
      }

      for (const point of DEMO_CURRICULUM_SPEC_POINTS[topic.id] ?? []) {
        const score = scoreRecord(
          [
            { text: point.code, weight: 1.4 },
            { text: point.title, weight: 1 },
            { text: point.description, weight: 0.3 },
            { text: topic.title, weight: 0.2 },
          ],
          terms,
        );
        if (!score) continue;
        hits.push({
          key: `spec_point:${point.id}`,
          group: "spec_point",
          title: point.title,
          code: point.code,
          subtitle: specPointSubtitle(point, topic, terms),
          tags: taxonomyTags({ subject }),
          icon: BookMarked,
          score,
          ...curriculumTarget({ subject, pointId: point.id }, true),
        });
      }
    }
  }

  for (const hw of DEMO_HOMEWORK) {
    const score = scoreRecord(
      [
        { text: hw.title, weight: 1 },
        { text: hw.instructions, weight: 0.3 },
      ],
      terms,
    );
    if (score)
      hits.push({
        key: `homework:${hw.id}`,
        group: "homework",
        title: hw.title,
        subtitle: hw.due_at ? `Due ${new Date(hw.due_at).toLocaleDateString()}` : hw.instructions,
        tags: taxonomyTags({ subject: hw.subject }),
        icon: ClipboardList,
        score,
        to: "/demo/student/homework",
      });
  }

  for (const s of DEMO_LIVE) {
    const score = scoreRecord(
      [
        { text: s.title, weight: 1 },
        { text: s.description, weight: 0.3 },
      ],
      terms,
    );
    if (score)
      hits.push({
        key: `live_session:${s.id}`,
        group: "live_session",
        title: s.title,
        subtitle: `Starts ${new Date(s.starts_at).toLocaleString()}`,
        tags: taxonomyTags(s),
        icon: CalendarClock,
        score,
        to: "/demo/student/live",
      });
  }

  for (const v of DEMO_VIDEOS) {
    const score = scoreRecord(
      [
        { text: v.title, weight: 1 },
        { text: v.description, weight: 0.3 },
      ],
      terms,
    );
    if (score)
      hits.push({
        key: `video:${v.id}`,
        group: "video",
        title: v.title,
        subtitle: v.description,
        tags: taxonomyTags(v),
        icon: PlayCircle,
        score,
        to: "/demo/student/videos",
      });
  }

  for (const d of DEMO_DOWNLOADS) {
    const score = scoreRecord([{ text: d.title, weight: 1 }], terms);
    if (score)
      hits.push({
        key: `download:${d.id}`,
        group: "download",
        title: d.title,
        subtitle: d.file_name,
        tags: taxonomyTags(d),
        icon: Download,
        score,
        to: "/demo/student/downloads",
      });
  }

  for (const m of DEMO_MCQ_SETS) {
    const score = scoreRecord(
      [
        { text: m.title, weight: 1 },
        { text: m.topic, weight: 0.4 },
        { text: m.specPoint, weight: 0.4 },
      ],
      terms,
    );
    if (score)
      hits.push({
        key: `mcq_set:${m.id}`,
        group: "mcq_set",
        title: m.title,
        subtitle: m.specPoint,
        tags: taxonomyTags(m),
        icon: ListChecks,
        score,
        to: "/demo/student/mcq/$setId",
        params: { setId: m.id },
      });
  }

  return hits;
}

/** A ranked group of hits, ready to render as one section of the palette. */
export interface SearchSection {
  group: SearchGroup;
  label: string;
  hits: SearchHit[];
  /** How many matched before the per-group cap, for a "+N more" note. */
  total: number;
}

/**
 * Answers one query. Returns sections in {@link SEARCH_GROUPS} order, each
 * ranked internally and capped, so a specification with a thousand matching
 * points can't bury the one homework the user was actually after.
 */
export async function runGlobalSearch(query: string, ctx: SearchContext): Promise<SearchSection[]> {
  const terms = queryTerms(query);
  if (query.trim().length < MIN_QUERY_LENGTH || terms.length === 0) return [];

  const hits = [
    ...pageHits(ctx, terms),
    ...(ctx.isDemo ? searchDemo(ctx, terms) : await searchLive(ctx, terms)),
  ];

  const byGroup = new Map<SearchGroup, SearchHit[]>();
  for (const hit of hits) {
    const list = byGroup.get(hit.group);
    if (list) list.push(hit);
    else byGroup.set(hit.group, [hit]);
  }

  const sections: SearchSection[] = [];
  for (const group of SEARCH_GROUPS) {
    const list = byGroup.get(group);
    if (!list?.length) continue;
    // Equal relevance falls back to the spec code where there is one, so tied
    // points read in specification order (4.1.1, 4.1.2) rather than alphabetically.
    list.sort(
      (a, b) =>
        b.score - a.score ||
        (a.code ?? a.title).localeCompare(b.code ?? b.title, undefined, {
          numeric: true,
        }),
    );
    sections.push({
      group,
      label: GROUP_LABEL[group],
      hits: list.slice(0, PER_GROUP_LIMIT),
      total: list.length,
    });
  }
  return sections;
}
