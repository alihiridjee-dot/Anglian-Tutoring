import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import { createZoomMeeting } from "@/lib/live/zoom.functions";
import { generateSessionBlurb } from "@/lib/live/sessionBlurb.functions";
import { suggestSpecPoints } from "@/lib/curriculum/suggestSpecPoints.functions";
import { useWeeklyFocus } from "@/hooks/data/useWeeklyFocus";
import { mondayOf, toDateKey, weekRangeLabel } from "@/lib/planner/week";

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
  /**
   * Dashboard mode: tie the session to the tutor's "This Week" plan. Picking a
   * start date derives the week it falls in and pre-links the session's spec
   * points to that week's focus, so a live session is always covering the same
   * curriculum the week is built around. Off (default) on the standalone /live
   * page, where a session can be scheduled for anything.
   */
  linkToWeek?: boolean;
}

/**
 * Scheduling a live session: the fields, the link to the tutor's week, the three
 * assists (Zoom link, AI description, AI spec points) and the save itself.
 */
export function useLiveForm({ userId, taxonomy, linkToWeek = false }: LiveFormProps) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [joinUrl, setJoinUrl] = useState("");
  const [specPointIds, setSpecPointIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [generatingBlurb, setGeneratingBlurb] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [broadcastWhatsApp, setBroadcastWhatsApp] = useState(true);
  const genBlurb = useServerFn(generateSessionBlurb);
  const suggestPoints = useServerFn(suggestSpecPoints);

  // Week-linking (dashboard mode). The chosen start date decides which Mon–Sun
  // week the session belongs to; we then look up the tutor's "This Week" focus
  // for that week + taxonomy and pre-fill the session's spec points from it, so
  // the live session and the week's focus always cover the same curriculum.
  const startDate = startsAt ? new Date(startsAt) : null;
  const validStart = startDate && !isNaN(startDate.getTime()) ? startDate : null;
  const weekKey = linkToWeek && validStart ? toDateKey(mondayOf(validStart)) : "";
  const weekLabel = linkToWeek && validStart ? weekRangeLabel(mondayOf(validStart)) : "";
  const { plans: weekPlans, loading: weekLoading } = useWeeklyFocus(weekKey, undefined, {
    enabled: linkToWeek && weekKey.length > 0,
  });
  // Sessions are board-agnostic, so match the week's focus by subject + level
  // only. weekly_focus is still board-scoped; the first matching board's focus
  // for that subject+level is used to seed points (the tutor can add more).
  const weekFocus = weekPlans.find(
    (p) => p.subject === taxonomy.subject && p.level === taxonomy.level,
  );

  // Seed the session's spec points from the week's focus once per (week, taxonomy)
  // signature, so a background refetch or an unrelated field edit doesn't clobber
  // points the tutor added on top. Adding more points below is always allowed.
  const seededFor = useRef<string>("");
  useEffect(() => {
    if (!linkToWeek || !weekKey || weekLoading) return;
    // Board is deliberately absent: the focus above is matched on subject +
    // level only, so the seeded points are identical across boards. Including it
    // made the signature finer-grained than the data it guards, which meant
    // switching board re-seeded and wiped points the tutor had added on top.
    const sig = `${weekKey}|${taxonomy.subject}|${taxonomy.level}`;
    if (seededFor.current === sig) return;
    seededFor.current = sig;
    const focusIds = weekFocus?.points.map((p) => p.id) ?? [];
    if (focusIds.length > 0) setSpecPointIds(focusIds);
  }, [linkToWeek, weekKey, weekLoading, weekFocus, taxonomy.subject, taxonomy.level]);

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

    const { data: created, error } = await supabase
      .from("resources")
      .insert({
        kind: "live_session",
        title,
        description,
        starts_at: formattedStartsAt,
        join_url: joinUrl || null,
        subject: taxonomy.subject,
        // Live sessions are broad, board-agnostic themes (per subject + level).
        board: null,
        level: taxonomy.level,
        created_by: userId,
      })
      .select("id")
      .single();

    if (error) {
      setLoading(false);
      return toast.error(error.message);
    }

    // Curriculum links live in resource_spec_points (many-to-many), so one
    // session can surface on every spec point it covers — students find it by
    // browsing any of them.
    if (specPointIds.length > 0) {
      const { error: linkError } = await supabase
        .from("resource_spec_points")
        .insert(specPointIds.map((spec_point_id) => ({ resource_id: created.id, spec_point_id })));
      if (linkError) {
        setLoading(false);
        return toast.error(linkError.message);
      }
    }

    setLoading(false);

    if (broadcastWhatsApp) {
      const timeStr = new Date(startsAt).toLocaleString();
      const inviteText = `📚 *New Anglia Educate Live Session Scheduled!* 📚\n\n🔹 *Session:* ${title}\n🔹 *Subject:* ${taxonomy.subject.toUpperCase()} (${taxonomy.level.toUpperCase()})\n🔹 *Time:* ${timeStr}\n\n👉 *Join here:* ${joinUrl || "Link pending"}`;

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
    setSpecPointIds([]);
    // Allow the next date pick to re-seed from that week's focus.
    seededFor.current = "";
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
    validStart,
    weekLabel,
    weekLoading,
    weekFocus,
    generateZoomLink,
    generateDescription,
    suggestFromDescription,
    submit,
  };
}

export type LiveFormState = ReturnType<typeof useLiveForm>;
