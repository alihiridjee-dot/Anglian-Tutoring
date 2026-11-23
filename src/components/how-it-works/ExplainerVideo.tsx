import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Play, X } from "lucide-react";

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
 * The laptop's screen in the hero photo: its four corners as fractions of the
 * photo's width and height, measured on the 1800px file. The play dot is drawn
 * on a box mapped onto these with a perspective transform, so it leans the way
 * the laptop does and looks like it is on the screen.
 */
const SCREEN = {
  tl: [0.4219, 0.08],
  tr: [0.8083, 0.205],
  br: [0.7906, 0.6758],
  bl: [0.4208, 0.5021],
} as const;
/** The MacBook's screen is 16:10. */
const SCREEN_RATIO = 10 / 16;

/**
 * The CSS transform that lays a `w` × `w·10/16` box flat on the laptop's screen
 * in a photo drawn `w` × `h`: the projective map of a rectangle onto the four
 * measured corners, with the transform origin at the box's top left.
 */
function screenTransform(w: number, h: number): string {
  const [x0, y0] = [SCREEN.tl[0] * w, SCREEN.tl[1] * h];
  const [x1, y1] = [SCREEN.tr[0] * w, SCREEN.tr[1] * h];
  const [x2, y2] = [SCREEN.br[0] * w, SCREEN.br[1] * h];
  const [x3, y3] = [SCREEN.bl[0] * w, SCREEN.bl[1] * h];
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const k = (dx1 * dy3 - dx3 * dy1) / den;
  const lw = w;
  const lh = w * SCREEN_RATIO;
  const a = (x1 - x0 + g * x1) / lw;
  const b = (x3 - x0 + k * x3) / lh;
  const d = (y1 - y0 + g * y1) / lw;
  const e = (y3 - y0 + k * y3) / lh;
  return `matrix3d(${a},${d},0,${g / lw},${b},${e},0,${k / lh},0,0,1,0,${x0},${y0},0,1)`;
}

/**
 * The hero photo, with the parents' explainer on the laptop in it. A play dot
 * sits on the laptop's screen; pressing it springs a big player out of the
 * laptop into the middle of the page, and closing it (✕, Escape or a press
 * outside) sends it back in. Nothing downloads until then, so the page costs
 * no more to open than the photo does.
 */
export function ExplainerVideo() {
  const photo = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLSpanElement>(null);
  const hit = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState({ x: 0, y: 0 });
  // The player is portalled to <body>, which the server never draws, so it
  // waits until the page has loaded or the browser's first pass won't match.
  const [mounted, setMounted] = useState(false);
  const calm = useReducedMotion();

  useEffect(() => setMounted(true), []);

  // The screen's transform is in pixels, so it is worked out again whenever
  // the photo changes size.
  useEffect(() => {
    const el = photo.current;
    if (!el) return;
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Back to the dot, so a keyboard user carries on where they were.
  const close = () => {
    setOpen(false);
    hit.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      hit.current?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // The player grows from the dot, so it starts where the dot is.
  const play = () => {
    const r = dot.current?.getBoundingClientRect();
    if (r) {
      setFrom({
        x: r.left + r.width / 2 - window.innerWidth / 2,
        y: r.top + r.height / 2 - window.innerHeight / 2,
      });
    }
    setOpen(true);
  };

  return (
    <>
      <div className="lapvid tint-primary">
        <span aria-hidden className="preview-sticker lapvid-sticker">
          🧠
        </span>
        <div ref={photo} className="lapvid-frame">
          <img
            src="/how-it-works/student-laptop-1200.webp"
            srcSet={[800, 1200, 1800]
              .map((w) => `/how-it-works/student-laptop-${w}.webp ${w}w`)
              .join(", ")}
            sizes="(min-width: 64rem) 50vw, 100vw"
            width={1800}
            height={1200}
            alt="A student at a laptop with the Anglia Educate student dashboard open"
            fetchPriority="high"
            className="size-full object-cover"
          />
          {size && (
            <div
              className="lapvid-screen"
              style={{
                width: size.w,
                height: size.w * SCREEN_RATIO,
                transform: screenTransform(size.w, size.h),
              }}
            >
              <button
                ref={hit}
                type="button"
                className="lapvid-hit"
                onClick={play}
                aria-label={`Watch how it works, ${VIDEO.length}`}
              >
                <span ref={dot} className="lapvid-dot">
                  <Play aria-hidden />
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                className="lapvid-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: calm ? 0 : 0.25 }}
                onClick={close}
              >
                <motion.div
                  role="dialog"
                  aria-modal="true"
                  aria-label="How Anglia Educate works"
                  className="lapvid-player tint-primary"
                  initial={calm ? false : { x: from.x, y: from.y, scale: 0.1, rotate: -8 }}
                  animate={{ x: 0, y: 0, scale: 1, rotate: 0 }}
                  exit={calm ? { opacity: 0 } : { x: from.x, y: from.y, scale: 0.1, rotate: -8 }}
                  transition={{ type: "spring", stiffness: 240, damping: 26 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <video
                    ref={(v) => {
                      // Mounted inside the press, so the browser lets it start
                      // with sound; once only, or a re-render would restart it.
                      if (v && !v.dataset.started) {
                        v.dataset.started = "1";
                        void v.play().catch(() => {});
                      }
                    }}
                    src={VIDEO.src}
                    poster={VIDEO.poster}
                    playsInline
                    controls
                    aria-label="How Anglia Educate works"
                    className="size-full object-contain"
                    onEnded={close}
                  />
                  <button
                    type="button"
                    onClick={close}
                    className="btn-solid lapvid-close"
                    aria-label="Close the video"
                    autoFocus
                  >
                    <X aria-hidden />
                  </button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
