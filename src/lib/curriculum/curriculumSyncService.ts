import { supabase } from "@/integrations/supabase/client";
import { type LevelV, type BoardV, type SubjectV } from "./taxonomy";

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

// The first word of a measured quantity in a spec's prose ("1.5 kg of water",
// "2.5 × 10³"), which no spec code is followed by. "A" for amps is left out:
// it's also the article a point's title can start with.
const QUANTITY_WORDS = new Set(
  (
    "kg g mg µg μg t m cm mm km µm μm nm s ms min mins h hr hrs J kJ MJ N kN W kW MW " +
    "V mV kV mA Ω Pa kPa Hz kHz MHz mol dm³ dm3 cm³ cm3 m³ m3 m² m2 cm² ml mL l L " +
    "°C ° K % × x = - – times per million billion thousand"
  ).split(" "),
);

function startsWithQuantity(text: string): boolean {
  const first = text
    .split(/\s/)[0]
    .replace(/[,;:)]+$/, "")
    .split("/")[0];
  return QUANTITY_WORDS.has(first);
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
    let specPoints: Array<{ code: string; title: string; description?: string }> = [];

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

      // Detect spec points. Match codes at any depth: B1.1a, 1.1, AQA's
      // 4.1.1.1, Cambridge's 2.1.1 and 1.1.1S, Edexcel's 1.1B.
      const specMatch = line.match(/^([A-Z]?\d+(?:\.\d+)+[A-Z]{0,2})\s+(.+)$/i);
      if (specMatch && !startsWithQuantity(specMatch[2])) {
        const code = specMatch[1];
        // A contents page's dot leaders and page number aren't part of the title.
        const titleAndDesc = specMatch[2].replace(/\s*(?:\.\s*){3,}\d*\s*$|\s*…+\s*\d*\s*$/, "");
        if (!titleAndDesc) continue;

        // If there's a long sentence, make the first part the title and the rest description
        const sentenceEnd = titleAndDesc.indexOf(".");
        let specTitle = titleAndDesc;
        let specDesc = "";

        if (sentenceEnd > 10 && sentenceEnd < titleAndDesc.length - 1) {
          specTitle = titleAndDesc.substring(0, sentenceEnd).trim();
          specDesc = titleAndDesc.substring(sentenceEnd + 1).trim();
        }

        // A contents page repeats codes the body has: keep one of each.
        const seen = specPoints.find((p) => p.code === code);
        if (seen) {
          seen.description ??= specDesc || undefined;
          continue;
        }
        specPoints.push({
          code,
          title: specTitle,
          description: specDesc || undefined,
        });
      }
    }

    // A code with points under it (4.1.1 above 4.1.1.1, B1.1 above B1.1a) is a
    // section heading, not a point. Edexcel's B/C/P and Cambridge's S are
    // capitals, so they never count as children.
    const headings = new Set(
      specPoints
        .filter((p) =>
          specPoints.some(
            (c) =>
              c.code.length > p.code.length &&
              c.code.startsWith(p.code) &&
              /^[.a-z]/.test(c.code[p.code.length]),
          ),
        )
        .map((p) => p.code),
    );
    specPoints = specPoints.filter((p) => !headings.has(p.code));

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
   * Inserts parsed curriculum (a topic and its spec points) into the shared
   * database in one transaction: all of it or none of it. Demo and real
   * accounts read the same rows; demo access is limited only by RLS on
   * MCQs/homework/live sessions. No quiz sets are made: an empty one would be
   * published to students with nothing in it.
   */
  private static async insertCurriculum(data: ParsedCurriculum): Promise<SyncResult> {
    try {
      const { data: row, error } = await supabase.rpc("import_curriculum_topic", {
        _subject: data.subject,
        _board: data.board,
        _level: data.level,
        _topic_code: data.topicCode,
        _topic_title: data.topicTitle,
        _topic_description: data.topicDescription ?? null,
        _points: data.specPoints.map((pt) => ({
          code: pt.code,
          title: pt.title,
          description: pt.description ?? null,
        })),
      });
      if (error) return { success: false, error: error.message };
      const result = row as { topic_id: string; points: number };
      return {
        success: true,
        insertedTopicId: result.topic_id,
        insertedPointsCount: result.points,
      };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Writes the parsed curriculum to the shared database. Content becomes visible
   * to real (enrolled) students and, per the demo access rules, to demo students
   * too. The result is reported to both status slots the panel renders.
   */
  static async uploadCurriculum(
    data: ParsedCurriculum,
  ): Promise<{ production: SyncResult; demo: SyncResult }> {
    const result = await this.insertCurriculum(data);
    return { production: result, demo: result };
  }
}
