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
 * All reads go to Supabase. Demo and real accounts read the same curriculum;
 * row-level security applies the demo access limits (MCQs/homework/live). There
 * is no in-code curriculum content — everything is fetched at runtime.
 */
export class CurriculumDAL {
  static async getTopics(level: LevelV, board: BoardV, subject: SubjectV): Promise<Topic[]> {
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

    return {
      resources: r.data ?? [],
      mcqSets: m.data ?? [],
    };
  }
}
