import type { Database } from "@/integrations/supabase/types";

export type ProfileRole = Database["public"]["Enums"]["profile_role"];

/** One enrolled subject and the exam board the student sits it with. */
export interface Enrolment {
  subject: string;
  board: Database["public"]["Enums"]["board"];
  /** When the student took the subject up. Absent where it isn't known (fixtures, other readers). */
  enrolledAt?: string;
  /**
   * The grade the student is aiming for ("7", "A*"), set at sign-up, by their
   * tutor, or on the predicted-grade card. Null until one is set; absent where
   * the reader didn't ask for it.
   */
  targetGrade?: string | null;
}
