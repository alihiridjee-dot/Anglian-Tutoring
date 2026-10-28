import { afterEach, describe, expect, test } from "bun:test";
import { onlineManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import { stillReading } from "./queryState";

const tick = () => new Promise((r) => setTimeout(r, 20));

function observe(client: QueryClient, enabled = true) {
  const observer = new QueryObserver(client, {
    queryKey: ["week", enabled],
    queryFn: async () => ({ points: [] }),
    enabled,
  });
  const stop = observer.subscribe(() => {});
  return { observer, stop };
}

afterEach(() => onlineManager.setOnline(true));

describe("stillReading", () => {
  test("a read offline waits for the network, and counts as still reading", async () => {
    onlineManager.setOnline(false);
    const client = new QueryClient();
    const { observer, stop } = observe(client);
    await tick();
    const result = observer.getCurrentResult();
    // What pages used to read as "nothing there".
    expect(result.isLoading).toBe(false);
    expect(result.data).toBeUndefined();
    expect(stillReading(result)).toBe(true);
    stop();
    client.clear();
  });

  test("a read that has answered is not", async () => {
    const client = new QueryClient();
    const { observer, stop } = observe(client);
    await tick();
    expect(stillReading(observer.getCurrentResult())).toBe(false);
    stop();
    client.clear();
  });

  test("a read that is switched off is not, though it stays pending", async () => {
    const client = new QueryClient();
    const { observer, stop } = observe(client, false);
    await tick();
    const result = observer.getCurrentResult();
    expect(result.isPending).toBe(true);
    expect(stillReading(result)).toBe(false);
    stop();
    client.clear();
  });
});
