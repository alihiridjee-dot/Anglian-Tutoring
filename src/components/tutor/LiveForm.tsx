import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Field, inputCls, submitBtn } from "./Field";
import { TaxonomyFields } from "./TaxonomyFields";
import { SpecPointSelect } from "./SpecPointSelect";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { createZoomMeeting } from "@/lib/zoom.functions";
import { generateSessionBlurb } from "@/lib/sessionBlurb.functions";
import { suggestSpecPoints } from "@/lib/suggestSpecPoints.functions";
import { Video, Smartphone, Loader2, Sparkles, Wand2 } from "lucide-react";

interface LiveFormProps {
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

export function LiveForm({ userId, taxonomy }: LiveFormProps) {
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
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Title">
        <input
          required
          className={inputCls}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Masterclass in Algebraic Equations"
        />
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Starts at">
          <input
            required
            type="datetime-local"
            className={inputCls}
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </Field>
        <Field label="Join URL">
          <div className="relative">
            <input
              type="url"
              className={`${inputCls} pr-32`}
              value={joinUrl}
              onChange={(e) => setJoinUrl(e.target.value)}
              placeholder="Auto Zoom, paste a link, or leave for later"
            />
            <button
              onClick={generateZoomLink}
              disabled={generatingLink}
              className="absolute right-1 top-1 bottom-1 px-2.5 rounded bg-[#2D8CFF] hover:bg-[#2681F2] text-white text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-70"
              title="Create a Zoom meeting"
            >
              {generatingLink ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Video className="w-3.5 h-3.5" />
              )}
              {generatingLink ? "Creating…" : "Auto Zoom"}
            </button>
          </div>
        </Field>
      </div>

      <Field label="Description">
        <div className="relative">
          <textarea
            className={`${inputCls} h-24 py-2`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief summary of what will be covered in this session..."
          />
          <button
            onClick={generateDescription}
            disabled={generatingBlurb}
            className="absolute right-1.5 top-1.5 px-2.5 py-1 rounded bg-primary/10 hover:bg-primary/15 text-primary text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-70"
            title="Draft a description with AI from the title & spec points"
          >
            {generatingBlurb ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {generatingBlurb ? "Drafting…" : "AI draft"}
          </button>
        </div>
      </Field>

      <TaxonomyFields {...taxonomy} hideBoard />

      <div className="flex items-center justify-between gap-2 -mb-1">
        <p className="text-xs text-muted-foreground">
          Tag the curriculum this session covers, or let AI suggest it from the description.
        </p>
        <button
          type="button"
          onClick={suggestFromDescription}
          disabled={suggesting}
          className="shrink-0 px-2.5 py-1 rounded bg-primary/10 hover:bg-primary/15 text-primary text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-70"
          title="Suggest spec points with AI from the title & description"
        >
          {suggesting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Wand2 className="w-3.5 h-3.5" />
          )}
          {suggesting ? "Suggesting…" : "AI suggest"}
        </button>
      </div>

      <SpecPointSelect
        subject={taxonomy.subject}
        level={taxonomy.level}
        value={specPointIds}
        onChange={setSpecPointIds}
        required
      />

      {/* Broadcast Toggle Options */}
      <div className="p-3 bg-secondary/50 rounded-lg border border-border space-y-2">
        <div className="flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-[#25D366]" />
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Broadcast Notifications
          </span>
        </div>
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input
            type="checkbox"
            className="rounded border-border text-[#25D366] focus:ring-[#25D366]"
            checked={broadcastWhatsApp}
            onChange={(e) => setBroadcastWhatsApp(e.target.checked)}
          />
          <span>Copy formatted group broadcast invite template on schedule</span>
        </label>
      </div>

      <button disabled={loading} className={submitBtn}>
        {loading ? "Saving…" : "Schedule session"}
      </button>
    </form>
  );
}
