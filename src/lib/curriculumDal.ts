import { supabase } from "@/integrations/supabase/client";
import { type LevelV, type BoardV, type SubjectV } from "./taxonomy";
import {
  isDemoStudent,
  DEMO_CURRICULUM_TOPICS,
  DEMO_CURRICULUM_SPEC_POINTS,
  DEMO_CURRICULUM_CONTENT,
  DEMO_CURRICULUM_FALLBACK,
} from "./demo/studentDemo";

export type Topic = {
  id: string;
  code: string | null;
  title: string;
  description: string | null;
  sort_order: number;
};

export type SpecPoint = {
  id: string;
  topic_id: string;
  code: string;
  title: string;
  description: string | null;
};

export type Resource = {
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

export type McqSet = {
  id: string;
  title: string;
  published: boolean;
};

/**
 * Data Access Layer (DAL) for Curriculum management.
 *
 * Real accounts read from Supabase, scoped by row-level security. The public
 * showcase has no session at all, so every read here short-circuits to the
 * fixtures first — a Supabase call would simply return nothing.
 */
export class CurriculumDAL {
  static async getTopics(level: LevelV, board: BoardV, subject: SubjectV): Promise<Topic[]> {
    // The fixtures cover one illustrative set per subject, shown whatever
    // board/level the visitor picks — the showcase is about the shape of the
    // product, not a real spec matrix.
    if (isDemoStudent()) return DEMO_CURRICULUM_TOPICS[subject] ?? [];

    const { data, error } = await supabase
      .from("topics")
      .select("id, code, title, description, sort_order")
      .eq("subject", subject)
      .eq("board", board)
      .eq("level", level)
      .order("sort_order")
      .order("code");

    if (error) {
      console.error("Error fetching topics:", error);
      throw error;
    }
    return data ?? [];
  }

  static async getSpecPoints(topicId: string): Promise<SpecPoint[]> {
    if (isDemoStudent()) return DEMO_CURRICULUM_SPEC_POINTS[topicId] ?? [];

    const { data, error } = await supabase
      .from("spec_points")
      .select("id, topic_id, code, title, description")
      .eq("topic_id", topicId)
      .order("sort_order")
      .order("code");
    if (error) {
      console.error("Error loading spec points:", error);
      return [];
    }
    return data ?? [];
  }

  static async getResourcesAndMcqSets(
    point: SpecPoint,
  ): Promise<{ resources: Resource[]; mcqSets: McqSet[] }> {
    // Hand-written content exists for the headline spec points; the rest get a
    // generated set so no point in the showcase ever looks empty.
    if (isDemoStudent())
      return DEMO_CURRICULUM_CONTENT[point.id] ?? DEMO_CURRICULUM_FALLBACK(point);

    const [r, m, tagged] = await Promise.all([
      // Resources link to spec points many-to-many via resource_spec_points, so
      // one piece of homework can surface on every point it covers. RLS on
      // `resources` still decides what the caller may see.
      supabase
        .from("resource_spec_points")
        .select(
          "resources!inner(id, kind, title, description, video_url, file_path, file_name, starts_at, join_url, due_at, created_at)",
        )
        .eq("spec_point_id", point.id),
      // Sets whose whole set is this spec point (manual per-point generation).
      supabase
        .from("mcq_sets")
        .select("id, title, published")
        .eq("spec_point_id", point.id)
        .order("created_at", { ascending: false }),
      // Weekly quizzes contribute questions tagged with this point while the set
      // itself spans several points — surface those sets here too, so a student
      // opening a spec point finds every quiz that covers it.
      supabase
        .from("mcq_questions")
        .select("mcq_sets!inner(id, title, published)")
        .eq("spec_point_id", point.id),
    ]);

    const resources = ((r.data ?? []) as unknown as Array<{ resources: Resource | null }>)
      .map((row) => row.resources)
      .filter((x): x is Resource => !!x)
      .sort((a, b) =>
        String((b as { created_at?: string }).created_at ?? "").localeCompare(
          String((a as { created_at?: string }).created_at ?? ""),
        ),
      );

    // Merge direct and question-tagged sets, de-duplicating by set id.
    const byId = new Map<string, McqSet>();
    for (const s of (m.data ?? []) as McqSet[]) byId.set(s.id, s);
    for (const row of (tagged.data ?? []) as unknown as Array<{ mcq_sets: McqSet | null }>) {
      if (row.mcq_sets && !byId.has(row.mcq_sets.id)) byId.set(row.mcq_sets.id, row.mcq_sets);
    }

    return {
      resources,
      mcqSets: Array.from(byId.values()),
    };
  }
}
