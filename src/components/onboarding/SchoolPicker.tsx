import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  loadUkSchools,
  searchSchools,
  type IndexedSchool,
  type School,
} from "@/lib/schools/ukSchools";

/**
 * The school box in setup: a plain text field that suggests UK schools as the
 * student types.
 *
 * The suggestions never take over the typing. Nothing is highlighted until the
 * student arrows down or points at a row, so Enter and Tab can't swap what they
 * wrote for a guess, and a school we don't list is saved exactly as typed. If
 * the list fails to download, the box is simply a text field.
 */
export function SchoolPicker({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [schools, setSchools] = useState<IndexedSchool[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  // Fetched as the step opens, so it's ready by the first keystroke.
  useEffect(() => {
    let live = true;
    loadUkSchools().then(
      (list) => live && setSchools(list),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  const matches = useMemo(() => (schools ? searchSchools(schools, value) : []), [schools, value]);
  const expanded = open && matches.length > 0;

  // New suggestions mean the old highlight points at something else.
  useEffect(() => setActive(-1), [matches]);

  useEffect(() => {
    if (active >= 0) listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (school: School) => {
    onChange(school.name);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (expanded ? (i + 1) % matches.length : 0));
    } else if (e.key === "ArrowUp" && expanded) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? matches.length - 1 : i - 1));
    } else if (e.key === "Enter" && expanded && active >= 0) {
      e.preventDefault();
      pick(matches[active]);
    } else if (e.key === "Escape" && expanded) {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
        // The browser's own autofill menu would sit on top of ours.
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        placeholder={placeholder}
        className="mt-1 w-full h-11 rounded-xl bg-background border border-border px-3.5 text-sm transition focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
      />
      {expanded && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label="Schools"
          className="premium-card absolute inset-x-0 top-full z-50 mt-1.5 max-h-72 overflow-y-auto p-1.5"
        >
          {matches.map((school, i) => (
            <li
              key={`${school.name}|${school.place}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Keeps focus in the box, so the blur doesn't close the list
              // before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setActive(i)}
              onClick={() => pick(school)}
              // On a phone the town drops under the name, so long names
              // don't wrap a word to a line beside it.
              className={`flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-sm transition ${
                i === active ? "bg-primary/10" : ""
              }`}
            >
              <span className="min-w-0 basis-full font-semibold sm:basis-0 sm:flex-1">
                {school.name}
              </span>
              {school.place && <span className="chip shrink-0">{school.place}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
