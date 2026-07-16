import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Acknowledging tutor feedback, and the storage cleanup it triggers.
 *
 * Runs entirely under the caller's own JWT — no service role. Authorization is
 * RLS and two SECURITY DEFINER functions, matching how the rest of the app
 * gates:
 *  - `acknowledge_submission` re-checks ownership and that the work is graded,
 *    stamps acknowledged_at (students have no UPDATE grant — RLS can't restrict
 *    a write to one column) and notifies the tutor.
 *  - the "student delete acknowledged" storage policy then permits removing that
 *    submission's files, and only after acknowledgment, so submissions stay
 *    final up to the moment they're marked and read.
 *  - `mark_submission_files_deleted` records the outcome.
 *
 * The submission row, grade, feedback and score_pct deliberately survive — only
 * the bytes go. score_pct feeds predicted grades, and students keep feedback.
 */

const BUCKET = "resources";

type SubmissionFile = { path: string; name: string };

/** Pull the storage paths off a submission's `files` JSON, defensively. */
function pathsOf(files: unknown): string[] {
  if (!Array.isArray(files)) return [];
  return (files as SubmissionFile[])
    .map((f) => (typeof f?.path === "string" ? f.path : null))
    .filter((p): p is string => !!p && p.startsWith("submissions/"));
}

/**
 * Deletes a homework brief a tutor set — for something posted in error — and
 * removes every trace of it system-wide.
 *
 * Runs under the caller's own JWT: the "resources tutors delete" RLS policy is
 * what authorizes it, so a student calling this gets nothing deleted. The DB
 * does the heavy lifting — deleting the `resources` row cascades to every
 * student's `homework_submissions` (and their `notifications`), the
 * `resource_spec_points` links and any `session_attendees`. Only the storage
 * bytes fall outside that cascade, so we collect the paths first — the brief's
 * task file and mark scheme, plus every student's submission files — and sweep
 * them after the row is gone.
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

    // The brief itself, so we know which task file / mark scheme to remove.
    const { data: hw, error: hwError } = await supabase
      .from("resources")
      .select("file_path, mark_scheme_path, kind")
      .eq("id", data.homeworkId)
      .single();
    if (hwError) throw new Error(hwError.message);
    if (hw.kind !== "homework") throw new Error("That item is not homework");

    // Every student's submission files for this brief. Tutors can read these
    // under the "hs read scoped" policy; nobody else reaches this far.
    const { data: subs, error: subsError } = await supabase
      .from("homework_submissions")
      .select("files")
      .eq("resource_id", data.homeworkId);
    if (subsError) throw new Error(subsError.message);

    const paths = new Set<string>();
    if (typeof hw.file_path === "string") paths.add(hw.file_path);
    if (typeof hw.mark_scheme_path === "string") paths.add(hw.mark_scheme_path);
    for (const s of subs ?? []) for (const p of pathsOf(s.files)) paths.add(p);

    // Delete the row first — this is the authoritative, RLS-checked step that
    // fans out across every student. If it fails (e.g. not a tutor), nothing is
    // touched and no orphaned files are left behind.
    const { error: delError } = await supabase
      .from("resources")
      .delete()
      .eq("id", data.homeworkId);
    if (delError) throw new Error(delError.message);

    // Bytes are now unreferenced; sweep them best-effort. A failure here leaves
    // orphaned files but the brief is already gone everywhere, so don't surface
    // it as "delete failed" and invite a retry against a missing row.
    if (paths.size > 0) {
      const { error: removeError } = await supabase.storage
        .from(BUCKET)
        .remove([...paths]);
      if (removeError) {
        console.error("[homework] file cleanup after delete failed", data.homeworkId, removeError.message);
        return { deleted: true, filesRemoved: 0 };
      }
    }

    return { deleted: true, filesRemoved: paths.size };
  });

export const acknowledgeSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { submissionId: string }) => {
    const id = typeof input?.submissionId === "string" ? input.submissionId.trim() : "";
    if (!id) throw new Error("A submission id is required");
    return { submissionId: id };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // Ownership, graded-state and idempotency are enforced inside the RPC, so a
    // forged id fails here rather than deleting someone else's work.
    const { error: rpcError } = await supabase.rpc("acknowledge_submission", {
      _submission_id: data.submissionId,
    });
    if (rpcError) throw new Error(rpcError.message);

    const { data: sub, error: readError } = await supabase
      .from("homework_submissions")
      .select("files, files_deleted_at")
      .eq("id", data.submissionId)
      .single();
    if (readError) throw new Error(readError.message);

    // Already collected by an earlier acknowledge or the weekly sweep.
    if (sub.files_deleted_at) return { acknowledged: true, filesDeleted: 0 };

    const paths = pathsOf(sub.files);
    if (paths.length === 0) {
      await supabase.rpc("mark_submission_files_deleted", { _submission_id: data.submissionId });
      return { acknowledged: true, filesDeleted: 0 };
    }

    const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths);
    if (removeError) {
      // The acknowledgment landed and the tutor was notified, so this must not
      // surface as "acknowledge failed" and invite a retry. Leave
      // files_deleted_at unset and let the weekly sweep collect the bytes.
      console.error("[homework] file cleanup failed", data.submissionId, removeError.message);
      return { acknowledged: true, filesDeleted: 0 };
    }

    const { error: stampError } = await supabase.rpc("mark_submission_files_deleted", {
      _submission_id: data.submissionId,
    });
    if (stampError) {
      console.error(
        "[homework] files_deleted_at stamp failed",
        data.submissionId,
        stampError.message,
      );
    }

    return { acknowledged: true, filesDeleted: paths.length };
  });
