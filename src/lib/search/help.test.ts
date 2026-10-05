import { describe, expect, test } from "bun:test";
import { contentTerms, matchHelpIntent, parseHelpReply, scrubForModel, searchTerms } from "./help";

describe("matchHelpIntent", () => {
  test.each([
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
  ])("%s → %s", (query, intent) => {
    expect(matchHelpIntent(query)).toBe(intent);
  });

  test.each(["photosynthesis", "cell structure", "4.1.2", "planet orbits", "classification"])(
    "a plain search (%s) is not a help request",
    (query) => expect(matchHelpIntent(query)).toBeNull(),
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
