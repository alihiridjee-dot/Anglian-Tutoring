import { expect, test } from "bun:test";
import { selectInHistory } from "./chunked";

test("history reads continue beyond small server caps and deduplicate input IDs", async () => {
  const source = Array.from({ length: 1201 }, (_, i) => ({ id: String(i).padStart(5, "0") }));
  const rows = await selectInHistory(["point", "point"], async (batch, after) => {
    expect(batch).toEqual(["point"]);
    return { data: source.filter((row) => !after || row.id > after).slice(0, 100), error: null };
  });
  expect(rows).toEqual(source);
});

test("history read failures never return partial evidence", async () => {
  await expect(selectInHistory(["point"], async (_batch, after) => after
    ? { data: null, error: { message: "Connection lost" } }
    : { data: [{ id: "1" }], error: null },
  )).rejects.toThrow("Connection lost");
});

test("non-advancing pagination fails rather than looping indefinitely", async () => {
  await expect(selectInHistory(["point"], async () => ({ data: [{ id: "1" }], error: null })))
    .rejects.toThrow("did not advance");
});

test("empty input does not query the database", async () => {
  expect(await selectInHistory([], async () => { throw new Error("Unexpected query"); })).toEqual([]);
});
