import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Coverage, type CoverageRow } from "@/lib/curriculumCoverage";
import type { SubjectV, BoardV, LevelV } from "@/lib/taxonomy";

export { Coverage, type CoverageRow };

/**
 * Loads which level/board/subject combinations have curriculum.
 *
 * This goes through an RPC rather than reading `topics` directly because the
 * RLS policy on that table requires an enrolment, and the student choosing a
 * board has none yet — enrolments are written a step later. A plain client
 * query returns zero rows there, which would gate away everything.
 */
export function useCurriculumCoverage() {
  const query = useQuery({
    queryKey: ["curriculum-coverage"],
    // Curriculum only moves when a tutor syncs a spec, so this is effectively
    // static across a session.
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<CoverageRow[]> => {
      const { data, error } = await supabase.rpc("curriculum_coverage");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        level: r.level as LevelV,
        board: r.board as BoardV,
        subject: r.subject as SubjectV,
        topicCount: Number(r.topic_count),
        specPointCount: Number(r.spec_point_count),
      }));
    },
  });

  return { ...query, coverage: new Coverage(query.data ?? []) };
}
