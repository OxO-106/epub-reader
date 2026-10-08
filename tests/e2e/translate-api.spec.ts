// The translate endpoint as the page's own code will use it: fetch from the app's origin, read the body as a stream
// of lines. Proves the content-security policy and the streaming work in a real browser; the Reader's own use of the
// endpoint is tested by the translation specs that build on this.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

/** What the Reader's translation engine will do: POST, then read newline-delimited JSON as it arrives. */
async function streamFromPage(page: Page, text: string) {
  return page.evaluate(async (text) => {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) return { status: response.status, events: [] as unknown[] };
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    const events: unknown[] = [];
    let buffered = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += value;
      let newline;
      while ((newline = buffered.indexOf("\n")) !== -1) {
        events.push(JSON.parse(buffered.slice(0, newline)));
        buffered = buffered.slice(newline + 1);
      }
    }
    return { status: response.status, events };
  }, text);
}

const status = (page: Page) => page.evaluate(() => fetch("/api/translate/status").then((r) => r.json()));

test.describe("with a model", () => {
  test.use({ withModel: true });

  test("the page can read a streamed translation line by line", async ({ page, server, model }) => {
    model.setReply({ chunks: ["你好，", "世界。"], chunkDelayMs: 20 });
    await page.goto(server.url);

    const result = await streamFromPage(page, "Hello, world.");

    expect(result).toEqual({ status: 200, events: [{ delta: "你好，" }, { delta: "世界。" }, { done: true }] });
    expect(model.chatRequests()).toHaveLength(1);
  });

  test("the page can ask for the status", async ({ page, server }) => {
    await page.goto(server.url);

    expect(await status(page)).toEqual({ configured: true, reachable: true, model: "stand-in-model" });
  });
});

test.describe("without a model", () => {
  test("the status says translation is not set up", async ({ page, server }) => {
    await page.goto(server.url);

    expect(await status(page)).toEqual({ configured: false, reachable: false, model: null });
    expect((await streamFromPage(page, "Hello.")).status).toBe(503);
  });
});

test.describe("with an address where no model server runs", () => {
  test.use({ translateUrl: "http://127.0.0.1:9" });

  test("the status says unreachable and a translation ends in an error line", async ({ page, server }) => {
    await page.goto(server.url);

    expect(await status(page)).toEqual({ configured: true, reachable: false, model: null });
    const result = await streamFromPage(page, "Hello.");
    expect(result.events).toEqual([{ error: { code: "unreachable", message: expect.any(String) } }]);
  });
});
