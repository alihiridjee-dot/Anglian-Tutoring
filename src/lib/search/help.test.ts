import { describe, expect, test } from "bun:test";
import {
  contentTerms,
  matchHelpIntent,
  parseHelpReply,
  scrubForModel,
  searchTerms,
  type HelpIntentId,
} from "./help";

describe("matchHelpIntent", () => {
  test.each<[string, HelpIntentId]>([
    ["help me find my mcq for this week", "week_quizzes"],
    ["where's my quiz", "week_quizzes"],
    ["Multiple-choice test?", "week_quizzes"],
    ["what homework is due", "week_tasks"],
    ["my homework marks", "grades"],
    ["my quiz marks", "week_quizzes"],
    ["when is my next live lesson", "next_live"],
    ["what videos do I watch", "week_videos"],
    ["revision notes for cells", "notes"],
    ["I want to ask my tutor something", "messages"],
    ["what should I do this week", "week_plan"],
    ["how do I change my password", "account"],
    ["cancel subscription", "billing"],
    ["what am I worst at?", "weak_topics"],
    ["What should I revise?", "weak_topics"],
    ["my weak topics", "weak_topics"],
    ["give me practice on moles", "practice"],
    ["more questions on osmosis", "practice"],
    ["when is my exam", "exam_date"],
    ["how long until my exams", "exam_date"],
    ["I need a break", "break"],
    ["we are going on holiday", "break"],
  ])("%s → %s", (query, intent) => {
    expect(matchHelpIntent(query)).toBe(intent);
  });

  test.each([
    "photosynthesis",
    "cell structure",
    "4.1.2",
    "planet orbits",
    "classification",
    // Science that shares a word with a request.
    "weak acids",
    "enzymes break down starch",
    "why does osmosis happen",
  ])("a plain search (%s) is not a help request", (query) =>
    expect(matchHelpIntent(query)).toBeNull(),
  );
});

describe("searchTerms", () => {
  test("drops filler so a sentence still searches", () => {
    expect(searchTerms("where is cell structure?")).toEqual(["cell", "structure"]);
  });

  test("keeps physics words that look like filler", () => {
    expect(searchTerms("what is current")).toEqual(["current"]);
  });

  test("keeps spec codes whole", () => {
    expect(searchTerms("find 4.1.2")).toEqual(["4.1.2"]);
  });

  test("falls back to every word when nothing else is left", () => {
    expect(searchTerms("help me")).toEqual(["help", "me"]);
  });

  test.each([
    ["photosynthesis?", ["photosynthesis"]],
    ["what is osmosis.", ["osmosis"]],
    ["what is photosynthesis", ["photosynthesis"]],
    ["4.1.2.", ["4.1.2"]],
    ["C4.2a", ["c4.2a"]],
    ["0.5 m", ["0.5", "m"]],
    ["...osmosis", ["osmosis"]],
    ["-osmosis-", ["osmosis"]],
    ["β-galactosidase", ["β-galactosidase"]],
    ["CO₂ test", ["co₂", "test"]],
    ["ΔH", ["δh"]],
    ["e.m.f.", ["e.m.f"]],
    ["p.d.", ["p.d"]],
    ["a.c. generator", ["a.c", "generator"]],
    ["what is the p.d.?", ["p.d"]],
  ])("punctuation around a word is dropped: %p", (query, terms) => {
    expect(searchTerms(query)).toEqual(terms);
  });
});

describe("contentTerms", () => {
  test("a whole help request leaves nothing to search", () => {
    const q = "help me find my mcq for this week";
    expect(contentTerms(q, matchHelpIntent(q))).toEqual([]);
  });

  test("the topic in a help request is still searched", () => {
    const q = "find my photosynthesis quiz";
    expect(contentTerms(q, matchHelpIntent(q))).toEqual(["photosynthesis"]);
  });
});

describe("scrubForModel", () => {
  test("takes out email addresses and phone numbers", () => {
    expect(scrubForModel("I'm sam@example.com, call 07700 900123")).toBe(
      "I'm [email], call [number]",
    );
  });

  test("leaves spec codes alone", () => {
    expect(scrubForModel("quiz on 4.1.2.3")).toBe("quiz on 4.1.2.3");
    expect(scrubForModel("notes for 4.10.1.2.3")).toBe("notes for 4.10.1.2.3");
    expect(scrubForModel("lesson 9.30-10.30")).toBe("lesson 9.30-10.30");
  });

  test("leaves a list of spec codes, a dotted date or a row of decimals alone", () => {
    expect(scrubForModel("notes on 4.1.1.1 4.1.1.2")).toBe("notes on 4.1.1.1 4.1.1.2");
    expect(scrubForModel("exam on 12.05.2027")).toBe("exam on 12.05.2027");
    expect(scrubForModel("1.5 2.5 3.5 4.5")).toBe("1.5 2.5 3.5 4.5");
    expect(scrubForModel("topics 4.1.1.1-4.1.1.4")).toBe("topics 4.1.1.1-4.1.1.4");
  });

  test("a dotted number as long as a phone number still goes", () => {
    expect(scrubForModel("ring 0770.090.0123")).toBe("ring [number]");
    expect(scrubForModel("4.1.1.1 07700 900123")).toBe("[number]");
  });

  test("scrubs before cutting, so no half address reaches the model", () => {
    const email = scrubForModel(`${"x".repeat(183)} john.smith@gmail.com`);
    expect(email).not.toContain("john");
    expect(email).not.toContain("gmail");
    const phone = scrubForModel(`${"x".repeat(191)} 07700 900123`);
    expect(phone).not.toContain("07700");
    expect(phone.length).toBeLessThanOrEqual(200);
  });

  test("a cut inside a word drops the word", () => {
    const out = scrubForModel(`${"word ".repeat(39)}abcdefghij`);
    expect(out.endsWith("word")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(200);
  });

  test("catches dotted numbers, accented addresses and a spelled-out (at)", () => {
    expect(scrubForModel("ring 07700.900.123")).toBe("ring [number]");
    expect(scrubForModel("I'm jöe@gmäil.com")).toBe("I'm [email]");
    expect(scrubForModel("I'm john(at)gmail.com")).toBe("I'm [email]");
    expect(scrubForModel("+44 (0)7700 900123 please")).toBe("[number] please");
  });
});

describe("parseHelpReply", () => {
  test("accepts an intent on the list", () => {
    expect(parseHelpReply('{"intent":"week_quizzes","topic":null}')).toEqual({
      intent: "week_quizzes",
    });
  });

  test("accepts a search with words", () => {
    expect(parseHelpReply('{"intent":"search","topic":"how plants make food"}')).toEqual({
      intent: "search",
      topic: "plants make food",
    });
  });

  test.each([
    "",
    "not json",
    '{"intent":"delete_account"}',
    '{"intent":"search","topic":""}',
    '{"intent":"search"}',
    "[]",
  ])("anything else is none: %p", (text) => {
    expect(parseHelpReply(text)).toEqual({ intent: "none" });
  });
});

describe("the new requests", () => {
  test("practice keeps only the topic to search for", () => {
    expect(contentTerms("give me practice on moles", "practice")).toEqual(["moles"]);
    expect(contentTerms("can I have more questions on osmosis", "practice")).toEqual(["osmosis"]);
  });

  test("a request about the student leaves nothing to search for", () => {
    expect(contentTerms("what should I revise?", "weak_topics")).toEqual([]);
    expect(contentTerms("how long until my exams", "exam_date")).toEqual([]);
    expect(contentTerms("I need to take a break", "break")).toEqual([]);
  });

  test("the model may name a topic to explain or to practise", () => {
    expect(parseHelpReply('{"intent":"explain","topic":"osmosis"}')).toEqual({
      intent: "explain",
      topic: "osmosis",
    });
    expect(parseHelpReply('{"intent":"practice","topic":"the moles"}')).toEqual({
      intent: "practice",
      topic: "moles",
    });
    expect(parseHelpReply('{"intent":"practice","topic":null}')).toEqual({ intent: "practice" });
    expect(parseHelpReply('{"intent":"explain","topic":""}')).toEqual({ intent: "none" });
  });
});
