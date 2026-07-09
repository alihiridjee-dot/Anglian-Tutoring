import { supabase } from "@/integrations/supabase/client";
import { BLUEPRINTS } from "./curriculumBlueprints";
import { type LevelV, type BoardV, type SubjectV } from "./taxonomy";
import { resolveEducationalVideo } from "./videoMapper";

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

// Internal utility to generate dynamic topics & spec points on-the-fly for any requested board, level, and subject combination
export function getMockCurriculum(
  level: LevelV,
  board: BoardV,
  subject: SubjectV,
): Array<{ topic: Topic; points: SpecPoint[] }> {
  // Check if there is synchronized demo curriculum in client-side storage to ensure absolute environmental isolation
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem("studyhub:demo-curriculum");
      if (stored) {
        const parsed = JSON.parse(stored) as Array<{
          topic: Topic & { level: string; board: string; subject: string };
          points: SpecPoint[];
        }>;
        // Filter by the requested filters
        const filtered = parsed.filter(
          (c) => c.topic.level === level && c.topic.board === board && c.topic.subject === subject,
        );
        if (filtered.length > 0) {
          return filtered.map((f) => ({
            topic: {
              id: f.topic.id,
              code: f.topic.code,
              title: f.topic.title,
              description: f.topic.description,
              sort_order: f.topic.sort_order,
            },
            points: f.points,
          }));
        }
      }
    } catch (e) {
      console.error("Error reading studyhub:demo-curriculum", e);
    }
  }

  const blueprints =
    BLUEPRINTS[level]?.[`${board}_${subject}`] ||
    BLUEPRINTS[level]?.[subject] ||
    BLUEPRINTS.gcse.biology;
  const boardLabel = board.toUpperCase();
  const subjectPrefix = board === "aqa" ? "AQA" : board === "edexcel" ? "EDEX" : "OCR";

  return blueprints.map((blueprint, tIndex) => {
    let topicId = `${board}-${subject}-${level}-t${tIndex + 1}`;
    if (board === "aqa" && subject === "biology" && level === "gcse") {
      if (tIndex === 0) topicId = "aqa-bio-gcse-t1";
      else if (tIndex === 3) topicId = "aqa-bio-gcse-t2";
    } else if (board === "edexcel" && subject === "biology" && level === "gcse" && tIndex === 0) {
      topicId = "ed-bio-gcse-t1";
    } else if (board === "ocr" && subject === "biology" && level === "gcse" && tIndex === 0) {
      topicId = "ocr-bio-gcse-t1";
    } else if (board === "aqa" && subject === "biology" && level === "alevel" && tIndex === 0) {
      topicId = "aqa-bio-alevel-t1";
    } else if (board === "edexcel" && subject === "chemistry" && level === "gcse" && tIndex === 3) {
      topicId = "ed-chem-gcse-t1";
    }

    const topicCode = level === "alevel" ? `Module ${tIndex + 1}` : `Topic ${tIndex + 1}`;

    const topic: Topic = {
      id: topicId,
      code: topicCode,
      title: `${blueprint.title}`,
      description: blueprint.desc,
      sort_order: tIndex + 1,
    };

    const points: SpecPoint[] = blueprint.points.map((p, pIndex) => {
      const specCode = `${subjectPrefix} ${p.code}`;

      let pointId = `${board}-${subject}-${level}-p${tIndex + 1}-${pIndex + 1}`;
      if (topicId === "aqa-bio-gcse-t1") {
        if (pIndex === 0) pointId = "aqa-bio-gcse-p1";
        else if (pIndex === 1) pointId = "aqa-bio-gcse-p2";
        else if (pIndex === 2) pointId = "aqa-bio-gcse-p3";
      } else if (topicId === "aqa-bio-gcse-t2") {
        if (pIndex === 0) pointId = "aqa-bio-gcse-p4";
        else if (pIndex === 1) pointId = "aqa-bio-gcse-p5";
      } else if (topicId === "ed-bio-gcse-t1") {
        if (pIndex === 0) pointId = "ed-bio-gcse-p1";
        else if (pIndex === 1) pointId = "ed-bio-gcse-p2";
      } else if (topicId === "ocr-bio-gcse-t1" && pIndex === 0) {
        pointId = "ocr-bio-gcse-t1-p1";
      } else if (topicId === "aqa-bio-alevel-t1") {
        if (pIndex === 0) pointId = "aqa-bio-alevel-p1";
        else if (pIndex === 1) pointId = "aqa-bio-alevel-p2";
      } else if (topicId === "ed-chem-gcse-t1" && pIndex === 0) {
        pointId = "ed-chem-gcse-p1";
      }

      return {
        id: pointId,
        topic_id: topicId,
        code: specCode,
        title: p.title,
        description: p.desc,
      };
    });

    return { topic, points };
  });
}

/**
 * Data Access Layer (DAL) for Curriculum management
 * Decouples database/sandbox storage logic from UI components.
 */
export class CurriculumDAL {
  static isDemoMode(): boolean {
    return typeof window !== "undefined" && localStorage.getItem("studyhub:is-demo") === "true";
  }

  static async getTopics(level: LevelV, board: BoardV, subject: SubjectV): Promise<Topic[]> {
    if (this.isDemoMode()) {
      const curriculumList = getMockCurriculum(level, board, subject);
      return curriculumList.map((c) => c.topic);
    }

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

  static async getSpecPoints(
    topicId: string,
    level: LevelV,
    board: BoardV,
    subject: SubjectV,
  ): Promise<SpecPoint[]> {
    if (this.isDemoMode()) {
      const curriculumList = getMockCurriculum(level, board, subject);
      const found = curriculumList.find((c) => c.topic.id === topicId);
      return found ? found.points : [];
    }

    const { data, error } = await supabase
      .from("spec_points")
      .select("id, topic_id, code, title, description")
      .eq("topic_id", topicId)
      .order("code");
    if (error) {
      console.error("Error loading spec points:", error);
      return [];
    }
    return data ?? [];
  }

  static async getResourcesAndMcqSets(
    point: SpecPoint,
    level: LevelV,
    board: BoardV,
    subject: SubjectV,
  ): Promise<{ resources: Resource[]; mcqSets: McqSet[] }> {
    if (this.isDemoMode()) {
      const resolvedVideo = resolveEducationalVideo(board, subject, level, point.code, point.title);
      const rList: Resource[] = [
        {
          id: `res-video-${point.id}`,
          kind: "video",
          title: resolvedVideo.title,
          description: resolvedVideo.description,
          video_url: resolvedVideo.video_url,
          file_path: null,
          file_name: null,
          starts_at: null,
          join_url: null,
          due_at: null,
        },
        {
          id: `res-live-${point.id}`,
          kind: "live_session",
          title: `Live Mastery Session: ${point.title}`,
          description: `Interactive small-group tutorial focusing on high-scoring questions and past-paper analysis.`,
          video_url: null,
          file_path: null,
          file_name: null,
          starts_at: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
          join_url: "/live",
          due_at: null,
        },
        {
          id: `res-hw-${point.id}`,
          kind: "homework",
          title: `${point.title} GCSE Assignment Sheet`,
          description: `Download, complete, and submit this assignment for detailed feedback from your tutor.`,
          video_url: null,
          file_path: null,
          file_name: null,
          starts_at: null,
          join_url: null,
          due_at: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(),
        },
        {
          id: `res-dl-${point.id}`,
          kind: "download",
          title: `${point.title} Core Revision Cheatsheet`,
          description: `Essential formulae, definition lists, and active recall flashcards.`,
          video_url: null,
          file_path: "mock-download",
          file_name: `${point.title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_revision_sheet.pdf`,
          starts_at: null,
          join_url: null,
          due_at: null,
        },
      ];

      const mList: McqSet[] = [
        {
          id: `mcq-set-${point.id}`,
          title: `${level.toUpperCase()} ${
            subject.charAt(0).toUpperCase() + subject.slice(1)
          }: ${point.title} (${board.toUpperCase()} ${point.code})`,
          published: true,
        },
      ];

      return { resources: rList, mcqSets: mList };
    }

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

    const resourcesList = (r.data ?? []).map((resource) => {
      if (
        resource.kind === "video" &&
        (resource.video_url === "https://www.youtube.com/watch?v=dQw4w9WgXcQ" ||
          !resource.video_url)
      ) {
        const resolved = resolveEducationalVideo(board, subject, level, point.code, point.title);
        return {
          ...resource,
          video_url: resolved.video_url,
          title: resolved.title,
          description: resolved.description,
        };
      }
      return resource;
    });

    return {
      resources: resourcesList,
      mcqSets: m.data ?? [],
    };
  }
}
