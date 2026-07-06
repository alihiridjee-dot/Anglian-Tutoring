import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    // Verify tutor role
    const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const roles = (role ?? []).map((r) => r.role);
    if (!roles.includes("tutor") && !roles.includes("admin")) {
      throw new Error("Tutor access required");
    }

    const system = `You are an expert exam question writer for UK GCSE and A-Level science.
Generate exactly ${data.count} multiple choice questions covering the topic below.
Each question must have 4 plausible options and one clearly correct answer.
Return ONLY JSON matching this shape:
{"questions":[{"question":"...","options":["A","B","C","D"],"correct_index":0,"explanation":"..."}]}`;

    const user = `Spec point: ${data.title}\n\nDetails / context:\n${data.context || "(no additional context provided — infer from the title)"}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!aiRes.ok) {
      const text = await aiRes.text();
      if (aiRes.status === 429) throw new Error("AI rate limit — try again in a moment");
      if (aiRes.status === 402)
        throw new Error("AI credits exhausted — top up in workspace billing");
      throw new Error(`AI error ${aiRes.status}: ${text.slice(0, 200)}`);
    }
    const aiJson = await aiRes.json();
    const raw = aiJson?.choices?.[0]?.message?.content ?? "{}";
    let parsed: {
      questions?: Array<{
        question: string;
        options: string[];
        correct_index: number;
        explanation?: string;
      }>;
    };
    try {
      parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      throw new Error("AI returned invalid JSON");
    }
    const qs = Array.isArray(parsed.questions) ? parsed.questions : [];
    if (qs.length === 0) throw new Error("No questions generated");

    // Insert set
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

    const rows = qs.slice(0, data.count).map((q, i) => ({
      set_id: setRow.id,
      position: i,
      question: String(q.question ?? ""),
      options: Array.isArray(q.options) ? q.options.slice(0, 4) : ["A", "B", "C", "D"],
      correct_index: Math.min(Math.max(Number(q.correct_index) || 0, 0), 3),
      explanation: q.explanation ? String(q.explanation) : null,
    }));
    const { error: qErr } = await supabase.from("mcq_questions").insert(rows);
    if (qErr) throw qErr;

    return { setId: setRow.id, count: rows.length };
  });
