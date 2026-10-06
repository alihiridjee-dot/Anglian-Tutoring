import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Captions,
  CaptionsOff,
  Clapperboard,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";
import { ErrorNote, Meter, Spinner } from "@/components/Shared";

/** The student welcome video, its first frame and its captions, served from `public/videos`. */
const VIDEO = {
  src: "/videos/student-welcome.mp4",
  poster: "/videos/student-welcome.jpg",
  captions: "/videos/student-welcome.en.vtt",
};

/** How far past the furthest point watched a seek may land before it's put back. */
const SEEK_SLACK_S = 0.5;

/** 65 seconds → "1:05". */
function clock(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The welcome video: how the site works, in a minute and a half, before the
 * welcome tour shows the student their own pages.
 *
 * The first time, it can't be skipped. There is no close button, Escape does
 * nothing, there are no native controls to scrub with, and a seek past the
 * furthest point watched is put back there. Next unlocks when the video ends.
 * Leaving the tab pauses it, so playing it in the background doesn't count.
 *
 * Replayed from the 🧭, it can be skipped. And if the file won't load, Next
 * unlocks anyway: a missing video must never shut a student out of the site.
 */
export function WelcomeVideo({
  skippable,
  onWatched,
  onDone,
}: {
  skippable: boolean;
  /** Called when the video reaches its end. */
  onWatched: () => void;
  onDone: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const furthest = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [captions, setCaptions] = useState(true);
  const [muted, setMuted] = useState(false);
  const [watched, setWatched] = useState(false);
  const [failed, setFailed] = useState(false);
  // Set by the first failure and kept, so Try again can't lock Next again.
  const [excused, setExcused] = useState(false);
  const unlocked = skippable || watched || excused;

  useEffect(() => {
    const modal = dialog.current;
    if (modal && !modal.open) modal.showModal();
    return () => modal?.close();
  }, []);

  useEffect(() => {
    const leave = () => {
      if (document.hidden) video.current?.pause();
    };
    document.addEventListener("visibilitychange", leave);
    return () => document.removeEventListener("visibilitychange", leave);
  }, []);

  // Once Next is enabled, it's where the keyboard goes.
  useEffect(() => {
    if (watched) next.current?.focus();
  }, [watched]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    // A refused play (no file, no codec) arrives as the error event too.
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };

  const toggleCaptions = () => {
    const track = video.current?.textTracks[0];
    if (track) track.mode = captions ? "hidden" : "showing";
    setCaptions(!captions);
  };

  const toggleSound = () => {
    const v = video.current;
    if (v) v.muted = !v.muted;
  };

  const retry = () => {
    setFailed(false);
    video.current?.load();
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="welcome-video-title"
      onCancel={(event) => {
        event.preventDefault();
        if (unlocked) onDone();
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 text-foreground backdrop:bg-transparent tint-primary"
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-[color:color-mix(in_oklab,var(--foreground)_55%,transparent)]"
      />
      <div className="relative flex h-full items-center justify-center p-4 short:p-2">
        <div
          className="premium-card flex max-h-full w-full max-w-5xl flex-col gap-4 overflow-y-auto p-5 sm:p-6 short:gap-2 short:p-3"
          style={{ background: "var(--card)" }}
        >
          {/* A phone on its side has no height to spare: the heading is still read out. */}
          <div className="short:sr-only">
            <p className="eyebrow mb-3">Welcome</p>
            <div className="flex items-center gap-3">
              <span className="icon-tile size-10 shrink-0" aria-hidden>
                <Clapperboard className="size-5" />
              </span>
              <h2 id="welcome-video-title" className="text-xl font-extrabold">
                Watch this first
              </h2>
            </div>
          </div>

          {/* As wide as the card, or as wide as the height left over allows. */}
          <div className="relative mx-auto aspect-video w-[min(100%,calc((100dvh_-_15rem)*16/9))] shrink-0 overflow-hidden rounded-xl border border-border bg-muted short:w-[min(100%,calc((100dvh_-_7rem)*16/9))]">
            <video
              ref={video}
              src={VIDEO.src}
              poster={VIDEO.poster}
              preload="auto"
              playsInline
              disablePictureInPicture
              disableRemotePlayback
              controlsList="nodownload nofullscreen noplaybackrate"
              className="size-full"
              onClick={toggle}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onWaiting={() => setWaiting(true)}
              onPlaying={() => setWaiting(false)}
              onCanPlay={() => setWaiting(false)}
              onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
              onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
              onSeeking={(e) => {
                const v = e.currentTarget;
                if (!unlocked && v.currentTime > furthest.current + SEEK_SLACK_S) {
                  v.currentTime = furthest.current;
                }
              }}
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                if (!v.seeking) furthest.current = Math.max(furthest.current, v.currentTime);
                setTime(v.currentTime);
              }}
              onEnded={() => {
                setWatched(true);
                onWatched();
              }}
              onError={() => {
                setFailed(true);
                setExcused(true);
                setWaiting(false);
              }}
            >
              <track kind="captions" src={VIDEO.captions} srcLang="en" label="English" default />
            </video>
            {waiting && (
              <div className="absolute inset-0 grid place-items-center">
                <Spinner label="Loading the video" className="" />
              </div>
            )}
            {!playing && !waiting && !failed && (
              <button
                type="button"
                autoFocus
                onClick={toggle}
                aria-label={time > 0 && !watched ? "Play" : "Play the video"}
                className="btn-solid absolute inset-0 m-auto inline-flex size-16 items-center justify-center rounded-full"
              >
                <Play className="size-7 translate-x-0.5" aria-hidden />
              </button>
            )}
          </div>

          {failed && (
            <ErrorNote
              error={new Error("The video didn’t load. You can carry on without it.")}
              onRetry={retry}
            />
          )}

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={toggle}
              aria-label={playing ? "Pause" : "Play"}
              className="btn-premium inline-flex size-11 shrink-0 items-center justify-center rounded-xl"
            >
              {playing ? (
                <Pause className="size-5" aria-hidden />
              ) : (
                <Play className="size-5" aria-hidden />
              )}
            </button>
            {/* Shows how far through, and can't be dragged. */}
            <div className="min-w-24 flex-1">
              <Meter value={duration ? (time / duration) * 100 : 0} size="sm" />
            </div>
            <button
              type="button"
              onClick={toggleCaptions}
              aria-pressed={captions}
              aria-label="Captions"
              className="btn-premium inline-flex size-11 shrink-0 items-center justify-center rounded-xl"
            >
              {captions ? (
                <Captions className="size-5" aria-hidden />
              ) : (
                <CaptionsOff className="size-5" aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={toggleSound}
              aria-pressed={muted}
              aria-label="Mute"
              className="btn-premium inline-flex size-11 shrink-0 items-center justify-center rounded-xl"
            >
              {muted ? (
                <VolumeX className="size-5" aria-hidden />
              ) : (
                <Volume2 className="size-5" aria-hidden />
              )}
            </button>
            <button
              ref={next}
              type="button"
              onClick={onDone}
              disabled={!unlocked}
              className="btn-solid ml-auto inline-flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm"
            >
              {watched || excused
                ? "Next"
                : skippable
                  ? "Skip video"
                  : duration
                    ? `Next in ${clock(duration - time)}`
                    : "Next"}
              <ArrowRight className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
