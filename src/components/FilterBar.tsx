import { SUBJECTS, BOARDS, LEVELS, type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";

export type Filters = { subject?: SubjectV; board?: BoardV; level?: LevelV };

export function FilterBar({ value, onChange }: { value: Filters; onChange: (f: Filters) => void }) {
  const Group = <T extends string>({
    label,
    options,
    selected,
    onSelect,
  }: {
    label: string;
    options: readonly { value: T; label: string }[];
    selected: T | undefined;
    onSelect: (v: T | undefined) => void;
  }) => (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onSelect(undefined)}
          className={`px-3 py-1.5 text-xs rounded-full border transition ${
            !selected
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-secondary border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          All
        </button>
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onSelect(o.value)}
            className={`px-3 py-1.5 text-xs rounded-full border transition ${
              selected === o.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-secondary border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="rounded-2xl bg-card border border-border p-5 mb-6 space-y-4">
      <Group
        label="Subject"
        options={SUBJECTS}
        selected={value.subject}
        onSelect={(v) => onChange({ ...value, subject: v })}
      />
      <Group
        label="Board"
        options={BOARDS}
        selected={value.board}
        onSelect={(v) => onChange({ ...value, board: v })}
      />
      <Group
        label="Level"
        options={LEVELS}
        selected={value.level}
        onSelect={(v) => onChange({ ...value, level: v })}
      />
    </div>
  );
}
