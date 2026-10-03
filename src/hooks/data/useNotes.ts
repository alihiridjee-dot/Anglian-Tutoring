import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isDemoMode } from "@/lib/auth/session";
import type { Note } from "@/lib/notes/noteFormat";

export interface NoteConceptRow {
  id: string;
  subject: string;
  chapter: string;
  title: string;
  scope: string;
  kind: string;
  higher_only: boolean;
  separate_only: boolean;
  sort_order: number;
  /** A published note exists for this concept. */
  published: boolean;
}

/**
 * Every revision-note topic in the given subjects, in teaching order, with
 * whether its note is published yet.
 *
 * RLS does the gating: a student only gets concepts in subjects they have paid
 * for, and only approved notes. A tutor gets everything, so drafts are counted
 * as unpublished here to show tutors what students see.
 */
export function useNoteConcepts(subjects: string[]) {
  return useQuery({
    queryKey: ["note-concepts", [...subjects].sort()],
    enabled: subjects.length > 0 && !isDemoMode(),
    queryFn: async (): Promise<NoteConceptRow[]> => {
      const [{ data: concepts, error: cErr }, { data: notes, error: nErr }] = await Promise.all([
        supabase
          .from("note_concepts")
          .select(
            "id, subject, chapter, title, scope, kind, higher_only, separate_only, sort_order",
          )
          .in("subject", subjects as never[])
          .order("sort_order"),
        supabase.from("notes").select("concept_id").eq("status", "approved"),
      ]);
      if (cErr) throw cErr;
      if (nErr) throw nErr;
      const live = new Set((notes ?? []).map((n) => n.concept_id));
      return (concepts ?? []).map((c) => ({ ...c, published: live.has(c.id) }));
    },
  });
}

/** One published note, with its concept's subject and title. */
export function useNote(conceptId: string) {
  return useQuery({
    queryKey: ["note", conceptId],
    enabled: !isDemoMode(),
    queryFn: async (): Promise<Note | null> => {
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

/** A published note that covers a spec point. */
export interface SpecPointNote {
  id: string;
  title: string;
  /** The note written for this point, as opposed to one that also touches it. */
  primary: boolean;
}

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
    enabled: ids.length > 0 && !isDemoMode(),
    queryFn: async (): Promise<Map<string, SpecPointNote[]>> => {
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
