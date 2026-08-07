import { describe, expect, test, beforeEach } from "bun:test";
import { withConcurrencyLimit, __resetConcurrencyForTests } from "@/lib/ai/throttle";

/**
 * The concurrency gate is what turns a cohort-sized burst into a queue. These
 * tests pin the two properties that matter under that burst: the ceiling is
 * never exceeded, and a slot is always returned — including when the call it
 * was holding threw.
 */

const MAX_CONCURRENT = 4;

beforeEach(() => __resetConcurrencyForTests());

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("withConcurrencyLimit", () => {
  test("never runs more than the ceiling at once", async () => {
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 12 }, () => deferred());

    const calls = gates.map((g, i) =>
      withConcurrencyLimit(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await g.promise;
        running -= 1;
        return i;
      }),
    );

    // Let the first wave start, then release everything.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(peak).toBe(MAX_CONCURRENT);

    gates.forEach((g) => g.resolve());
    await Promise.all(calls);
    expect(peak).toBe(MAX_CONCURRENT);
    expect(running).toBe(0);
  });

  test("queued callers run once a slot frees", async () => {
    const order: number[] = [];
    const gates = Array.from({ length: 6 }, () => deferred());

    const calls = gates.map((g, i) =>
      withConcurrencyLimit(async () => {
        order.push(i);
        await g.promise;
      }),
    );

    await new Promise((r) => setTimeout(r, 0));
    // Only the ceiling has started; 4 and 5 are still queued.
    expect(order).toEqual([0, 1, 2, 3]);

    gates[0].resolve();
    gates[1].resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toContain(4);
    expect(order).toContain(5);

    gates.forEach((g) => g.resolve());
    await Promise.all(calls);
  });

  test("a thrown call still releases its slot", async () => {
    const failing = Array.from({ length: MAX_CONCURRENT }, () =>
      withConcurrencyLimit(async () => {
        throw new Error("upstream 500");
      }).catch(() => "handled"),
    );
    expect(await Promise.all(failing)).toEqual(Array(MAX_CONCURRENT).fill("handled"));

    // If slots leaked, this would queue forever rather than run immediately.
    const after = await withConcurrencyLimit(async () => "ran");
    expect(after).toBe("ran");
  });

  test("the error from the wrapped call propagates unchanged", async () => {
    const boom = new Error("rate limited");
    await expect(
      withConcurrencyLimit(async () => {
        throw boom;
      }),
    ).rejects.toThrow("rate limited");
  });
});
