import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check } from "lucide-react";

import {
  ChatMock,
  FeedbackMock,
  HomeworkMock,
  LiveMock,
  ParentMock,
  PredictorMock,
  ProgrammeMock,
  QuizMock,
} from "@/components/how-it-works/ServicePreviews";
import { SectionSeam } from "@/components/landing/SectionSeam";

type Feature = {
  id: string;
  emoji: string;
  title: string;
  desc: string;
  /** Only the two features a place is built on carry their reasons. */
  points?: string[];
  preview: () => React.JSX.Element;
  tint: string;
};

// The two things a place is built on come first: live teaching, and a
// programme that belongs to one child. Everything after supports those two.
// Accurate to the platform as built: each is a real screen, shown as a small
// mock-up rather than described.
const FEATURES: Feature[] = [
  {
    id: "live",
    emoji: "🎥",
    title: "Up to 3 live sessions a week",
    desc: "Small-group lessons on Zoom with Dr Nadia or Ali. Your child asks questions as they go, and their tutor can see who is keeping up.",
    points: [
      "Taught to your child's exam board, spec point by spec point",
      "Recorded, so a missed week can be caught up",
      "The same two tutors every week, never an agency",
    ],
    preview: LiveMock,
    tint: "tint-primary",
  },
  {
    id: "programme",
    emoji: "🗺️",
    title: "A plan built around your child",
    desc: "We lay out the whole course from the week your child joins to their exam date. Each week they know exactly what to learn, and what to revisit.",
    points: [
      "Set to their exam board, level and exam date",
      "Weak topics come back, based on their marked work",
      "Reviewed and adjusted by their tutor every week",
    ],
    preview: ProgrammeMock,
    tint: "tint-accent",
  },
  {
    id: "homework",
    emoji: "✍️",
    title: "Tasks marked by their tutor",
    desc: "A grade and written comments within 48 hours, from the tutor who taught it.",
    preview: HomeworkMock,
    tint: "tint-bio",
  },
  {
    id: "quiz",
    emoji: "❓",
    title: "A weekly quiz",
    desc: "Short multiple-choice quizzes on what they've covered, with instant explanations.",
    preview: QuizMock,
    tint: "tint-chem",
  },
  {
    id: "note",
    emoji: "💌",
    title: "A weekly note from their tutor",
    desc: "What clicked, what didn't, and what they're working on next week.",
    preview: FeedbackMock,
    tint: "tint-phys",
  },
  {
    id: "messages",
    emoji: "💬",
    title: "Message their tutor",
    desc: "Stuck between lessons? Ask in the platform, and their tutor replies.",
    preview: ChatMock,
    tint: "tint-primary",
  },
  {
    id: "predictor",
    emoji: "📈",
    title: "A predicted grade",
    desc: "Worked out from their marked tasks and quizzes, so it moves as they improve.",
    preview: PredictorMock,
    tint: "tint-amber",
  },
  {
    id: "parent",
    emoji: "👪",
    title: "Your own parent login",
    desc: "See attendance, tasks, scores and their predicted grade at any time.",
    preview: ParentMock,
    tint: "tint-accent",
  },
];

/** Degrees between one feature's notch on the dial and the next. */
const NOTCH = 26;
/** Each preview leans a little, alternately, so the set doesn't look stamped out. */
const TILT = ["-2deg", "2deg", "-1.5deg", "1.5deg", "-2deg", "1deg", "-1deg", "2deg"];

export function OfferSection() {
  return (
    <section id="offer" className="bg-secondary/50 pb-20 lg:pb-24">
      <SectionSeam from="var(--card)" className="mb-12 lg:mb-16" />
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-foreground mx-auto max-w-2xl text-center text-4xl font-extrabold sm:text-5xl">
          A personal programme, <span className="marker">taught live</span>
        </h2>
        <OfferStory />
      </div>
    </section>
  );
}

/**
 * The features as a scroll story. On a wide screen the words scroll on the
 * left while one preview at a time holds still on the right, and a half-moon
 * dial on the screen's edge turns with the scroll. The feature in view is lit
 * by a see-through shadow in its colour, behind its words and around its
 * preview, which fades as the next one comes up. On a narrower screen each
 * feature simply shows its preview under its words.
 *
 * The scroll position drives `--turn` and each feature's `--glow` (1 when it is
 * centred on screen, 0 by halfway to the next) straight onto the elements, so a
 * scroll re-renders nothing until the feature in view changes.
 */
function OfferStory() {
  const storyRef = useRef<HTMLDivElement>(null);
  const dialRef = useRef<HTMLElement>(null);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);
  const shotRefs = useRef<(HTMLDivElement | null)[]>([]);
  const knobRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [dialOn, setDialOn] = useState(false);

  useEffect(() => {
    const wide = window.matchMedia("(width >= 64rem)");
    let frame = 0;
    const turn = () => {
      frame = 0;
      if (!wide.matches) return;
      const steps = stepRefs.current;
      const mid = window.innerHeight / 2;
      const centres = steps.map((s) => {
        const r = s?.getBoundingClientRect();
        return r ? r.top + r.height / 2 : 0;
      });
      // How far through the story the reader is: 2.5 is halfway from the third
      // feature to the fourth.
      let p = centres.length - 1;
      if (mid <= centres[0]) p = 0;
      else {
        for (let i = 0; i < centres.length - 1; i++) {
          if (mid < centres[i + 1]) {
            p = i + (mid - centres[i]) / (centres[i + 1] - centres[i]);
            break;
          }
        }
      }
      dialRef.current?.style.setProperty("--turn", `${p * NOTCH}deg`);
      steps.forEach((step, j) => {
        const d = Math.abs(j - p);
        const glow = Math.max(0, 1 - d * 2).toFixed(3);
        step?.style.setProperty("--glow", glow);
        shotRefs.current[j]?.style.setProperty("--glow", glow);
        const knob = knobRefs.current[j];
        if (knob) {
          knob.style.setProperty("--k", (1.35 - Math.min(d, 1) * 0.5).toFixed(3));
          knob.style.opacity = d < 0.5 ? "1" : Math.max(0, Math.min(0.5, 3.4 - d)).toFixed(2);
        }
      });
      setActive(Math.round(p));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(turn);
    };
    turn();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    // The dial slides in while the story is on screen, and away after it.
    const story = storyRef.current;
    const seen = new IntersectionObserver(([e]) => setDialOn(e.isIntersecting), {
      rootMargin: "-30% 0px -30% 0px",
    });
    if (story) seen.observe(story);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
      seen.disconnect();
    };
  }, []);

  const jumpTo = (i: number) => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    stepRefs.current[i]?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
  };

  return (
    <div ref={storyRef} className="offer-story mt-12 lg:mt-16">
      <ol className="offer-steps">
        {FEATURES.map((f, i) => {
          const Preview = f.preview;
          return (
            <li
              key={f.id}
              ref={(el) => {
                stepRefs.current[i] = el;
              }}
              data-active={i === active || undefined}
              className={`offer-step ${f.tint}`}
            >
              <div className="offer-text">
                <span aria-hidden className="offer-emoji">
                  {f.emoji}
                </span>
                <h3 className="text-foreground mt-3 text-3xl font-extrabold sm:text-4xl">
                  {f.title}
                </h3>
                <p className="text-muted-foreground mt-3 text-[1.0625rem] leading-relaxed">
                  {f.desc}
                </p>
                {f.points && (
                  <ul className="mt-5 grid gap-2.5">
                    {f.points.map((pt) => (
                      <li
                        key={pt}
                        className="text-foreground flex items-start gap-2.5 text-[0.97rem] font-semibold"
                      >
                        <Check className="offer-tick mt-0.5 size-4 shrink-0" aria-hidden />
                        {pt}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {/* Narrower screens: the preview sits under its words. */}
              <div className="offer-inline-shot" style={{ "--r": TILT[i] } as CSSProperties}>
                <Preview />
              </div>
            </li>
          );
        })}
      </ol>

      <div className="offer-stage" aria-hidden>
        {FEATURES.map((f, i) => {
          const Preview = f.preview;
          return (
            <div
              key={f.id}
              ref={(el) => {
                shotRefs.current[i] = el;
              }}
              data-state={i === active ? "active" : i < active ? "gone" : "next"}
              className={`offer-stage-shot ${f.tint}`}
              style={{ "--r": TILT[i] } as CSSProperties}
            >
              <Preview />
            </div>
          );
        })}
      </div>

      <nav
        ref={dialRef}
        aria-label="Features"
        inert={!dialOn}
        data-on={dialOn}
        className={`offer-dial ${FEATURES[active].tint}`}
      >
        <div className="offer-dial-face" />
        <div className="offer-dial-wheel">
          <svg className="offer-dial-ticks" viewBox="-215 -215 430 430" aria-hidden>
            <circle className="track" r="175" />
            <circle className="marks" r="203" pathLength={360} />
          </svg>
          {FEATURES.map((f, i) => (
            <button
              key={f.id}
              ref={(el) => {
                knobRefs.current[i] = el;
              }}
              type="button"
              aria-label={f.title}
              aria-current={i === active ? "step" : undefined}
              className="offer-knob"
              style={{ "--a": `${180 - i * NOTCH}deg` } as CSSProperties}
              onClick={() => jumpTo(i)}
            >
              <span aria-hidden>{f.emoji}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
