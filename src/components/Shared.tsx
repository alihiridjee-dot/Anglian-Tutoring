/**
 * The shared vocabulary every screen is built from.
 *
 * Before this file each page derived its own heading, empty state and loading
 * treatment, which is why they had all drifted apart. A page should reach for
 * these rather than hand-rolling a fourth variant of the same block — that is
 * what keeps the marketing pages, onboarding and the signed-in app looking
 * like one product.
 *
 * The surface treatments themselves live in `styles.css` (`.pop-card`,
 * `.btn-hero`, `.sticker`…); these components only decide layout and which of
 * those classes a given block earns.
 */
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Confetti, Mascot, Sparkles, type MascotName, type Mood } from "@/components/Doodles";

/**
 * Page heading used by every screen, so they all start the same way.
 *
 * The title is set large and in the display face: these are short pages, and
 * the heading is what tells someone which one they are on at a glance.
 */
export function PageHeader({
  eyebrow,
  title,
  lede,
  icon: Icon,
  children,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  icon?: LucideIcon;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="font-display mt-2 flex items-center gap-3 text-3xl font-extrabold sm:text-4xl">
          {Icon ? (
            <span className="icon-tile size-10 shrink-0 sm:size-11">
              <Icon className="size-5 sm:size-6" aria-hidden />
            </span>
          ) : null}
          <span className="min-w-0">{title}</span>
        </h1>
        {lede ? (
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">{lede}</p>
        ) : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

/** Small heading inside a page, for the second and third block down. */
export function SectionHeading({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-display text-lg font-extrabold sm:text-xl">{title}</h2>
        {hint ? <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

/**
 * The empty state — and the main home of the doodle cast.
 *
 * Used heavily: a student with nothing set, a tutor with an unseeded spec, a
 * marking queue that is (happily) empty. An empty screen with a character and a
 * line of dry copy is the difference between "not built" and "nothing to do
 * right now", and it is the cheapest place in the app to have a personality.
 */
export function EmptyState({
  title,
  body,
  action,
  mascot = "books",
  mood = "sleepy",
}: {
  title: string;
  body: string;
  action?: { to: string; label: string };
  mascot?: MascotName;
  mood?: Mood;
}) {
  return (
    <div className="pop-card flex flex-col items-center px-6 py-10 text-center">
      <Mascot name={mascot} mood={mood} size={104} className="mb-4" />
      <h3 className="font-display text-xl font-extrabold">{title}</h3>
      <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm leading-relaxed">{body}</p>
      {action ? (
        <Link
          to={action.to as never}
          className="btn-soft mt-6 inline-flex items-center rounded-xl px-5 py-2.5 text-sm"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Loading.
 *
 * Three bouncing blocks rather than a spinner: it reads as the page building
 * itself, and it matches the blocky vocabulary the rest of the kit uses.
 */
export function Spinner({
  label = "Loading",
  className = "py-20",
}: {
  label?: string;
  /** Override the vertical padding when this sits inside a panel, not a page. */
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3", className)}>
      <span aria-hidden className="flex items-end gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="load-dot block size-2.5 rounded-[4px] bg-[color:var(--tint)]"
            style={{ "--dot-delay": `${i * 130}ms` } as React.CSSProperties}
          />
        ))}
      </span>
      <span className="text-muted-foreground text-sm font-semibold">{label}…</span>
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="tint-rose pop-card flex items-start gap-3 p-4 text-sm">
      <span className="icon-tile size-8 shrink-0 text-base font-black">!</span>
      <div>
        <p className="font-display font-bold text-[color:var(--tint)]">That didn&apos;t work</p>
        <p className="text-muted-foreground mt-0.5 leading-relaxed">{message}</p>
      </div>
    </div>
  );
}

/**
 * Progress bar, drawn inside a sunken outlined track so it reads as a filled
 * gauge rather than a stray coloured line. `label` puts the percentage on the
 * right without a second layout in every caller.
 */
export function Meter({
  value,
  className,
  label,
  size = "md",
}: {
  value: number;
  className?: string;
  label?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const pct = Math.max(0, Math.min(100, value));
  const h = size === "sm" ? "h-2" : size === "lg" ? "h-4" : "h-3";
  const bar = (
    <div
      className={cn(
        h,
        "w-full overflow-hidden rounded-full border border-[color:color-mix(in_oklab,var(--tint)_20%,transparent)] bg-[color:color-mix(in_oklab,var(--foreground)_6%,transparent)]",
        !label && className,
      )}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-[color:var(--tint)] transition-[width] duration-700 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );

  if (!label) return bar;
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      {bar}
      <span className="numeral shrink-0 text-sm text-[color:var(--tint)]">{Math.round(pct)}%</span>
    </div>
  );
}

/**
 * A circular gauge, for the one number a screen is actually about.
 *
 * Draws with `--ring-len` / `--ring-end` so the sweep animates in CSS and the
 * reduced-motion rule can land it flat at the final value.
 */
export function Ring({
  value,
  size = 76,
  stroke = 9,
  children,
  className,
}: {
  value: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke="color-mix(in oklab, var(--foreground) 8%, transparent)"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke="var(--tint)"
          className="ring-draw"
          style={
            {
              strokeDasharray: len,
              "--ring-len": len,
              "--ring-end": len * (1 - pct / 100),
            } as React.CSSProperties
          }
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        {children ?? <span className="numeral text-lg">{Math.round(pct)}%</span>}
      </span>
    </div>
  );
}

/**
 * Headline number.
 *
 * The value is set large on purpose — these tiles are read at a glance, and the
 * label under it is what carries the meaning.
 */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tint,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tint?: string;
}) {
  return (
    <div className={cn("pop-card p-4 sm:p-5", tint)}>
      <div className="flex items-start justify-between gap-3">
        <p className="font-display text-muted-foreground text-[0.7rem] font-extrabold tracking-[0.14em] uppercase">
          {label}
        </p>
        {Icon ? (
          <span className="icon-tile size-8 shrink-0">
            <Icon className="size-4" aria-hidden />
          </span>
        ) : null}
      </div>
      <p className="numeral mt-3 text-4xl text-[color:var(--tint)]">{value}</p>
      {hint ? <p className="text-muted-foreground mt-1.5 text-xs leading-snug">{hint}</p> : null}
    </div>
  );
}

/**
 * The milestone banner. Confetti + a stamped sticker.
 *
 * Deliberately rare: reaching for this on anything short of a real achievement
 * is how a product ends up congratulating people for logging in.
 */
export function Milestone({
  sticker,
  title,
  body,
  mascot = "star",
  children,
}: {
  sticker: string;
  title: string;
  body?: string;
  mascot?: MascotName;
  children?: ReactNode;
}) {
  return (
    <div className="banner-strip overflow-hidden p-5 sm:p-6">
      <Confetti />
      <div className="flex flex-wrap items-center gap-5">
        <Mascot name={mascot} mood="proud" size={84} idle={false} className="cheer" />
        <div className="min-w-0 flex-1">
          <span className="sticker stamp-in mb-2 inline-flex">
            <Sparkles className="size-3.5 text-[color:var(--pop-ink)]" />
            {sticker}
          </span>
          <h3 className="font-display text-xl font-extrabold sm:text-2xl">{title}</h3>
          {body ? (
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{body}</p>
          ) : null}
        </div>
        {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
      </div>
    </div>
  );
}
