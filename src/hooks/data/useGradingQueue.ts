import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BoardV, LevelV, SubjectV } from "@/lib/taxonomy";
import { cohortId, cohortLabel } from "@/lib/homeworkReview";

/**
 * Handed-in work for the tutor's grading review, the students it belongs to,
 * and the groups those students fall into.
 *
 * The working set is everything unpublished plus a month of published work.
 * Unpublished work is bounded by the review window — it publishes itself — so
 * this stays small at any number of students; older history is fetched per
 * student, on request, by `useStudentHistory`.
 */

const QUEUE_KEY = ["tutor", "grading-queue"] as const;
const ROSTER_KEY = ["tutor", "roster"] as const;
const GROUPS_KEY = ["tutor", "student-groups"] as const;
const RECENT_DAYS = 30;

export type QueueSubmission = {
  id: string;
  resource_id: string;
  student_id: string;
  notes: string | null;
  submitted_at: string;
  score_pct: number | null;
  feedback: string | null;
  graded_at: string | null;
  release_at: string | null;
  ai_marked_at: string | null;
  tutor_reviewed_at: string | null;
  resource: {
    id: string;
    title: string;
    subject: SubjectV | null;
    board: BoardV | null;
    level: LevelV | null;
    due_at: string | null;
  } | null;
};

const SUBMISSION_COLUMNS =
  "id, resource_id, student_id, notes, submitted_at, score_pct, feedback, graded_at, release_at, ai_marked_at, tutor_reviewed_at, resource:resources(id, title, subject, board, level, due_at)";

async function fetchQueue(): Promise<QueueSubmission[]> {
  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("homework_submissions")
    .select(SUBMISSION_COLUMNS)
    .or(`graded_at.is.null,graded_at.gte.${since}`)
    .order("submitted_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as QueueSubmission[];
}

export type RosterStudent = {
  id: string;
  name: string;
  level: string | null;
  /** Ids of every group this student is in — cohorts and hand-made alike. */
  groups: Set<string>;
};

export type StudentGroup = { id: string; name: string; kind: "cohort" | "manual"; size: number };

type ManualGroup = { id: string; name: string; members: string[] };

async function fetchRoster() {
  const [enrolments, profiles] = await Promise.all([
    supabase.from("student_enrolments").select("student_id, subject, board"),
    supabase.from("profiles").select("id, display_name, level").eq("role", "student"),
  ]);
  if (enrolments.error) throw enrolments.error;
  if (profiles.error) throw profiles.error;
  return { enrolments: enrolments.data ?? [], profiles: profiles.data ?? [] };
}

async function fetchManualGroups(): Promise<ManualGroup[]> {
  const { data, error } = await supabase
    .from("student_groups")
    .select("id, name, members:student_group_members(student_id)")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    members: (g.members ?? []).map((m) => m.student_id),
  }));
}

export function useGradingQueue() {
  const client = useQueryClient();
  const queue = useQuery({ queryKey: QUEUE_KEY, queryFn: fetchQueue, staleTime: 30_000 });
  const roster = useQuery({ queryKey: ROSTER_KEY, queryFn: fetchRoster, staleTime: 5 * 60_000 });
  const manual = useQuery({ queryKey: GROUPS_KEY, queryFn: fetchManualGroups, staleTime: 60_000 });

  const { students, groups } = useMemo(() => {
    const byId = new Map<string, RosterStudent>();
    const sizes = new Map<string, StudentGroup>();
    const join = (studentId: string, group: Omit<StudentGroup, "size">) => {
      const student = byId.get(studentId);
      if (!student || student.groups.has(group.id)) return;
      student.groups.add(group.id);
      const entry = sizes.get(group.id) ?? { ...group, size: 0 };
      entry.size++;
      sizes.set(group.id, entry);
    };

    for (const p of roster.data?.profiles ?? []) {
      byId.set(p.id, {
        id: p.id,
        name: p.display_name?.trim() || `Student ${p.id.slice(0, 8)}`,
        level: p.level,
        groups: new Set(),
      });
    }
    for (const e of roster.data?.enrolments ?? []) {
      const level = byId.get(e.student_id)?.level ?? null;
      join(e.student_id, {
        id: cohortId(e.subject, e.board, level),
        name: cohortLabel(e.subject, e.board, level),
        kind: "cohort",
      });
    }
    for (const g of manual.data ?? []) {
      // A hand-made group is listed even when empty, or it could never be filled.
      sizes.set(g.id, { id: g.id, name: g.name, kind: "manual", size: 0 });
      for (const studentId of g.members)
        join(studentId, { id: g.id, name: g.name, kind: "manual" });
    }

    const ordered = [...sizes.values()].sort(
      (a, b) =>
        Number(a.kind === "cohort") - Number(b.kind === "cohort") || a.name.localeCompare(b.name),
    );
    return { students: byId, groups: ordered };
  }, [roster.data, manual.data]);

  /** Patch one submission in the cache — after a save, without refetching the queue. */
  const patchSubmission = useCallback(
    (id: string, changes: Partial<QueueSubmission>) => {
      client.setQueryData<QueueSubmission[]>(QUEUE_KEY, (rows) =>
        (rows ?? []).map((s) => (s.id === id ? { ...s, ...changes } : s)),
      );
    },
    [client],
  );

  const createGroup = useCallback(
    async (name: string, createdBy: string | null) => {
      const { data, error } = await supabase
        .from("student_groups")
        .insert({ name: name.trim(), created_by: createdBy })
        .select("id")
        .single();
      if (error) throw error;
      await client.invalidateQueries({ queryKey: GROUPS_KEY });
      return data.id;
    },
    [client],
  );

  const deleteGroup = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("student_groups").delete().eq("id", id);
      if (error) throw error;
      await client.invalidateQueries({ queryKey: GROUPS_KEY });
    },
    [client],
  );

  const setMembership = useCallback(
    async (groupId: string, studentId: string, member: boolean) => {
      const table = supabase.from("student_group_members");
      const { error } = member
        ? await table.upsert({ group_id: groupId, student_id: studentId })
        : await table.delete().eq("group_id", groupId).eq("student_id", studentId);
      if (error) throw error;
      await client.invalidateQueries({ queryKey: GROUPS_KEY });
    },
    [client],
  );

  return {
    submissions: queue.data ?? [],
    students,
    groups,
    loading: queue.isLoading || roster.isLoading,
    // Groups are an extra: if they fail to load, grading still works without them.
    error: queue.error ?? roster.error,
    patchSubmission,
    createGroup,
    deleteGroup,
    setMembership,
  };
}

/** A student's published work from before the queue's window, newest first. */
export function useStudentHistory(studentId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["tutor", "student-history", studentId],
    enabled: !!studentId && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const before = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("homework_submissions")
        .select(SUBMISSION_COLUMNS)
        .eq("student_id", studentId!)
        .lt("graded_at", before)
        .order("submitted_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as QueueSubmission[];
    },
  });
}
