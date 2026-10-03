import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import { createZoomMeeting } from "@/lib/live/zoom.functions";
import { scheduledInviteText } from "@/lib/live/whatsappShare";
import { generateSessionBlurb } from "@/lib/live/sessionBlurb.functions";
import { suggestSpecPoints } from "@/lib/curriculum/suggestSpecPoints.functions";

export interface LiveFormProps {
  userId: string;
  taxonomy: {
    subject: SubjectV;
    setSubject: (v: SubjectV) => void;
    board: BoardV;
    setBoard: (v: BoardV) => void;
    level: LevelV;
    setLevel: (v: LevelV) => void;
  };
}

/**
 * Scheduling a live session: the fields, the three
 * assists (Zoom link, AI description, AI spec points) and the save itself.
 */
export function useLiveForm({ taxonomy }: LiveFormProps) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [joinUrl, setJoinUrl] = useState("");
  // The meeting "Auto Zoom" made, so deleting the session can cancel it. A
  // pasted link's meeting belongs to whoever made it, and is never cancelled.
  const [zoomMeeting, setZoomMeeting] = useState<{ id: string; joinUrl: string } | null>(null);
  const [specPointIds, setSpecPointIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [generatingBlurb, setGeneratingBlurb] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [broadcastWhatsApp, setBroadcastWhatsApp] = useState(true);
  const genBlurb = useServerFn(generateSessionBlurb);
  const suggestPoints = useServerFn(suggestSpecPoints);

  // Provisions a real Zoom meeting via the zoom-meeting edge function and drops
  // the returned join URL into the form. Needs a title and start time so the
  // Zoom meeting is scheduled correctly.
  const generateZoomLink = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!title || !startsAt) {
      toast.error("Add a title and start time first, then generate the Zoom link.");
      return;
    }
    setGeneratingLink(true);
    try {
      const meeting = await createZoomMeeting({
        topic: title,
        startTime: new Date(startsAt).toISOString(),
      });
      setJoinUrl(meeting.join_url);
      setZoomMeeting({ id: meeting.id, joinUrl: meeting.join_url });
      toast.success("Zoom meeting created!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create Zoom meeting.");
    } finally {
      setGeneratingLink(false);
    }
  };

  // Draft the "in this session we'll cover…" description with AI from the title
  // and tagged spec points. Fills the (still editable) description field; the
  // tutor can tweak it before scheduling, and it's what the student sees.
  const generateDescription = async (e: React.MouseEvent) => {
    e.preventDefault();
    setGeneratingBlurb(true);
    try {
      const { blurb } = await genBlurb({
        data: {
          subject: taxonomy.subject,
          level: taxonomy.level,
          board: taxonomy.board,
          title,
          specPointIds,
        },
      });
      setDescription(blurb);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not draft a description.");
    } finally {
      setGeneratingBlurb(false);
    }
  };

  // Ask the AI which spec points the session's title + description cover, then
  // merge its picks into the current selection (union — never drops points the
  // tutor added by hand). Candidates span all boards, so a broad theme gets its
  // equivalent point under each board.
  const suggestFromDescription = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!title.trim() && !description.trim()) {
      toast.error("Add a title or description first, then let AI suggest spec points.");
      return;
    }
    setSuggesting(true);
    try {
      const { specPointIds: suggested, count } = await suggestPoints({
        data: {
          subject: taxonomy.subject,
          level: taxonomy.level,
          title,
          description,
        },
      });
      if (count === 0) {
        toast.info("No matching spec points found — try adding more detail to the description.");
        return;
      }
      setSpecPointIds((prev) => [...new Set([...prev, ...suggested])]);
      toast.success(`AI suggested ${count} spec point${count === 1 ? "" : "s"} — review below`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not suggest spec points.");
    } finally {
      setSuggesting(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    // A live session must be tied to the curriculum it covers — spec points are
    // required, not optional.
    if (specPointIds.length === 0) {
      return toast.error(
        "Tag at least one spec point — a live session must cover some curriculum.",
      );
    }

    setLoading(true);

    const formattedStartsAt = new Date(startsAt).toISOString();

    // The session and its curriculum links (resource_spec_points, many-to-many,
    // so one session surfaces on every spec point it covers) are written in one
    // transaction: a failed link no longer leaves a live session with no points
    // for a retry to duplicate.
    const { error } = await supabase.rpc("create_linked_resource", {
      _kind: "live_session",
      _title: title,
      _description: description,
      _subject: taxonomy.subject,
      _level: taxonomy.level,
      // Live sessions are broad, board-agnostic themes (per subject + level).
      _board: null,
      _spec_point_ids: specPointIds,
      _starts_at: formattedStartsAt,
      _join_url: joinUrl || null,
      // Only while the field still holds the link Auto Zoom made.
      _zoom_meeting_id: zoomMeeting && zoomMeeting.joinUrl === joinUrl ? zoomMeeting.id : null,
    });

    setLoading(false);
    if (error) return toast.error(error.message);

    if (broadcastWhatsApp) {
      const inviteText = scheduledInviteText({
        title,
        subject: taxonomy.subject,
        level: taxonomy.level,
        starts_at: formattedStartsAt,
        join_url: joinUrl || null,
      });

      try {
        await navigator.clipboard.writeText(inviteText);
        toast.success("Scheduled & WhatsApp invite copied!", {
          description:
            "We saved the lesson and copied the pre-formatted WhatsApp invite text to your clipboard. Paste it directly in your WhatsApp group chat!",
          duration: 6000,
        });
      } catch {
        toast.success("Live session scheduled!", {
          description: "WhatsApp invite template is ready to copy.",
        });
      }
    } else {
      toast.success("Live session scheduled");
    }

    qc.invalidateQueries({ queryKey: ["live"] });
    setTitle("");
    setDescription("");
    setStartsAt("");
    setJoinUrl("");
    setZoomMeeting(null);
    setSpecPointIds([]);
  };

  return {
    title,
    setTitle,
    description,
    setDescription,
    startsAt,
    setStartsAt,
    joinUrl,
    setJoinUrl,
    specPointIds,
    setSpecPointIds,
    loading,
    generatingLink,
    generatingBlurb,
    suggesting,
    broadcastWhatsApp,
    setBroadcastWhatsApp,
    generateZoomLink,
    generateDescription,
    suggestFromDescription,
    submit,
  };
}

export type LiveFormState = ReturnType<typeof useLiveForm>;
