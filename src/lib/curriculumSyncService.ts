import { supabase } from "@/integrations/supabase/client";
import { type LevelV, type BoardV, type SubjectV } from "./taxonomy";
import { type Topic, type SpecPoint } from "./curriculumDal";

export interface ParsedCurriculum {
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  topicTitle: string;
  topicCode: string;
  topicDescription?: string;
  specPoints: Array<{
    code: string;
    title: string;
    description?: string;
  }>;
}

export interface SyncResult {
  success: boolean;
  error?: string;
  insertedTopicId?: string;
  insertedPointsCount?: number;
}

export class CurriculumSyncService {
  /**
   * Utility to parse unstructured curriculum specification texts (e.g., from PDFs)
   * Maps content strictly to our hierarchical schema (Topic -> Spec Point).
   */
  static parseCurriculumText(
    text: string,
    subject: SubjectV,
    board: BoardV,
    level: LevelV,
  ): ParsedCurriculum {
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    let topicTitle = "New Topic";
    let topicCode = "Topic X";
    const topicDescription = "Manual/PDF Uploaded Curriculum Module";
    const specPoints: Array<{ code: string; title: string; description?: string }> = [];

    // Simple heuristic parser for specification lines
    // Look for patterns like "B1.1a describe how...", "1.1 Eukaryotic...", or "B1.1 Cell structures"
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Identify Topic header (e.g. "Topic B1: Cell level systems" or "B1.1 Cell structures")
      if (
        (line.toLowerCase().startsWith("topic") || line.toLowerCase().includes("module")) &&
        line.includes(":")
      ) {
        const parts = line.split(":");
        topicCode = parts[0].trim();
        topicTitle = parts.slice(1).join(":").trim();
        continue;
      }

      // Detect spec points. Match codes like B1.1a, 1.1, B1.1, etc.
      const specMatch = line.match(/^([A-Z]?\d+\.\d+[a-z]?)\s+(.+)$/i);
      if (specMatch) {
        const code = specMatch[1];
        const titleAndDesc = specMatch[2];

        // If there's a long sentence, make the first part the title and the rest description
        const sentenceEnd = titleAndDesc.indexOf(".");
        let specTitle = titleAndDesc;
        let specDesc = "";

        if (sentenceEnd > 10 && sentenceEnd < titleAndDesc.length - 1) {
          specTitle = titleAndDesc.substring(0, sentenceEnd).trim();
          specDesc = titleAndDesc.substring(sentenceEnd + 1).trim();
        }

        specPoints.push({
          code,
          title: specTitle,
          description: specDesc || undefined,
        });
      }
    }

    // Fallback if no specific topic structure was found
    if (specPoints.length === 0 && lines.length > 0) {
      // Create generic points from lines that aren't headers
      lines.slice(1, 15).forEach((line, idx) => {
        if (line.length > 10 && !line.includes("©")) {
          specPoints.push({
            code: `${subject.substring(0, 3).toUpperCase()}.${idx + 1}`,
            title: line.length > 60 ? line.substring(0, 60) + "..." : line,
            description: line,
          });
        }
      });
      if (lines[0]) {
        topicTitle = lines[0].length > 50 ? lines[0].substring(0, 50) + "..." : lines[0];
      }
    }

    return {
      subject,
      board,
      level,
      topicTitle,
      topicCode,
      topicDescription,
      specPoints,
    };
  }

  /**
   * Dual-Environment Sync pushes parsed curriculum to both Production and Demo platforms
   * with absolute environmental isolation.
   */
  static async uploadCurriculum(
    data: ParsedCurriculum,
  ): Promise<{ production: SyncResult; demo: SyncResult }> {
    const results: { production: SyncResult; demo: SyncResult } = {
      production: { success: false },
      demo: { success: false },
    };

    // --- 1. Production Sync ---
    try {
      // Determine user ID
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const userId = user?.id || "00000000-0000-0000-0000-000000000000";

      // Insert Topic
      const { data: topicRow, error: topicErr } = await supabase
        .from("topics")
        .insert({
          board: data.board,
          level: data.level,
          subject: data.subject,
          code: data.topicCode,
          title: data.topicTitle,
          description: data.topicDescription || null,
          created_by: userId,
          sort_order: 100, // Put manually added topics lower down
        })
        .select("id")
        .single();

      if (topicErr) {
        results.production = { success: false, error: topicErr.message };
      } else {
        const topicId = topicRow.id;
        let pointsCount = 0;

        // Insert Spec Points & MCQ sets
        for (const pt of data.specPoints) {
          const { data: ptRow, error: ptErr } = await supabase
            .from("spec_points")
            .insert({
              topic_id: topicId,
              code: pt.code,
              title: pt.title,
              description: pt.description || null,
            })
            .select("id")
            .single();

          if (!ptErr && ptRow) {
            pointsCount++;

            // Create connected default MCQ set for click readiness
            await supabase.from("mcq_sets").insert({
              spec_point_id: ptRow.id,
              title: `${data.topicTitle}: ${pt.title} MCQ Set`,
              description: `Practice assessment for ${pt.title}`,
              published: true,
              subject: data.subject,
              created_by: userId,
            });
          }
        }

        results.production = {
          success: true,
          insertedTopicId: topicId,
          insertedPointsCount: pointsCount,
        };
      }
    } catch (e: unknown) {
      results.production = {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    // --- 2. Demo Sync ---
    // Strict Isolation: Test data never leaks into Production.
    // Pushes to a localized mock registry stored in client-side localStorage.
    try {
      if (typeof window !== "undefined") {
        const stored = localStorage.getItem("studyhub:demo-curriculum") || "[]";
        const currentDemoCurriculum = JSON.parse(stored) as Array<{
          topic: Topic & { level: string; board: string; subject: string };
          points: SpecPoint[];
        }>;

        const demoTopicId = `demo-topic-${Date.now()}`;
        const demoTopic = {
          id: demoTopicId,
          code: data.topicCode,
          title: data.topicTitle,
          description: data.topicDescription || null,
          sort_order: 200,
          level: data.level,
          board: data.board,
          subject: data.subject,
        };

        const demoPoints: SpecPoint[] = data.specPoints.map((pt, idx) => ({
          id: `demo-point-${demoTopicId}-${idx}`,
          topic_id: demoTopicId,
          code: pt.code,
          title: pt.title,
          description: pt.description || null,
        }));

        currentDemoCurriculum.push({
          topic: demoTopic,
          points: demoPoints,
        });

        localStorage.setItem("studyhub:demo-curriculum", JSON.stringify(currentDemoCurriculum));

        results.demo = {
          success: true,
          insertedTopicId: demoTopicId,
          insertedPointsCount: demoPoints.length,
        };
      } else {
        results.demo = { success: false, error: "Not running in browser window context" };
      }
    } catch (e: unknown) {
      results.demo = {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    return results;
  }
}
