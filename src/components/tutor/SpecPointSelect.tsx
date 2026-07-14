import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Field, inputCls } from "./Field";
import type { SubjectV, BoardV, LevelV } from "@/lib/taxonomy";

type Row = {
  id: string;
  code: string;
  title: string;
  sort_order: number | null;
  topics: {
    id: string;
    title: string;
    code: string | null;
    sort_order: number | null;
  } | null;
};

type Group = { topicId: string; topicLabel: string; sort: number; points: Row[] };

/**
 * Optional curriculum-module picker. Given the current subject/board/level, it
 * loads every spec point (grouped by topic) and lets a tutor attach the
 * resource to one. Selecting nothing leaves the resource unattached.
 *
 * Self-correcting: when the taxonomy changes and the previously selected point
 * is no longer valid, it clears the selection so a resource can't be linked to a
 * spec point from a different subject/board/level.
 */
export function SpecPointSelect({
  subject,
  board,
  level,
  value,
  onChange,
}: {
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("spec_points")
        .select("id, code, title, sort_order, topics!inner(id, title, code, sort_order)")
        .eq("topics.subject", subject)
        .eq("topics.board", board)
        .eq("topics.level", level);
      if (cancelled) return;

      const rows = (error ? [] : ((data ?? []) as unknown as Row[])) ?? [];
      const byTopic = new Map<string, Group>();
      for (const r of rows) {
        const t = r.topics;
        if (!t) continue;
        if (!byTopic.has(t.id)) {
          byTopic.set(t.id, {
            topicId: t.id,
            topicLabel: t.code ? `${t.code} · ${t.title}` : t.title,
            sort: t.sort_order ?? 0,
            points: [],
          });
        }
        byTopic.get(t.id)!.points.push(r);
      }
      const list = [...byTopic.values()].sort((a, b) => a.sort - b.sort);
      for (const g of list) {
        g.points.sort(
          (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.code.localeCompare(b.code),
        );
      }
      setGroups(list);
      setLoading(false);

      // Drop a stale selection that doesn't exist under the new taxonomy.
      if (value && !rows.some((r) => r.id === value)) onChange(null);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, board, level]);

  return (
    <Field label="Curriculum spec point (optional)">
      <select
        className={inputCls}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={loading}
      >
        <option value="">
          {loading
            ? "Loading spec points…"
            : groups.length === 0
              ? "No spec points for this selection"
              : "— Not linked to a spec point —"}
        </option>
        {groups.map((g) => (
          <optgroup key={g.topicId} label={g.topicLabel}>
            {g.points.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.title}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </Field>
  );
}
