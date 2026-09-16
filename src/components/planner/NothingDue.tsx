import { Mascot, type MascotName, type Mood } from "@/components/Doodles";

/** An empty planner column keeps its place: a doodle and a few words, no explanation. */
export function NothingDue({
  mascot,
  mood = "happy",
  title,
}: {
  mascot: MascotName;
  mood?: Mood;
  title: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 py-3 text-center">
      <Mascot name={mascot} mood={mood} size={64} inheritTint />
      <p className="font-display text-sm font-extrabold text-[color:color-mix(in_oklab,var(--tint)_72%,var(--primary-deep))]">
        {title}
      </p>
    </div>
  );
}
