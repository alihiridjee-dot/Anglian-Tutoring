import { useState } from "react";
import { type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { dbError } from "@/lib/platform/errors";
import { deleteZoomMeeting } from "@/lib/live/zoom.functions";
import { type LiveSession } from "@/lib/live/liveSessions";
import { toast } from "sonner";

export function useDeleteLiveSession(qc: QueryClient) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Tutor-only: cancel a session scheduled in error. Cancels the Zoom meeting
  // first if the app created it and no other session uses it (best-effort — a
  // link-less or already-gone meeting is fine), then deletes the resource row. The row delete is the RLS-checked, authoritative
  // step and cascades to resource_spec_points / session_attendees, so the
  // session vanishes everywhere (including any curriculum point it was on).
  const handleDelete = async (session: LiveSession) => {
    if (
      !confirm(
        `Delete "${session.title}"? This removes the session for everyone, and cancels its Zoom meeting if the app created it.`,
      )
    )
      return;
    setDeletingId(session.id);
    try {
      if (session.join_url?.toLowerCase().includes("zoom")) {
        try {
          const zoom = await deleteZoomMeeting(session.id);
          if (zoom.reason === "shared") {
            toast.info("Zoom meeting kept: another session uses the same link.");
          }
        } catch (err) {
          // Don't block removing the row if Zoom cancellation fails — surface it
          // but still delete locally so a bad session can always be cleared.
          toast.warning(
            err instanceof Error
              ? `Zoom meeting not cancelled: ${err.message}`
              : "Zoom meeting not cancelled.",
          );
        }
      }
      const { error } = await supabase.from("resources").delete().eq("id", session.id);
      if (error) throw dbError(error);
      toast.success("Session deleted");
      qc.invalidateQueries({ queryKey: ["live"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete session");
    } finally {
      setDeletingId(null);
    }
  };

  return { deletingId, handleDelete };
}
