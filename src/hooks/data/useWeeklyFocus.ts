import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isDemoStudent, DEMO_VIDEOS } from "@/lib/demo/studentDemo";
import type { SubjectV, BoardV, LevelV } from "@/lib/taxonomy";

export interface WeeklyFocusPoint {
  id: string;
  code: string;
  title: string;
  topicLabel: string;
}

export interface WeeklyFocusPlan {
  id: string;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  note: string | null;
  /** AI-generated student focus summary, produced once when the tutor saves. */
  summary: string | null;
  points: WeeklyFocusPoint[];
}

// Shape returned by the nested select below.
type RawRow = {
  id: string;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  note: string | null;
  ai_summary: string | null;
  weekly_focus_points: Array<{
    spec_points: {
      id: string;
      code: string;
      title: string;
      sort_order: number | null;
      topics: { code: string | null; title: string; sort_order: number | null } | null;
    } | null;
  }> | null;
};

function shape(rows: RawRow[]): WeeklyFocusPlan[] {
  return rows
    .map((r) => {
      const points = (r.weekly_focus_points ?? [])
        .map((wp) => wp.spec_points)
        .filter((sp): sp is NonNullable<typeof sp> => !!sp)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.code.localeCompare(b.code))
        .map((sp) => ({
          id: sp.id,
          code: sp.code,
          title: sp.title,
          topicLabel: sp.topics
            ? sp.topics.code
              ? `${sp.topics.code} · ${sp.topics.title}`
              : sp.topics.title
            : "",
        }));
      return {
        id: r.id,
        subject: r.subject,
        board: r.board,
        level: r.level,
        note: r.note,
        summary: r.ai_summary,
        points,
      };
    })
    .sort((a, b) => a.subject.localeCompare(b.subject));
}

// A representative plan so the public showcase dashboard isn't empty. The
// showcase has no session, so a real read would return nothing.
const DEMO_PLANS: WeeklyFocusPlan[] = [
  {
    id: "demo-focus-bio",
    subject: "biology",
    board: "edexcel",
    level: "gcse",
    note: "Focus on exchange surfaces before Thursday's live session.",
    summary:
      "This week you'll get to grips with how substances move in and out of cells — diffusion, osmosis and active transport — and why a cell's surface area matters so much. It's the groundwork for understanding how your body absorbs what it needs, so nailing it now will pay off across the whole topic.",
    points: [
      {
        id: "d1",
        code: "4.1",
        title: "Diffusion, osmosis and active transport",
        topicLabel: "4 · Transport",
      },
      { id: "d2", code: "4.3", title: "Surface area to volume ratio", topicLabel: "4 · Transport" },
    ],
  },
  {
    id: "demo-focus-chem",
    subject: "chemistry",
    board: "edexcel",
    level: "gcse",
    note: null,
    summary:
      "This week is all about ionic bonding — how metals and non-metals swap electrons to form charged ions that stick together in giant lattices. Once it clicks, you'll be able to explain why salts like sodium chloride behave the way they do.",
    points: [{ id: "d3", code: "2.2", title: "Ionic bonding", topicLabel: "2 · Bonding" }],
  },
];

/**
 * Reads the weekly plan(s) for a given week key (`YYYY-MM-DD` Monday), optionally
 * narrowed to a set of subjects (used to show a student only their enrolled
 * subjects). Any signed-in user may read; RLS handles the rest.
 */
export function useWeeklyFocus(
  weekKey: string,
  subjects?: string[],
  options?: { enabled?: boolean },
) {
  const enabledSubjects = subjects && subjects.length > 0 ? [...subjects].sort() : null;

  const query = useQuery({
    enabled: (options?.enabled ?? true) && weekKey.length > 0,
    queryKey: ["weekly-focus", weekKey, enabledSubjects],
    queryFn: async (): Promise<WeeklyFocusPlan[]> => {
      if (isDemoStudent()) {
        return enabledSubjects
          ? DEMO_PLANS.filter((p) => enabledSubjects.includes(p.subject))
          : DEMO_PLANS;
      }

      let q = supabase
        .from("weekly_focus")
        .select(
          "id, subject, board, level, note, ai_summary, weekly_focus_points(spec_points(id, code, title, sort_order, topics(code, title, sort_order)))",
        )
        .eq("week_start", weekKey);
      if (enabledSubjects) q = q.in("subject", enabledSubjects as SubjectV[]);

      const { data, error } = await q;
      if (error) throw error;
      return shape((data ?? []) as unknown as RawRow[]);
    },
    staleTime: 1000 * 60 * 5,
  });

  return { plans: query.data ?? [], loading: query.isLoading, error: query.error };
}

export interface RelatedVideo {
  id: string;
  title: string;
  description: string | null;
  videoUrl: string | null;
  subject: string;
  /** Which of the queried spec points this video is linked to. */
  matchedPointIds: string[];
}

// Demo related-videos: the showcase videos carry no real spec-point links, so
// fake the association by subject against the demo plans, keyed on demo point ids.
function demoRelatedVideos(pointIds: string[]): RelatedVideo[] {
  const wanted = new Set(pointIds);
  return DEMO_VIDEOS.map((v) => {
    const matched = DEMO_PLANS.filter((p) => p.subject === v.subject)
      .flatMap((p) => p.points.map((pt) => pt.id))
      .filter((id) => wanted.has(id));
    return {
      id: v.id,
      title: v.title,
      description: v.description ?? null,
      videoUrl: v.video_url,
      subject: v.subject,
      matchedPointIds: matched,
    };
  }).filter((v) => v.matchedPointIds.length > 0);
}

type RawVideoRow = {
  id: string;
  title: string;
  description: string | null;
  video_url: string | null;
  subject: string;
  resource_spec_points: Array<{ spec_point_id: string }> | null;
};

/**
 * Videos linked to any of the given spec points (via `resource_spec_points`).
 * Drives the "Related videos" strip on the student "This Week" card — a video
 * appears the moment the tutor puts one of its spec points in this week's focus.
 * Pass the union of the week's focus point ids.
 */
export function useWeeklyFocusVideos(pointIds: string[]) {
  const ids = [...pointIds].sort();
  const query = useQuery({
    enabled: ids.length > 0,
    queryKey: ["weekly-focus-videos", ids],
    queryFn: async (): Promise<RelatedVideo[]> => {
      if (isDemoStudent()) return demoRelatedVideos(ids);

      const { data, error } = await supabase
        .from("resources")
        .select(
          "id, title, description, video_url, subject, resource_spec_points!inner(spec_point_id)",
        )
        .eq("kind", "video")
        .in("resource_spec_points.spec_point_id", ids);
      if (error) throw error;

      return ((data ?? []) as unknown as RawVideoRow[]).map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        videoUrl: r.video_url,
        subject: r.subject,
        matchedPointIds: (r.resource_spec_points ?? []).map((l) => l.spec_point_id),
      }));
    },
    staleTime: 1000 * 60 * 5,
  });

  return { videos: query.data ?? [], loading: query.isLoading };
}

/** Invalidate every cached weekly-focus read (after a tutor save/clear). */
export function useInvalidateWeeklyFocus() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["weekly-focus"] });
}

/**
 * Tutor write: replace the plan for one (week, subject, board, level) with the
 * given spec points. Passing an empty `specPointIds` clears the plan entirely
 * (the row and its links are removed), so an over-eager week can be undone.
 */
export async function saveWeeklyFocus(input: {
  weekKey: string;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  note: string | null;
  specPointIds: string[];
  userId: string;
}): Promise<string | null> {
  const { weekKey, subject, board, level, note, specPointIds, userId } = input;

  // Clearing: drop the plan row; ON DELETE CASCADE removes its points.
  if (specPointIds.length === 0) {
    const { error } = await supabase
      .from("weekly_focus")
      .delete()
      .eq("week_start", weekKey)
      .eq("subject", subject)
      .eq("board", board)
      .eq("level", level);
    if (error) throw error;
    return null;
  }

  const { data: upserted, error: upsertErr } = await supabase
    .from("weekly_focus")
    .upsert(
      {
        week_start: weekKey,
        subject,
        board,
        level,
        note: note?.trim() || null,
        created_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "week_start,subject,board,level" },
    )
    .select("id")
    .single();
  if (upsertErr) throw upsertErr;

  const focusId = upserted.id;

  // Replace the point set: clear then insert the current selection.
  const { error: delErr } = await supabase
    .from("weekly_focus_points")
    .delete()
    .eq("focus_id", focusId);
  if (delErr) throw delErr;

  const { error: insErr } = await supabase
    .from("weekly_focus_points")
    .insert(specPointIds.map((spec_point_id) => ({ focus_id: focusId, spec_point_id })));
  if (insErr) throw insErr;

  return focusId;
}
