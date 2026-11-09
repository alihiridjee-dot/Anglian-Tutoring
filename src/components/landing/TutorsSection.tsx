import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useInView, useReducedMotion } from "motion/react";
import { Send } from "lucide-react";
// Shared WhatsApp number (same as the floating button). The pre-filled message
// names the tutor so we know who the enquiry is about.
import { whatsappLink } from "@/lib/leads/whatsapp";

/** Each fact's emoji has its own little move when it is pointed at or tapped. */
type Trick = "beat" | "flip" | "think" | "toss" | "ring" | "swing" | "fizz";

type Fact = {
  emoji: string;
  trick: Trick;
  text: string;
  /** A figure counted up from 0 as the card arrives, shown before `text`. */
  count?: number;
  /** Lists the tutor's agencies under this line. */
  agencies?: boolean;
};

type Tutor = {
  id: string;
  name: string;
  firstName: string;
  role: string;
  /** Kit tint class: the card, its stickers, buttons and shadow all follow it. */
  tint: string;
  bio: string;
  agencies: { name: string; logo: string }[];
  image: string;
  /** How the photo is cropped into the 4:5 card, and how far it leans. Nadia's
      photo is square and Ali's a 3:4 portrait with his face low and right of
      centre, so each needs its own zoom and focal point. */
  photo: { size: string; position: string; tilt: string };
  /** The same for the round avatar on the chat side. */
  avatar: { size: string; position: string };
  /** Three emoji stuck round the photo, each with a line it says when tapped. */
  stickers: { emoji: string; says: string }[];
  /** What the speech bubble on the photo says, in turn. */
  lines: string[];
  heart: string;
  facts: Fact[];
};

const TUTORS: Tutor[] = [
  {
    id: "nadia",
    name: "Dr Nadia",
    firstName: "Nadia",
    role: "Head of Curriculum & Assessment",
    tint: "tint-emerald",
    bio: "Practising NHS Doctor and science tutor of 10+ years, having taught students across the region to excellent GCSE results. Specialises in Biology and Chemistry.",
    agencies: [],
    image: "/tutors/nadia.jpg",
    photo: { size: "125% auto", position: "37.5% 0", tilt: "-2.5deg" },
    avatar: { size: "200%", position: "47% 30%" },
    stickers: [
      { emoji: "🧬", says: "Biology is my speciality" },
      { emoji: "🩺", says: "Yes, a real doctor!" },
      { emoji: "🔬", says: "And Chemistry too" },
    ],
    lines: [
      "Hi! Nice to meet you 👋\nI'm Nadia.",
      "Biology and Chemistry are my favourites 🧬",
      "Got a question? Tap Chat with Nadia 💬",
    ],
    heart: "💚",
    facts: [
      { emoji: "🩺", trick: "beat", text: "Practising NHS doctor" },
      { emoji: "📚", trick: "flip", count: 10, text: "+ years of tutoring" },
      {
        emoji: "🧠",
        trick: "think",
        text: "BSc (Hons) Neuroscience, Queen Mary University of London",
      },
      { emoji: "🎓", trick: "toss", text: "MBChB, Anglia Ruskin University" },
    ],
  },
  {
    id: "ali",
    name: "Ali",
    firstName: "Ali",
    role: "Head of Teaching & Learning",
    tint: "tint-primary",
    bio: "UCL graduate now training as a doctor, and an expert across KS3, GCSE and A Level. Passionate about making science accessible and building strong problem-solving foundations.",
    agencies: [
      { name: "Dulwich Tutors", logo: "/agencies/dulwich-tutors.png" },
      { name: "Ivy Education", logo: "/agencies/ivy-education.png" },
      { name: "Bonas MacFarlane", logo: "/agencies/bonas-macfarlane.svg" },
    ],
    image: "/tutors/ali.jpg",
    photo: { size: "166.7% auto", position: "61.7% 50.5%", tilt: "2.5deg" },
    avatar: { size: "230%", position: "53% 46%" },
    stickers: [
      { emoji: "⚡", says: "I love making science simple" },
      { emoji: "🧪", says: "Studied Chemistry at UCL" },
      { emoji: "🧲", says: "Problem-solving is my thing" },
    ],
    lines: [
      "Hi! Nice to meet you 👋\nI'm Ali.",
      "I teach KS3, GCSE and A Level ⚡",
      "Got a question? Tap Chat with Ali 💬",
    ],
    heart: "💙",
    facts: [
      { emoji: "⏱️", trick: "ring", count: 1500, text: "+ hours of teaching" },
      {
        emoji: "🏅",
        trick: "swing",
        text: "Accredited with 3 of London's top tutoring agencies",
        agencies: true,
      },
      {
        emoji: "🧪",
        trick: "fizz",
        text: "BSc Synthetic Organic Chemistry & Biomedical Sciences, UCL",
      },
      { emoji: "🎓", trick: "toss", text: "MBChB, Anglia Ruskin University" },
    ],
  },
];

/** Questions a parent can tap to drop into the box, ready to send. */
const ASKS = [
  "How do the lessons work? 🧑‍🏫",
  "Do you teach my exam board? 📚",
  "How much does it cost? 💷",
];

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A puff of emoji flying out from a point on screen. */
function burst(x: number, y: number, emoji: string[], count = 16) {
  if (prefersReducedMotion()) return;
  for (let i = 0; i < count; i++) {
    const bit = document.createElement("span");
    bit.className = "tutor-burst";
    bit.textContent = emoji[i % emoji.length];
    bit.style.left = `${x}px`;
    bit.style.top = `${y}px`;
    document.body.appendChild(bit);
    const angle = Math.random() * Math.PI * 2;
    const reach = 70 + Math.random() * 110;
    const dx = Math.cos(angle) * reach;
    const dy = Math.sin(angle) * reach - 50;
    bit.animate(
      [
        { transform: "translate(-50%, -50%) scale(0.3)", opacity: 1 },
        {
          transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.1) rotate(${(Math.random() - 0.5) * 80}deg)`,
          opacity: 0,
        },
      ],
      { duration: 900 + Math.random() * 400, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
    ).onfinish = () => bit.remove();
  }
}

function burstFrom(el: Element, emoji: string[], count?: number) {
  const r = el.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2, emoji, count);
}

export function TutorsSection() {
  const sectionRef = useRef<HTMLElement>(null);
  // Lights the highlighter and draws the doodles once the section is on screen.
  const lit = useInView(sectionRef, { once: true, amount: 0.1 });

  return (
    <section
      ref={sectionRef}
      id="tutors"
      data-lit={lit}
      className="tutors-section relative border-t border-border bg-card py-20 lg:py-24"
    >
      <ScienceDoodles sectionRef={sectionRef} />

      <div className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6">
        <div className="mb-12 grid items-end gap-5 md:mb-16 md:grid-cols-2 md:gap-12">
          <h2 className="text-foreground text-4xl font-extrabold sm:text-5xl">
            Meet your <span className="tutor-highlight">expert</span> tutors <WaveHand />
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Small team. Big results. Every lesson is taught personally by Dr Nadia or Ali — no
            rotating agency tutors. Tap a tutor to say hello and ask a question!
          </p>
        </div>

        {/* Grid rows stretch, so the two cards are always the same height. */}
        <div className="grid gap-10 md:grid-cols-2 md:gap-12">
          {TUTORS.map((t, i) => (
            <TutorCard key={t.id} tutor={t} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

/** The 👋 in the heading. It waves on its own, and waves back when tapped. */
function WaveHand() {
  return (
    <span
      aria-hidden
      className="tutor-wave"
      onClick={(e) => {
        const hand = e.currentTarget;
        delete hand.dataset.go;
        void hand.offsetWidth; // restart the animation
        hand.dataset.go = "";
        burstFrom(hand, ["👋", "🙌", "✨"], 12);
      }}
      onAnimationEnd={(e) => delete e.currentTarget.dataset.go}
    >
      👋
    </span>
  );
}

function TutorCard({ tutor: t, index }: { tutor: Tutor; index: number }) {
  const cardRef = useRef<HTMLElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);
  const chatButtonRef = useRef<HTMLButtonElement>(null);
  const inView = useInView(cardRef, { once: true, amount: 0.2 });
  const reduce = useReducedMotion() ?? false;
  const [flipped, setFlipped] = useState(false);
  // Bumped on every open, so the chat starts fresh each time it turns over.
  const [opens, setOpens] = useState(0);

  // The card hides for its entrance only when it starts below the fold. A card
  // already on screen, or a page whose script never runs, is never blank.
  useEffect(() => {
    const card = cardRef.current;
    if (!card || prefersReducedMotion()) return;
    if (card.getBoundingClientRect().top > window.innerHeight) card.dataset.armed = "";
  }, []);

  // The photo leans towards the pointer.
  const tilt = (e: React.MouseEvent) => {
    const photo = photoRef.current;
    if (!photo || reduce || flipped) return;
    const r = photo.getBoundingClientRect();
    const clamp = (v: number) => Math.max(-0.6, Math.min(0.6, v));
    photo.style.setProperty("--ry", `${clamp((e.clientX - r.left) / r.width - 0.5) * 14}deg`);
    photo.style.setProperty("--rx", `${clamp(0.5 - (e.clientY - r.top) / r.height) * 14}deg`);
  };
  const untilt = () => {
    photoRef.current?.style.setProperty("--ry", "0deg");
    photoRef.current?.style.setProperty("--rx", "0deg");
  };

  const openChat = (e: React.MouseEvent<HTMLButtonElement>) => {
    burstFrom(e.currentTarget, ["💬", "👋", "🎉"]);
    setOpens((n) => n + 1);
    window.setTimeout(() => setFlipped(true), reduce ? 0 : 180);
  };
  const closeChat = () => {
    setFlipped(false);
    // After the front stops being inert.
    requestAnimationFrame(() => chatButtonRef.current?.focus({ preventScroll: true }));
  };

  return (
    <article
      ref={cardRef}
      data-in={inView}
      data-flipped={flipped}
      className={`tutor-card flip-card ${t.tint}`}
      style={
        {
          "--deal": index % 2 ? "5deg" : "-5deg",
          "--deal-delay": `${index * 180}ms`,
        } as CSSProperties
      }
    >
      <div className={`flip-card-inner h-full ${flipped ? "is-flipped" : ""}`}>
        <div
          inert={flipped}
          onMouseMove={tilt}
          onMouseLeave={untilt}
          className="flip-face flip-front premium-card tutor-face flex flex-col p-5 pt-6 sm:px-8 sm:pt-8 sm:pb-8"
        >
          <div className="tutor-stage">
            <div
              ref={photoRef}
              role="img"
              aria-label={t.name}
              className="tutor-photo"
              style={
                {
                  backgroundImage: `url(${t.image})`,
                  backgroundSize: t.photo.size,
                  backgroundPosition: t.photo.position,
                  "--tilt": t.photo.tilt,
                } as CSSProperties
              }
              onClick={(e) =>
                burst(e.clientX, e.clientY, [...t.stickers.map((s) => s.emoji), t.heart], 14)
              }
            />
            {t.stickers.map((s, i) => (
              <PhotoSticker key={s.emoji} emoji={s.emoji} says={s.says} slot={i + 1} />
            ))}
            <SpeechBubble lines={t.lines} run={inView && !flipped} reduce={reduce} />
          </div>

          <h3 className="text-foreground text-3xl font-extrabold">
            <span className="tutor-name">
              {t.name}
              <svg
                aria-hidden
                className="tutor-squiggle"
                viewBox="0 0 120 12"
                preserveAspectRatio="none"
              >
                <path pathLength={1} d="M2 7 Q 12 1 22 7 T 42 7 T 62 7 T 82 7 T 102 7 T 118 6" />
              </svg>
            </span>
          </h3>
          <p className="tutor-role mt-4 text-[1.0625rem] font-bold">{t.role}</p>
          <p className="text-muted-foreground mt-3 text-base leading-relaxed sm:text-[1.0625rem]">
            {t.bio}
          </p>

          <ul className="tutor-facts mt-5 grid gap-2.5">
            {t.facts.map((f, i) => (
              <li
                key={f.text}
                style={{ "--i": i } as CSSProperties}
                // Phones have no hover, so a tap plays the emoji's move.
                onClick={(e) => {
                  const li = e.currentTarget;
                  delete li.dataset.play;
                  void li.offsetWidth;
                  li.dataset.play = "";
                  window.setTimeout(() => delete li.dataset.play, 1100);
                }}
              >
                <span aria-hidden className="tutor-fact-emoji">
                  <i data-trick={f.trick}>{f.emoji}</i>
                </span>
                <span>
                  {f.count != null && <CountUp to={f.count} run={inView} reduce={reduce} />}
                  {f.text}
                  {f.agencies && t.agencies.length > 0 && <Agencies list={t.agencies} />}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-auto pt-7">
            <button
              ref={chatButtonRef}
              type="button"
              onClick={openChat}
              className="btn-solid tutor-chat-button inline-flex min-h-11 items-center gap-2.5 rounded-2xl px-5 py-3.5 text-base font-bold"
            >
              <span aria-hidden className="tutor-chat-emoji">
                💬
              </span>
              Chat with {t.firstName}
            </button>
          </div>
        </div>

        <div
          inert={!flipped}
          onKeyDown={(e) => {
            if (e.key === "Escape") closeChat();
          }}
          className="flip-face flip-back premium-card tutor-face relative"
        >
          <TutorChat key={opens} tutor={t} open={flipped} reduce={reduce} onClose={closeChat} />
        </div>
      </div>
    </article>
  );
}

/** An emoji stuck on the photo. Pull it off and it springs back; tap it (or
    point at it) and it says its line. */
function PhotoSticker({ emoji, says, slot }: { emoji: string; says: string; slot: number }) {
  const [talking, setTalking] = useState(false);
  const dragged = useRef(false);
  const quiet = useRef(0);
  useEffect(() => () => window.clearTimeout(quiet.current), []);

  const startDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const y0 = e.clientY;
    dragged.current = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      if (!dragged.current) {
        if (Math.hypot(dx, dy) < 6) return;
        dragged.current = true;
        el.dataset.dragging = "";
        setTalking(false);
      }
      el.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 5}deg) scale(1.18)`;
    };
    const drop = () => {
      delete el.dataset.dragging;
      el.style.transform = "";
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", drop);
      el.removeEventListener("pointercancel", drop);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", drop);
    el.addEventListener("pointercancel", drop);
  };

  return (
    <button
      type="button"
      aria-label={says}
      data-talking={talking || undefined}
      className={`tutor-sticker tutor-sticker-${slot}`}
      onPointerDown={startDrag}
      onClick={() => {
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        setTalking(true);
        window.clearTimeout(quiet.current);
        quiet.current = window.setTimeout(() => setTalking(false), 2200);
      }}
    >
      <span aria-hidden className="tutor-sticker-face">
        {emoji}
      </span>
      <span aria-hidden className="tutor-tip">
        {says}
      </span>
    </button>
  );
}

function TypingDots() {
  return (
    <span className="tutor-dots" aria-label="Typing">
      <i />
      <i />
      <i />
    </span>
  );
}

/** The bubble on the photo: types, says a line, waits, types the next. */
function SpeechBubble({ lines, run, reduce }: { lines: string[]; run: boolean; reduce: boolean }) {
  const [step, setStep] = useState({ show: false, said: false, line: 0 });

  useEffect(() => {
    if (!run || reduce) return;
    let i = 0;
    let timer = 0;
    const next = () => {
      setStep((s) => ({ ...s, show: true, said: false }));
      timer = window.setTimeout(() => {
        setStep({ show: true, said: true, line: i++ % lines.length });
        timer = window.setTimeout(next, 3400);
      }, 1000);
    };
    timer = window.setTimeout(next, 800);
    return () => window.clearTimeout(timer);
  }, [run, reduce, lines]);

  const said = reduce || step.said;
  return (
    <div aria-hidden className="tutor-bubble" data-show={reduce || step.show}>
      {said ? <span className="tutor-bubble-text">{lines[step.line]}</span> : <TypingDots />}
    </div>
  );
}

/** A figure that counts up from 0 once the card is on screen. */
function CountUp({ to, run, reduce }: { to: number; run: boolean; reduce: boolean }) {
  const [n, setN] = useState(to);

  useEffect(() => {
    if (!run || reduce) return;
    let frame = 0;
    const wait = window.setTimeout(() => {
      const t0 = performance.now();
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / 1300);
        setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }, 900);
    return () => {
      window.clearTimeout(wait);
      cancelAnimationFrame(frame);
    };
  }, [run, reduce, to]);

  return <b className="numeral tutor-count">{n.toLocaleString("en-GB")}</b>;
}

/** The agencies a tutor is accredited with: crests in a stack, names beside. */
function Agencies({ list }: { list: { name: string; logo: string }[] }) {
  const names = list.map((a) => a.name);
  const sentence =
    names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  return (
    <span className="tutor-agencies">
      <span className="tutor-crests">
        {list.map((a) => (
          <span key={a.name}>
            <img src={a.logo} alt="" loading="lazy" />
          </span>
        ))}
      </span>
      <span className="tutor-agency-names">{sentence}</span>
    </span>
  );
}

/** The back of the card: a short chat that hands off to WhatsApp. */
function TutorChat({
  tutor: t,
  open,
  reduce,
  onClose,
}: {
  tutor: Tutor;
  open: boolean;
  reduce: boolean;
  onClose: () => void;
}) {
  const [said, setSaid] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLSpanElement>(null);

  // The greeting types for a moment, then the box takes the focus.
  useEffect(() => {
    if (!open) return;
    const typed = window.setTimeout(() => setSaid(true), reduce ? 0 : 1500);
    const focus = window.setTimeout(
      () => boxRef.current?.focus({ preventScroll: true }),
      reduce ? 0 : 700,
    );
    return () => {
      window.clearTimeout(typed);
      window.clearTimeout(focus);
    };
  }, [open, reduce]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [sent.length]);

  const sendToWhatsApp = (button: HTMLElement) => {
    const text = message.trim();
    window.open(
      whatsappLink(
        `Hi ${t.firstName}! I saw your profile on the Anglia Educate site.` +
          (text ? `\n\n${text}` : ""),
      ),
      "_blank",
      "noopener,noreferrer",
    );
    setSent((s) => [...s, text || `Hi ${t.firstName}! 👋`]);
    setMessage("");
    if (!reduce) {
      planeRef.current?.animate(
        [
          { transform: "translate(0, 0)", opacity: 1 },
          { transform: "translate(70px, -34px) rotate(12deg)", opacity: 0, offset: 0.45 },
          { transform: "translate(-40px, 14px)", opacity: 0, offset: 0.5 },
          { transform: "translate(0, 0)", opacity: 1 },
        ],
        { duration: 950, easing: "ease-in-out" },
      );
    }
    burstFrom(button, ["💬", "✅", "📱", "🎉"]);
  };

  const greeted = reduce || said;

  return (
    <div className="tutor-chat">
      <button
        type="button"
        onClick={onClose}
        className="btn-soft inline-flex min-h-11 items-center self-start rounded-xl px-3.5 text-[0.9375rem] font-bold"
      >
        ← Back to {t.firstName}
      </button>

      <div className="mt-1 mb-4 text-center">
        <div className="tutor-ring">
          <span
            aria-hidden
            className="tutor-avatar"
            style={{
              backgroundImage: `url(${t.image})`,
              backgroundSize: t.avatar.size,
              backgroundPosition: t.avatar.position,
            }}
          />
          <span aria-hidden className="tutor-orbit">
            {t.stickers.map((s) => (
              <b key={s.emoji}>{s.emoji}</b>
            ))}
          </span>
        </div>
        <h4 className="text-foreground text-2xl font-extrabold">{t.name}</h4>
        <p className="tutor-role mt-1 text-[0.9375rem] font-bold">Replies on WhatsApp</p>
      </div>

      <div ref={threadRef} className="surface-loud tutor-thread" data-said={greeted}>
        <p className="tutor-msg-in" aria-live="polite">
          {greeted ? (
            <>
              Hi! Nice to meet you 👋 I&apos;m {t.firstName}. Do you have any questions about
              tutoring? Ask away and I&apos;ll get straight back to you on WhatsApp.
            </>
          ) : (
            <TypingDots />
          )}
        </p>
        {sent.length === 0 && (
          <div className="tutor-asks">
            {ASKS.map((q) => (
              <button
                key={q}
                type="button"
                tabIndex={greeted ? 0 : -1}
                onClick={() => {
                  setMessage(q);
                  boxRef.current?.focus({ preventScroll: true });
                }}
                className="btn-soft tutor-ask min-h-11 px-3.5 py-2.5 text-[0.9375rem] font-bold"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        {sent.map((m, i) => (
          <p key={i} className="tutor-msg-out">
            {m}
          </p>
        ))}
        {sent.length > 0 && (
          <p className="tutor-note pop-in" style={{ "--pop-delay": "0.4s" } as CSSProperties}>
            Opening WhatsApp… 📱
          </p>
        )}
      </div>

      <div className="mt-3.5 grid gap-3">
        <textarea
          ref={boxRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              sendToWhatsApp(e.currentTarget);
            }
          }}
          rows={3}
          aria-label={`Your question for ${t.firstName}`}
          placeholder={`Type your question for ${t.firstName}…`}
          className="pop-input w-full resize-none px-4 py-3 text-[0.9375rem] font-semibold"
        />
        <button
          type="button"
          onClick={(e) => sendToWhatsApp(e.currentTarget)}
          className="group inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl border-[1.5px] border-[#128C7E] bg-[#25D366] px-5 py-3.5 text-base font-extrabold text-white shadow-[0_4px_0_0_#128C7E] transition-[transform,box-shadow,filter] hover:brightness-105 active:translate-y-[3px] active:shadow-[0_1px_0_0_#128C7E]"
        >
          <span ref={planeRef} className="inline-flex">
            <Send className="size-4" aria-hidden />
          </span>
          Send on WhatsApp
        </button>
      </div>
    </div>
  );
}

/** Line drawings of science in the margins, drawn in as the section arrives and
    drifting at different speeds as the page scrolls. Wide screens only: on
    anything narrower there is no margin for them to sit in. */
const DOODLES: {
  name: string;
  tint: string;
  speed: number;
  at: CSSProperties;
  draw: string;
  drift: string;
  viewBox: string;
  shapes: React.ReactNode;
}[] = [
  {
    name: "atom",
    tint: "tint-primary",
    speed: 0.18,
    at: { left: "2%", top: "7%", width: 92, height: 92 },
    draw: "0.2s",
    drift: "0s",
    viewBox: "0 0 64 64",
    shapes: (
      <>
        <ellipse pathLength={1} cx="32" cy="32" rx="28" ry="10" />
        <ellipse pathLength={1} cx="32" cy="32" rx="28" ry="10" transform="rotate(60 32 32)" />
        <ellipse pathLength={1} cx="32" cy="32" rx="28" ry="10" transform="rotate(120 32 32)" />
        <circle className="tutor-doodle-dot" cx="32" cy="32" r="4" />
      </>
    ),
  },
  {
    name: "benzene",
    tint: "tint-emerald",
    speed: -0.12,
    at: { right: "4%", top: "22%", width: 84, height: 84 },
    draw: "0.4s",
    drift: "-2s",
    viewBox: "0 0 64 64",
    shapes: (
      <>
        <path pathLength={1} d="M32 4 L56 18 L56 46 L32 60 L8 46 L8 18 Z" />
        <circle pathLength={1} cx="32" cy="32" r="13" />
      </>
    ),
  },
  {
    name: "flask",
    tint: "tint-pop",
    speed: 0.22,
    at: { left: "2.5%", top: "52%", width: 76, height: 76 },
    draw: "0.6s",
    drift: "-4s",
    viewBox: "0 0 64 64",
    shapes: (
      <>
        <path
          pathLength={1}
          d="M24 6 H40 M27 6 V24 L10 54 Q8 58 13 58 H51 Q56 58 54 54 L37 24 V6"
        />
        <path pathLength={1} d="M17 44 H47" />
      </>
    ),
  },
  {
    name: "lightning",
    tint: "tint-primary",
    speed: -0.2,
    at: { right: "3%", top: "60%", width: 62, height: 62 },
    draw: "0.8s",
    drift: "-1s",
    viewBox: "0 0 64 64",
    shapes: <path pathLength={1} d="M36 4 L14 36 H32 L26 60 L50 26 H32 Z" />,
  },
  {
    name: "sparkle",
    tint: "tint-pop",
    speed: 0.1,
    at: { right: "2.5%", top: "3%", width: 48, height: 48 },
    draw: "1s",
    drift: "-3s",
    viewBox: "0 0 64 64",
    shapes: <path pathLength={1} d="M32 4 Q34 30 60 32 Q34 34 32 60 Q30 34 4 32 Q30 30 32 4 Z" />,
  },
  {
    name: "dna",
    tint: "tint-emerald",
    speed: 0.16,
    at: { left: "5%", top: "80%", width: 56, height: 110 },
    draw: "1.1s",
    drift: "-5s",
    viewBox: "0 0 40 80",
    shapes: (
      <>
        <path pathLength={1} d="M8 2 C 8 22, 32 22, 32 40 S 8 58, 8 78" />
        <path pathLength={1} d="M32 2 C 32 22, 8 22, 8 40 S 32 58, 32 78" />
        <path pathLength={1} d="M12 12 H28 M12 30 H28 M12 50 H28 M12 68 H28" />
      </>
    ),
  },
  {
    name: "sparkle-small",
    tint: "tint-emerald",
    speed: -0.08,
    at: { right: "6%", top: "88%", width: 40, height: 40 },
    draw: "1.2s",
    drift: "-2.5s",
    viewBox: "0 0 64 64",
    shapes: <path pathLength={1} d="M32 4 Q34 30 60 32 Q34 34 32 60 Q30 34 4 32 Q30 30 32 4 Z" />,
  },
];

function ScienceDoodles({ sectionRef }: { sectionRef: RefObject<HTMLElement | null> }) {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || prefersReducedMotion()) return;
    const doodles = [...layer.querySelectorAll<HTMLElement>("[data-speed]")];
    let frame = 0;
    const place = () => {
      frame = 0;
      const section = sectionRef.current;
      if (!section) return;
      const r = section.getBoundingClientRect();
      const off = r.top + r.height / 2 - window.innerHeight / 2;
      for (const d of doodles)
        d.style.translate = `0 ${(off * Number(d.dataset.speed)).toFixed(1)}px`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [sectionRef]);

  return (
    <div ref={layerRef} aria-hidden className="tutor-doodles hidden xl:block">
      {DOODLES.map((d) => (
        <div
          key={d.name}
          data-speed={d.speed}
          className={`tutor-doodle ${d.tint}`}
          style={{ ...d.at, "--draw": d.draw, "--drift": d.drift } as CSSProperties}
        >
          <svg viewBox={d.viewBox}>{d.shapes}</svg>
        </div>
      ))}
    </div>
  );
}
