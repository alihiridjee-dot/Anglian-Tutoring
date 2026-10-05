import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isDemoMode } from "@/lib/auth/session";
import { demoSpecPointNotes, loadDemoNote } from "@/lib/demo/demoNotes";
import type { Note, SpecPointNote } from "@/lib/notes/noteFormat";

/** One published note, with its concept's subject and title. */
export function useNote(conceptId: string) {
  return useQuery({
    queryKey: ["note", conceptId],
    queryFn: async (): Promise<Note | null> => {
      // The showcase has no session: its notes are fixtures (see demoNotes.ts).
      if (isDemoMode()) return loadDemoNote(conceptId);
      const { data, error } = await supabase
        .from("notes")
        .select("body, status")
        .eq("concept_id", conceptId)
        .eq("status", "approved")
        .maybeSingle();
      if (error) throw error;
      return (data?.body as unknown as Note) ?? null;
    },
  });
}

export type { SpecPointNote };

/**
 * The published notes behind each of the given spec points, primary note first.
 *
 * A point can sit under more than one note (a broad point is touched by a few),
 * so each point maps to a list. Points with no published note are left out of
 * the map. Drafts are dropped even for tutors, so a tutor sees what students see.
 */
export function useSpecPointNotes(specPointIds: string[]) {
  const ids = [...new Set(specPointIds)].sort();
  return useQuery({
    queryKey: ["spec-point-notes", ids],
    enabled: ids.length > 0,
    queryFn: async (): Promise<Map<string, SpecPointNote[]>> => {
      if (isDemoMode()) return demoSpecPointNotes(ids);
      const { data: links, error } = await supabase
        .from("note_concept_spec_points")
        .select("spec_point_id, is_primary, note_concepts(id, title)")
        .in("spec_point_id", ids);
      if (error) throw error;
      const conceptIds = [...new Set((links ?? []).map((l) => l.note_concepts?.id ?? ""))];
      const { data: notes, error: nErr } = await supabase
        .from("notes")
        .select("concept_id")
        .eq("status", "approved")
        .in("concept_id", conceptIds.filter(Boolean));
      if (nErr) throw nErr;
      const live = new Set((notes ?? []).map((n) => n.concept_id));

      const byPoint = new Map<string, SpecPointNote[]>();
      for (const l of links ?? []) {
        const c = l.note_concepts;
        if (!c || !live.has(c.id)) continue;
        const list = byPoint.get(l.spec_point_id) ?? [];
        list.push({ id: c.id, title: c.title, primary: l.is_primary });
        byPoint.set(l.spec_point_id, list);
      }
      for (const list of byPoint.values()) {
        list.sort((a, b) => Number(b.primary) - Number(a.primary) || a.id.localeCompare(b.id));
      }
      return byPoint;
    },
  });
}
