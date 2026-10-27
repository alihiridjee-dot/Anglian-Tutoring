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

/**
 * How long to wait for the first frames before offering Play anyway. iPhones
 * load nothing until the first tap, so waiting for them would wait for ever.
 */
const LOAD_GRACE_MS = 5000;

/**
 * As wide as the screen, or as wide as the height left after the heading and
 * the controls allows. The heading, video and controls all share it.
 */
const WIDTH =
  "w-[min(100%,calc((100dvh_-_13rem)*16/9))] short:w-[min(100%,calc((100dvh_-_4.5rem)*16/9))]";

function leaveFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
}

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
 *
 * It fills the window, and shows it's loading until the first frames are in.
 * Browsers won't start sound or go full screen without a tap, so the first
 * Play does both: full screen on computers and Android, the whole window on an
 * iPhone. Next leaves full screen again.
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
  // What goes full screen. Not the dialog: a dialog can't be made full screen.
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const furthest = useRef(0);
  const wentFullscreen = useRef(false);
  const [playing, setPlaying] = useState(false);
  // The first frames are in (or the grace period ran out): Play can be offered.
  const [ready, setReady] = useState(false);
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
    return () => {
      leaveFullscreen();
      modal?.close();
    };
  }, []);

  useEffect(() => {
    // Already loaded from the cache before the listeners were attached.
    if ((video.current?.readyState ?? 0) >= HTMLMediaElement.HAVE_CURRENT_DATA) setReady(true);
    const timer = window.setTimeout(() => setReady(true), LOAD_GRACE_MS);
    return () => window.clearTimeout(timer);
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
    else return v.pause();
    // Play first, then full screen, both inside the tap: it's what lets either
    // happen. Only the first time, so leaving full screen is respected.
    if (wentFullscreen.current) return;
    wentFullscreen.current = true;
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      void stage.current?.requestFullscreen?.().catch(() => {});
    }
  };

  const done = () => {
    leaveFullscreen();
    onDone();
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
        if (unlocked) done();
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 text-foreground backdrop:bg-transparent tint-primary"
    >
      <div
        ref={stage}
        className="page-aurora flex h-full w-full flex-col items-center justify-center gap-4 overflow-y-auto p-4 sm:p-6 short:gap-2 short:p-2"
      >
        {/* A phone on its side has no height to spare: the heading is still read out. */}
        <div className={`${WIDTH} shrink-0 short:sr-only`}>
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

        <div
          className={`${WIDTH} relative aspect-video shrink-0 overflow-hidden rounded-xl border border-border bg-muted`}
        >
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
            onLoadedData={() => setReady(true)}
            onCanPlay={() => {
              setReady(true);
              setWaiting(false);
            }}
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
          {!failed && (!ready || waiting) && (
            <div className="absolute inset-0 grid place-items-center">
              <Spinner label="Loading the video" className="" />
            </div>
          )}
          {ready && !playing && !waiting && !failed && (
            <button
              type="button"
              autoFocus
              onClick={toggle}
              aria-label={time > 0 && !watched ? "Play" : "Play the video"}
              className="btn-solid absolute inset-0 m-auto inline-flex size-20 items-center justify-center rounded-full short:size-16"
            >
              <Play className="size-9 translate-x-0.5 short:size-7" aria-hidden />
            </button>
          )}
        </div>

        {failed && (
          <div className={WIDTH}>
            <ErrorNote
              error={new Error("The video didn’t load. You can carry on without it.")}
              onRetry={retry}
            />
          </div>
        )}

        <div className={`${WIDTH} flex shrink-0 flex-wrap items-center gap-2 sm:gap-3`}>
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
            onClick={done}
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
    </dialog>
  );
}
