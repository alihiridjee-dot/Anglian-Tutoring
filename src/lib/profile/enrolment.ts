import type { Database } from "@/integrations/supabase/types";

export type ProfileRole = Database["public"]["Enums"]["profile_role"];

/** One enrolled subject and the exam board the student sits it with. */
export interface Enrolment {
  subject: string;
  board: Database["public"]["Enums"]["board"];
}
