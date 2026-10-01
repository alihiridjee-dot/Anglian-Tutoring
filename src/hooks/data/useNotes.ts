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
