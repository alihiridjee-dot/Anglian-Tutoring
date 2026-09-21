import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";

export function CollapsibleSection({
  title,
  icon: Icon,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="rounded-2xl premium-card overflow-hidden transition-all duration-200">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-secondary/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10 text-primary">
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display font-bold text-sm text-foreground leading-none">{title}</h3>
            <p className="text-[11px] text-muted-foreground mt-1">
              {count} {count === 1 ? "item" : "items"} available
            </p>
          </div>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180 text-primary" : ""}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden border-t border-border bg-muted/20"
          >
            <div className="p-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function CollapsibleResourceGroup<T extends { id: string }>({
  label,
  icon,
  items,
  render,
  cards = false,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: T[];
  render: (r: T) => React.ReactNode;
  /** Render items as bare cards in a grid instead of padded list rows. */
  cards?: boolean;
}) {
  return (
    <CollapsibleSection
      title={label}
      icon={icon}
      count={items.length}
      defaultOpen={items.length > 0}
    >
      {items.length === 0 ? (
        <Empty label={`No ${label.toLowerCase()} yet.`} />
      ) : cards ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((r) => (
            <li key={r.id}>{render(r)}</li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-2.5">
          {items.map((r) => (
            <li
              key={r.id}
              className="p-3.5 rounded-xl bg-secondary/10 border border-border flex flex-col items-start hover:border-primary/20 transition-all"
            >
              {render(r)}
            </li>
          ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}

export function Empty({ label }: { label: string }) {
  return <p className="text-xs italic text-muted-foreground">{label}</p>;
}
