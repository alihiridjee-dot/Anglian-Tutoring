import { useRef, useState } from "react";
import { Play } from "lucide-react";

/**
 * The parents' explainer, its cover frame and its length, served from
 * `public/videos`. Browsers keep the file for four hours, so bump `?v=` when
 * the video is replaced or a visitor can go on hearing the old cut.
 */
const VIDEO = {
  src: "/videos/how-it-works.mp4?v=2",
  poster: "/videos/how-it-works.jpg",
  length: "1:14",
};

/**
 * The sales video, shown in the hero. Nothing downloads until Play is pressed,
 * so the page costs no more to open than it did. Until then the cover frame
 * carries one Watch button, in the corner so it doesn't sit on the cover's
 * headline; once it's playing, the browser's own controls take over.
 */
export function ExplainerVideo() {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  const play = () => {
    setStarted(true);
    void video.current?.play().catch(() => {});
  };

  return (
    <div className="premium-card tint-primary relative aspect-video overflow-hidden rounded-2xl">
      <video
        ref={video}
        src={VIDEO.src}
        poster={VIDEO.poster}
        preload="none"
        playsInline
        controls={started}
        aria-label="How Anglia Educate works"
        className="size-full bg-muted object-cover"
        onClick={started ? undefined : play}
        onPlay={() => setStarted(true)}
      />
      {!started && (
        <button
          type="button"
          onClick={play}
          className="btn-solid absolute bottom-3 left-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm sm:bottom-5 sm:left-5 sm:px-4"
        >
          <Play className="size-4 fill-current" aria-hidden />
          {/* A phone's card is short: the full label would sit on the cover's mascots. */}
          <span>
            Watch<span className="hidden sm:inline"> how it works</span>
          </span>
          <span className="numeral">{VIDEO.length}</span>
        </button>
      )}
    </div>
  );
}
