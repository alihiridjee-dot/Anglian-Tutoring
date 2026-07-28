// Tutor-only editor for the videos hanging off one spec point. Curriculum video
// rows are ordinary `resources` (kind = "video") joined to the point through
// `resource_spec_points`, so "edit" here means: change the resource itself,
// detach it from this point, or attach a brand-new one.
//
// The link check exists because a video URL can rot silently — the card still
// renders a thumbnail-shaped box while the embed 404s. Asking YouTube's oEmbed
// endpoint tells us both that the id resolves *and* what the video is actually
// called, which is how you catch a link that points at the wrong topic.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Link2Off, Trash2, ShieldCheck, ShieldAlert, X } from "lucide-react";
import { parseVideoUrl } from "@/lib/videoEmbed";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { Field, inputCls, submitBtn } from "./Field";

export interface EditableVideo {
  id: string;
  title: string;
  description: string | null;
  video_url: string | null;
}

interface Props {
  /** The video being edited — null puts the dialog in "add a new video" mode. */
  video: EditableVideo | null;
  specPointId: string;
  /** Only used when creating; an existing resource keeps its own taxonomy. */
  taxonomy: { subject: SubjectV; board: BoardV; level: LevelV };
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}

type CheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ok"; title: string; author: string }
  | { status: "bad"; reason: string };

/**
 * Ask YouTube/Vimeo's oEmbed endpoint whether a URL still resolves. Both send
 * permissive CORS headers, so this works straight from the browser. Anything we
 * can't check (files, unknown hosts, a network blip) reports as unknown rather
 * than failing the tutor's link outright.
 */
async function checkLink(url: string): Promise<CheckState> {
  const embed = parseVideoUrl(url);
  if (!embed) return { status: "bad", reason: "Enter a URL first." };
  if (embed.provider === "other")
    return { status: "bad", reason: "Not a YouTube, Vimeo or direct video URL — it won't embed." };
  if (embed.provider === "file") return { status: "idle" };

  const endpoint =
    embed.provider === "youtube"
      ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(embed.originalUrl)}`
      : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(embed.originalUrl)}`;

  try {
    const res = await fetch(endpoint);
    if (res.status === 401 || res.status === 403)
      return { status: "bad", reason: "The owner has disabled embedding for this video." };
    if (!res.ok)
      return { status: "bad", reason: "This video no longer exists (or is private/removed)." };
    const json = (await res.json()) as { title?: string; author_name?: string };
    return { status: "ok", title: json.title ?? "Untitled", author: json.author_name ?? "Unknown" };
  } catch {
    return { status: "bad", reason: "Couldn't reach the provider to verify — check it manually." };
  }
}

export function SpecPointVideoEditor({
  video,
  specPointId,
  taxonomy,
  userId,
  onClose,
  onSaved,
}: Props) {
  const isNew = video === null;
  const [title, setTitle] = useState(video?.title ?? "");
  const [description, setDescription] = useState(video?.description ?? "");
  const [videoUrl, setVideoUrl] = useState(video?.video_url ?? "");
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<CheckState>({ status: "idle" });

  // A URL edit invalidates whatever the previous check said.
  useEffect(() => setCheck({ status: "idle" }), [videoUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const embed = parseVideoUrl(videoUrl);

  const runCheck = async () => {
    setCheck({ status: "checking" });
    setCheck(await checkLink(videoUrl));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);

    if (isNew) {
      const { data: created, error } = await supabase
        .from("resources")
        .insert({
          kind: "video",
          title,
          description,
          video_url: videoUrl,
          subject: taxonomy.subject,
          board: taxonomy.board,
          level: taxonomy.level,
          created_by: userId,
        })
        .select("id")
        .single();
      if (error) {
        setBusy(false);
        return toast.error(error.message);
      }
      const { error: linkError } = await supabase
        .from("resource_spec_points")
        .insert({ resource_id: created.id, spec_point_id: specPointId });
      if (linkError) {
        setBusy(false);
        return toast.error(linkError.message);
      }
    } else {
      const { error } = await supabase
        .from("resources")
        .update({ title, description, video_url: videoUrl })
        .eq("id", video.id);
      if (error) {
        setBusy(false);
        return toast.error(error.message);
      }
    }

    setBusy(false);
    toast.success(isNew ? "Video added" : "Video updated");
    onSaved();
    onClose();
  };

  // Detaching leaves the resource intact for every other point that uses it —
  // the same video is deliberately shared across spec points.
  const unlink = async () => {
    if (!video) return;
    if (!confirm("Remove this video from this spec point? It stays in the video library.")) return;
    setBusy(true);
    const { error } = await supabase
      .from("resource_spec_points")
      .delete()
      .eq("resource_id", video.id)
      .eq("spec_point_id", specPointId);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Removed from this spec point");
    onSaved();
    onClose();
  };

  const destroy = async () => {
    if (!video) return;
    if (!confirm("Delete this video everywhere, including every other spec point it's linked to?"))
      return;
    setBusy(true);
    const { error } = await supabase.from("resources").delete().eq("id", video.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Video deleted");
    onSaved();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg my-8 rounded-2xl premium-card p-6 space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-lg font-bold text-foreground">
            {isNew ? "Add a video to this spec point" : "Edit video"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <Field label="Title">
          <input
            required
            className={inputCls}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>

        <Field label="Video URL (YouTube / Vimeo / mp4)">
          <input
            required
            type="url"
            className={inputCls}
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
          />
        </Field>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={runCheck}
            disabled={!videoUrl || check.status === "checking"}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs font-semibold text-foreground hover:bg-secondary/40 disabled:opacity-60"
          >
            {check.status === "checking" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5" />
            )}
            Check link
          </button>
          {check.status === "ok" && (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              Live — “{check.title}” by {check.author}
            </span>
          )}
          {check.status === "bad" && (
            <span className="inline-flex items-center gap-1.5 text-xs text-destructive font-medium">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
              {check.reason}
            </span>
          )}
        </div>

        {/* Live preview of exactly what the student will see in the card. */}
        {embed?.embedUrl && (
          <div className="aspect-video w-full rounded-xl overflow-hidden border border-border bg-black">
            <iframe
              key={embed.embedUrl}
              src={embed.embedUrl}
              title="Video preview"
              className="w-full h-full"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        )}

        <Field label="Description">
          <textarea
            className={`${inputCls} h-24 py-2`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <button disabled={busy} className={submitBtn}>
          {busy ? "Saving…" : isNew ? "Add video" : "Save changes"}
        </button>

        {!isNew && (
          <div className="flex flex-wrap gap-2 pt-1 border-t border-border">
            <button
              type="button"
              onClick={unlink}
              disabled={busy}
              className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-md border border-border text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60"
            >
              <Link2Off className="w-3.5 h-3.5" /> Remove from this point
            </button>
            <button
              type="button"
              onClick={destroy}
              disabled={busy}
              className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-md border border-destructive/40 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-60"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete everywhere
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
