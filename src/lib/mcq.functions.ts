import { createServerFn } from "@tanstack/react-start";
import Anthropic from "@anthropic-ai/sdk";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// MCQ generation runs through Anthropic Claude (structured JSON), replacing the
// earlier Gemini call. Two entry points share the same generator:
//   - generateMcqSet     — one unpublished set for a single spec point (manual,
//                          tutor reviews then publishes).
//   - generateWeeklyQuiz — one auto-published set spanning every spec point a
//                          weekly live session covers (>=15 questions, each
//                          tagged with its spec point so students can later
//                          browse questions by point across weeks).

const MODEL = "claude-sonnet-5";
// Strong on UK GCSE/A-Level science at good cost; swap to "claude-opus-4-8" if
// question quality needs to go higher.

type RawQuestion = {
  question: string;
  options: string[];
  correct_index: number;
  explanation?: string;
};

type QuestionRow = {
  set_id: string;
  position: number;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
  spec_point_id: string | null;
};

// Claude occasionally wraps JSON in ```json fences despite instructions; strip
// them before parsing.
function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

async function generateQuestions(
  title: string,
  context: string,
  count: number,
): Promise<RawQuestion[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const client = new Anthropic({ apiKey });

  const system = `You are an expert exam question writer for UK GCSE and A-Level science.
Generate exactly ${count} multiple choice questions covering the spec point below.
Each question must have exactly 4 plausible options and exactly one clearly correct answer.
Vary the position of the correct answer across questions.
Return ONLY JSON matching this exact shape — no prose, no markdown fences:
{"questions":[{"question":"...","options":["A","B","C","D"],"correct_index":0,"explanation":"..."}]}`;

  const user = `Spec point: ${title}\n\nDetails / context:\n${
    context || "(no additional context provided — infer from the title)"
  }`;

  let res;
  try {
    res = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content: user }],
    });
  } catch (e) {
    const status = (e as { status?: number })?.status;
    if (status === 429) throw new Error("AI rate limit — try again in a moment");
    if (status === 402)
      throw new Error("AI credits exhausted — top up in workspace billing");
    throw new Error(`AI error: ${e instanceof Error ? e.message : String(e)}`);
  }

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  let parsed: { questions?: RawQuestion[] };
  try {
    parsed = JSON.parse(stripFences(text));
  } catch {
    throw new Error("AI returned invalid JSON");
  }
  const qs = Array.isArray(parsed.questions) ? parsed.questions : [];
  if (qs.length === 0) throw new Error("No questions generated");
  return qs.slice(0, count);
}

// Shape raw AI questions into insertable mcq_questions rows, tagging each with
// its spec point and continuing the set's running position counter.
function toRows(
  qs: RawQuestion[],
  setId: string,
  specPointId: string | null,
  startPosition: number,
): QuestionRow[] {
  return qs.map((q, i) => ({
    set_id: setId,
    position: startPosition + i,
    question: String(q.question ?? ""),
    options: Array.isArray(q.options) ? q.options.slice(0, 4) : ["A", "B", "C", "D"],
    correct_index: Math.min(Math.max(Number(q.correct_index) || 0, 0), 3),
    explanation: q.explanation ? String(q.explanation) : null,
    spec_point_id: specPointId,
  }));
}

// Supabase server client from the auth middleware. Typed loosely here to avoid
// coupling this file to the generated Database type surface.
type SupabaseServer = {
  from: (table: string) => any;
};

async function requireTutor(supabase: SupabaseServer, userId: string) {
  const { data: role } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const roles = ((role ?? []) as Array<{ role: string }>).map((r) => r.role);
  if (!roles.includes("tutor") && !roles.includes("admin")) {
    throw new Error("Tutor access required");
  }
}

// Split the weekly total across N spec points: aim for ~6 per point, but keep
// the whole quiz at >=15 questions even when a session covers only 1–2 points.
function distributeCounts(pointCount: number): number[] {
  const total = Math.max(15, pointCount * 6);
  const base = Math.floor(total / pointCount);
  const remainder = total - base * pointCount;
  return Array.from({ length: pointCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

// ISO-8601 week number, used to label the weekly quiz.
function isoWeek(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  target.setUTCDate(target.getUTCDate() - dayNr + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
}

type GenInput = {
  specPointId: string;
  title: string;
  context: string;
  count: number;
};

export const generateMcqSet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: GenInput) => {
    if (!input?.specPointId) throw new Error("specPointId required");
    return {
      specPointId: String(input.specPointId),
      title: String(input.title || "Practice MCQs"),
      context: String(input.context || ""),
      count: Math.min(Math.max(Number(input.count) || 6, 3), 12),
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireTutor(supabase, userId);

    const qs = await generateQuestions(data.title, data.context, data.count);

    const { data: setRow, error: setErr } = await supabase
      .from("mcq_sets")
      .insert({
        spec_point_id: data.specPointId,
        title: data.title,
        description: `AI-generated from: ${data.title}`,
        published: false,
        created_by: userId,
      })
      .select("id")
      .single();
    if (setErr) throw setErr;

    const rows = toRows(qs, setRow.id, data.specPointId, 0);
    const { error: qErr } = await supabase.from("mcq_questions").insert(rows);
    if (qErr) throw qErr;

    return { setId: setRow.id, count: rows.length };
  });

type CurriculumQuizInput = {
  subject: string;
  specPointIds: string[];
  title: string;
  dueAt: string;
};

// Tutor-assigned weekly quiz built from hand-picked curriculum points, with a due
// date — independent of any live session. Like generateWeeklyQuiz it spans several
// spec points and auto-publishes, tagging each question with its point so the set
// surfaces under every point a student browses. The non-null due_at is what marks
// it as an assigned weekly set on the student page.
export const generateCurriculumQuiz = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CurriculumQuizInput) => {
    const ids = Array.isArray(input?.specPointIds)
      ? input.specPointIds.map(String).filter(Boolean)
      : [];
    if (ids.length === 0) throw new Error("Select at least one spec point");
    if (!input?.dueAt) throw new Error("Due date required");
    if (!input?.subject) throw new Error("subject required");
    return {
      subject: String(input.subject),
      specPointIds: ids,
      title: String(input.title || "Weekly MCQs"),
      dueAt: String(input.dueAt),
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireTutor(supabase, userId);

    const { data: pointRows, error: pointErr } = await supabase
      .from("spec_points")
      .select("id, title, description")
      .in("id", data.specPointIds);
    if (pointErr) throw pointErr;

    const points = ((pointRows ?? []) as Array<{
      id: string;
      title: string;
      description: string | null;
    }>).filter((p) => !!p?.id);
    if (points.length === 0) throw new Error("No matching spec points found");

    const counts = distributeCounts(points.length);

    // Generate every point's questions before touching the DB, so a mid-way AI
    // failure doesn't leave a half-built published quiz.
    const generated: Array<{ pointId: string; qs: RawQuestion[] }> = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const qs = await generateQuestions(p.title, p.description || "", counts[i]);
      generated.push({ pointId: p.id, qs });
    }

    const title = data.title;
    const description = `Weekly MCQs across ${points.length} spec point${
      points.length === 1 ? "" : "s"
    }`;

    const { data: setRow, error: setErr } = await supabase
      .from("mcq_sets")
      .insert({
        resource_id: null,
        spec_point_id: null,
        title,
        description,
        published: true,
        subject: data.subject,
        week_number: isoWeek(data.dueAt),
        due_at: data.dueAt,
        created_by: userId,
      })
      .select("id")
      .single();
    if (setErr) throw setErr;
    const setId = setRow.id;

    let position = 0;
    const rows: QuestionRow[] = [];
    for (const g of generated) {
      const r = toRows(g.qs, setId, g.pointId, position);
      position += r.length;
      rows.push(...r);
    }

    const { error: qErr } = await supabase.from("mcq_questions").insert(rows);
    if (qErr) throw qErr;

    return { setId, count: rows.length, points: points.length };
  });

type WeeklyInput = { resourceId: string };

export const generateWeeklyQuiz = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: WeeklyInput) => {
    if (!input?.resourceId) throw new Error("resourceId required");
    return { resourceId: String(input.resourceId) };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireTutor(supabase, userId);

    const { data: resource, error: resErr } = await supabase
      .from("resources")
      .select("id, title, subject, starts_at, kind")
      .eq("id", data.resourceId)
      .single();
    if (resErr || !resource) throw new Error("Session not found");
    if (resource.kind !== "live_session")
      throw new Error("Weekly quizzes are generated from live sessions");

    const { data: links, error: linkErr } = await supabase
      .from("resource_spec_points")
      .select("spec_points(id, title, description)")
      .eq("resource_id", data.resourceId);
    if (linkErr) throw linkErr;

    const points = ((links ?? []) as Array<{
      spec_points: { id: string; title: string; description: string | null } | null;
    }>)
      .map((l) => l.spec_points)
      .filter((p): p is { id: string; title: string; description: string | null } => !!p);
    if (points.length === 0)
      throw new Error("Tag at least one spec point on this session first");

    const counts = distributeCounts(points.length);

    // Generate every point's questions before touching the DB, so a mid-way AI
    // failure doesn't leave a half-built published quiz.
    const generated: Array<{ pointId: string; qs: RawQuestion[] }> = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const qs = await generateQuestions(p.title, p.description || "", counts[i]);
      generated.push({ pointId: p.id, qs });
    }

    const title = `Weekly quiz — ${resource.title}`;
    const description = `Auto-generated from live session: ${resource.title}`;
    const week_number = isoWeek(resource.starts_at);

    // Idempotent per session: refresh the existing weekly set in place (keeps
    // any student attempts pointing at a live set) rather than duplicating.
    const { data: existing } = await supabase
      .from("mcq_sets")
      .select("id")
      .eq("resource_id", data.resourceId)
      .maybeSingle();

    let setId: string;
    if (existing) {
      setId = existing.id;
      await supabase.from("mcq_questions").delete().eq("set_id", setId);
      const { error: updErr } = await supabase
        .from("mcq_sets")
        .update({
          title,
          description,
          published: true,
          subject: resource.subject,
          week_number,
          spec_point_id: null,
        })
        .eq("id", setId);
      if (updErr) throw updErr;
    } else {
      const { data: setRow, error: setErr } = await supabase
        .from("mcq_sets")
        .insert({
          resource_id: data.resourceId,
          spec_point_id: null,
          title,
          description,
          published: true,
          subject: resource.subject,
          week_number,
          created_by: userId,
        })
        .select("id")
        .single();
      if (setErr) throw setErr;
      setId = setRow.id;
    }

    let position = 0;
    const rows: QuestionRow[] = [];
    for (const g of generated) {
      const r = toRows(g.qs, setId, g.pointId, position);
      position += r.length;
      rows.push(...r);
    }

    const { error: qErr } = await supabase.from("mcq_questions").insert(rows);
    if (qErr) throw qErr;

    return { setId, count: rows.length, points: points.length };
  });
