import { supabase } from "@/integrations/supabase/client";
import { type LevelV, type BoardV, type SubjectV } from "./taxonomy";
import {
  isDemoStudent,
  DEMO_CURRICULUM_TOPICS,
  DEMO_CURRICULUM_SPEC_POINTS,
  DEMO_CURRICULUM_CONTENT,
  DEMO_CURRICULUM_FALLBACK,
} from "./demo/studentDemo";
import {
  queryTerms,
  scoreRecord,
  ilikeValue,
  broadestTerm,
  MIN_QUERY_LENGTH,
} from "./search/match";

/** Rows pulled from the database before ranking narrows them. */
const SEARCH_FETCH_LIMIT = 300;
/** Matches shown; beyond this the query is too broad to be worth scrolling. */
const SEARCH_RESULT_LIMIT = 60;

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

/** A spec point returned by a search, carrying the topic it belongs to. */
export type SpecPointMatch = SpecPoint & {
  topic: { id: string; code: string | null; title: string };
  /** Descending relevance from `scoreRecord`. */
  score: number;
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

  /**
   * Every spec point in one specification that matches `query`, ranked.
   *
   * Searching the whole (level, board, subject) rather than the topics already
   * expanded on screen is the point of it: a student who half-remembers
   * "limiting factors" has no idea which topic it lives under, and browsing to
   * find out is the problem the search exists to remove.
   *
   * The database is asked only for rows containing the query's most selective
   * term; the remaining terms and the ranking are applied here, so one request
   * serves any number of words. Returns [] for a query too short to be useful.
   */
  static async searchSpecPoints(
    level: LevelV,
    board: BoardV,
    subject: SubjectV,
    query: string,
    limit = SEARCH_RESULT_LIMIT,
  ): Promise<SpecPointMatch[]> {
    const terms = queryTerms(query);
    if (query.trim().length < MIN_QUERY_LENGTH || terms.length === 0) return [];

    const rank = (point: SpecPoint, topic: { code: string | null; title: string }) =>
      scoreRecord(
        [
          { text: point.code, weight: 1.4 },
          { text: point.title, weight: 1 },
          { text: point.description, weight: 0.3 },
          { text: topic.title, weight: 0.2 },
          { text: topic.code, weight: 0.2 },
        ],
        terms,
      );

    const matches: SpecPointMatch[] = [];

    if (isDemoStudent()) {
      for (const topic of DEMO_CURRICULUM_TOPICS[subject] ?? []) {
        for (const point of DEMO_CURRICULUM_SPEC_POINTS[topic.id] ?? []) {
          const score = rank(point, topic);
          if (score) {
            matches.push({
              ...point,
              topic: { id: topic.id, code: topic.code, title: topic.title },
              score,
            });
          }
        }
      }
    } else {
      const value = ilikeValue(broadestTerm(terms));
      if (!value) return [];

      const { data, error } = await supabase
        .from("spec_points")
        .select("id, topic_id, code, title, description, topics!inner(id, code, title)")
        .eq("topics.subject", subject)
        .eq("topics.board", board)
        .eq("topics.level", level)
        .or(`code.ilike.${value},title.ilike.${value},description.ilike.${value}`)
        .limit(SEARCH_FETCH_LIMIT);

      if (error) {
        console.error("Error searching spec points:", error);
        throw error;
      }

      type Row = SpecPoint & { topics: { id: string; code: string | null; title: string } | null };
      for (const row of (data ?? []) as unknown as Row[]) {
        const topic = row.topics;
        if (!topic) continue;
        const score = rank(row, topic);
        if (score) {
          matches.push({
            id: row.id,
            topic_id: row.topic_id,
            code: row.code,
            title: row.title,
            description: row.description,
            topic: { id: topic.id, code: topic.code, title: topic.title },
            score,
          });
        }
      }
    }

    // Ties fall back to specification order — "4.1.2" before "4.1.10".
    return matches
      .sort(
        (a, b) => b.score - a.score || a.code.localeCompare(b.code, undefined, { numeric: true }),
      )
      .slice(0, limit);
  }

  /**
   * One spec point by id, for restoring a link straight to it (from the global
   * search, a bookmark, or a shared URL) without expanding its topic first.
   */
  static async getSpecPointById(id: string): Promise<SpecPoint | null> {
    if (isDemoStudent()) {
      for (const points of Object.values(DEMO_CURRICULUM_SPEC_POINTS)) {
        const found = points.find((p) => p.id === id);
        if (found) return found;
      }
      return null;
    }

    const { data, error } = await supabase
      .from("spec_points")
      .select("id, topic_id, code, title, description")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("Error loading spec point:", error);
      return null;
    }
    return data ?? null;
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
