import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isDemoStudent, DEMO_VIDEOS } from "@/lib/demo/studentDemo";
import type { SubjectV, BoardV, LevelV } from "@/lib/curriculum/taxonomy";

export interface WeeklyFocusPoint {
  id: string;
  code: string;
  title: string;
  topicLabel: string;
}

/**
 * One subject's slice of the points a tutor pinned into a student's week. The
 * pins themselves are ordinary plan points with a `tutor` origin — set from the
 * tutor's planner, one student at a time.
 */
export interface WeeklyFocusPlan {
  id: string;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  points: WeeklyFocusPoint[];
  /**
   * A word from the tutor on this subject, shown as "Ali's take". Only the
   * showcase sets it; the live query below leaves it unset.
   */
  note?: string | null;
}

// Shape returned by the select below: one row per pinned point.
type RawRow = {
  student_weekly_plans: {
    id: string;
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
  } | null;
  spec_points: {
    id: string;
    code: string;
    title: string;
    sort_order: number | null;
    topics: { code: string | null; title: string; sort_order: number | null } | null;
  } | null;
};

function shape(rows: RawRow[]): WeeklyFocusPlan[] {
  const byPlan = new Map<
    string,
    { plan: NonNullable<RawRow["student_weekly_plans"]>; points: RawRow["spec_points"][] }
  >();
  for (const r of rows) {
    if (!r.student_weekly_plans || !r.spec_points) continue;
    const entry = byPlan.get(r.student_weekly_plans.id) ?? {
      plan: r.student_weekly_plans,
      points: [],
    };
    entry.points.push(r.spec_points);
    byPlan.set(r.student_weekly_plans.id, entry);
  }
  return [...byPlan.values()]
    .map(({ plan, points }) => ({
      id: plan.id,
      subject: plan.subject,
      board: plan.board,
      level: plan.level,
      points: points
        .filter((sp): sp is NonNullable<typeof sp> => !!sp)
        .sort(
          (a, b) =>
            (a.topics?.sort_order ?? 0) - (b.topics?.sort_order ?? 0) ||
            (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
            a.code.localeCompare(b.code),
        )
        .map((sp) => ({
          id: sp.id,
          code: sp.code,
          title: sp.title,
          topicLabel: sp.topics
            ? sp.topics.code
              ? `${sp.topics.code} · ${sp.topics.title}`
              : sp.topics.title
            : "",
        })),
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject));
}

// A representative plan so the public showcase dashboard isn't empty. The
// showcase has no session, so a real read would return nothing. One pinned
// point per subject, using the demo curriculum's own ids, each with a note that
// refers to Alex's real fixture marks and dates.
const DEMO_PLANS: WeeklyFocusPlan[] = [
  {
    id: "demo-focus-bio",
    subject: "biology",
    board: "edexcel",
    level: "gcse",
    points: [
      {
        id: "demo-sp-photosynthesis",
        code: "EDEX 6.3",
        title: "Rate Limiting Factors on Photosynthesis",
        topicLabel: "Topic 6 · Plant structures and their functions",
      },
    ],
    note: "Great work getting a grade 8 on photosynthesis. You asked how to word the plateau, so here it is: once light stops being the limiting factor, the rate is limited by whichever factor is in shortest supply, such as CO₂ or temperature. Watch the video, read the note, then write that sentence from memory, because it is what stands between you and a 9.",
  },
  {
    id: "demo-focus-chem",
    subject: "chemistry",
    board: "aqa",
    level: "gcse",
    points: [
      {
        id: "demo-sp-ionic",
        code: "AQA 4.2.1.2",
        title: "Ionic bonding",
        topicLabel: "Topic 2 · Bonding, structure, and the properties of matter",
      },
    ],
    note: "Bonding starts this week, so watch the ionic bonding video and read the note. For any melting-point question, the phrase that scores is 'strong electrostatic forces of attraction between oppositely charged ions', and never call an ionic compound a molecule. Your bonding task is with me now, and I'll answer your question about what carries the charge when it comes back.",
  },
  {
    id: "demo-focus-phys",
    subject: "physics",
    board: "ocr",
    level: "gcse",
    points: [
      {
        id: "demo-sp-series",
        code: "OCR P3.2i",
        title: "Resistance in series and parallel",
        topicLabel: "Topic 3 · Electricity",
      },
    ],
    note: "Alongside your I–V task, due in four days, let's lock in series and parallel, because that is where Electricity marks usually leak. In series the current is the same everywhere and the potential difference is shared; in parallel each branch has the same potential difference and the current splits between them. Watch the lamps practical and read the note, then retake the Energy quiz, where you scored 3/5.",
  },
];

/**
 * The spec points a tutor pinned into this student's week (`YYYY-MM-DD` Monday),
 * grouped by subject and optionally narrowed to the student's enrolments. RLS
 * limits the read to the student's own plans.
 */
export function useWeeklyFocus(studentId: string | null, weekKey: string, subjects?: string[]) {
  const enabledSubjects = subjects && subjects.length > 0 ? [...subjects].sort() : null;
  const demo = isDemoStudent();

  const query = useQuery({
    enabled: demo || (!!studentId && weekKey.length > 0),
    queryKey: ["weekly-focus", studentId, weekKey, enabledSubjects],
    queryFn: async (): Promise<WeeklyFocusPlan[]> => {
      if (demo) {
        return enabledSubjects
          ? DEMO_PLANS.filter((p) => enabledSubjects.includes(p.subject))
          : DEMO_PLANS;
      }

      let q = supabase
        .from("student_weekly_plan_points")
        .select(
          "student_weekly_plans!inner(id, subject, board, level), spec_points(id, code, title, sort_order, topics(code, title, sort_order))",
        )
        .eq("origin", "tutor")
        .eq("student_weekly_plans.student_id", studentId!)
        .eq("student_weekly_plans.week_start", weekKey);
      if (enabledSubjects) q = q.in("student_weekly_plans.subject", enabledSubjects as SubjectV[]);

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

// Demo related-videos: matched by spec point, as the live `resource_spec_points`
// link is, so each pinned point shows the one video that teaches it — not every
// video in its subject.
function demoRelatedVideos(pointIds: string[]): RelatedVideo[] {
  const wanted = new Set(pointIds);
  return DEMO_VIDEOS.map((v) => {
    const matched = v.spec_point_id && wanted.has(v.spec_point_id) ? [v.spec_point_id] : [];
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
 * Drives the videos on the student "From your tutor" card — a video appears the
 * moment the tutor pins one of its spec points into the student's week. Pass the
 * union of the pinned point ids.
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
