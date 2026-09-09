import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * The two homework actions that need a server: deleting a brief, and
 * acknowledging a mark.
 *
 * Both run entirely under the caller's own JWT — no service role. Authorization
 * is RLS and, for acknowledgement, a SECURITY DEFINER function, matching how
 * the rest of the app gates.
 *
 * Neither touches submission files any more. Homework is answered on the page:
 * a submission is typed answers, `homework_submissions.files` is gone, and the
 * storage sweep these functions used to run on acknowledgement had nothing left
 * to collect.
 */

const BUCKET = "resources";

/**
 * Deletes a homework a tutor set — for something posted in error — and removes
 * every trace of it system-wide.
 *
 * Runs under the caller's own JWT: the "resources tutors delete" RLS policy is
 * what authorizes it, so a student calling this gets nothing deleted. The DB
 * does the heavy lifting — deleting the `resources` row cascades to every
 * student's `homework_submissions` (and their `homework_answers`, staged marks
 * and `notifications`), the `resource_spec_points` links, any drafts and any
 * `session_attendees`. Only storage bytes fall outside that cascade, so the
 * brief's own attachments are collected first and swept after the row is gone.
 */
export const deleteHomework = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { homeworkId: string }) => {
    const id = typeof input?.homeworkId === "string" ? input.homeworkId.trim() : "";
    if (!id) throw new Error("A homework id is required");
    return { homeworkId: id };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // The brief itself, so we know which attachments to remove.
    const { data: hw, error: hwError } = await supabase
      .from("resources")
      .select("file_path, mark_scheme_path, kind")
      .eq("id", data.homeworkId)
      .single();
    if (hwError) throw new Error(hwError.message);
    if (hw.kind !== "homework") throw new Error("That item is not homework");

    // Figures attached to the brief's own questions. They cascade away with the
    // row like everything else, so their bytes have to be swept here too.
    const { data: figures, error: figError } = await supabase
      .from("homework_questions")
      .select("image_path")
      .eq("resource_id", data.homeworkId);
    if (figError) throw new Error(figError.message);

    const paths = new Set<string>();
    if (typeof hw.file_path === "string") paths.add(hw.file_path);
    if (typeof hw.mark_scheme_path === "string") paths.add(hw.mark_scheme_path);
    for (const f of figures ?? []) if (typeof f.image_path === "string") paths.add(f.image_path);

    // Delete the row first — this is the authoritative, RLS-checked step that
    // fans out across every student. If it fails (e.g. not a tutor), nothing is
    // touched and no orphaned files are left behind.
    const { error: delError } = await supabase.from("resources").delete().eq("id", data.homeworkId);
    if (delError) throw new Error(delError.message);

    // Bytes are now unreferenced; sweep them best-effort. A failure here leaves
    // orphaned files but the brief is already gone everywhere, so don't surface
    // it as "delete failed" and invite a retry against a missing row.
    if (paths.size > 0) {
      const { error: removeError } = await supabase.storage.from(BUCKET).remove([...paths]);
      if (removeError) {
        console.error(
          "[homework] file cleanup after delete failed",
          data.homeworkId,
          removeError.message,
        );
        return { deleted: true, filesRemoved: 0 };
      }
    }

    return { deleted: true, filesRemoved: paths.size };
  });

/**
 * The student confirming they've read their mark, which notifies whoever marked
 * it.
 *
 * Ownership, graded-state and idempotency are all enforced inside
 * `acknowledge_submission`, so a forged id fails in the database rather than
 * here. Students have no UPDATE grant on the row — RLS is row-level and cannot
 * restrict a write to one column — which is why this is an RPC at all.
 */
export const acknowledgeSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { submissionId: string }) => {
    const id = typeof input?.submissionId === "string" ? input.submissionId.trim() : "";
    if (!id) throw new Error("A submission id is required");
    return { submissionId: id };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { error } = await supabase.rpc("acknowledge_submission", {
      _submission_id: data.submissionId,
    });
    if (error) throw new Error(error.message);

    return { acknowledged: true };
  });
