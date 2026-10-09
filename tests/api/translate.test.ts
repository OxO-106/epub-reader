import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError, resolveConfig, type TranslateConfig } from "../../src/server/config.ts";
import { deadModelUrl, startModelStandIn, type ModelStandIn, type StandInOptions } from "../helpers/model-stand-in.ts";
import { startTestServer, translate, type StreamedEvent, type TestServer } from "./helpers.ts";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  while (cleanups.length) await cleanups.pop()!();
});

/** The app on throwaway folders, pointed at a fresh model stand-in (unless `url` says otherwise). */
async function setup(
  stand: StandInOptions = {},
  translateConfig: Partial<TranslateConfig> = {},
): Promise<{ model: ModelStandIn; server: TestServer }> {
  const model = await startModelStandIn(stand);
  cleanups.push(() => model.close());
  const server = await startTestServer({ translate: { url: model.url, statusCacheMs: 0, ...translateConfig } });
  cleanups.push(() => server.dispose());
  return { model, server };
}

const post = (server: TestServer, body: unknown, signal?: AbortSignal) =>
  fetch(`${server.url}/api/translate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal,
  });

const status = async (server: TestServer) => (await fetch(`${server.url}/api/translate/status`)).json();

/** The paragraph to translate, out of the user message the model got (with or without background information). */
const paragraphOf = (user: string) => user.split("[Source Text]\n").pop()!.split(":\n\n").pop()!;

/** A promise a test settles by hand, to hold a model reply open until it says so. */
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

describe("translating a paragraph", () => {
  it("streams the model's chunks in order and ends with a done marker", async () => {
    const { server } = await setup({ reply: { chunks: ["第一，", "第二，", "第三。"] } });

    const response = await translate(server, { text: "One, two, three." });

    expect(response.status).toBe(200);
    expect(response.events).toEqual([{ delta: "第一，" }, { delta: "第二，" }, { delta: "第三。" }, { done: true }]);
  });

  it("sends each chunk as the model produces it, not when the whole answer is in", async () => {
    const { model, server } = await setup({ reply: { chunks: ["先", "后"], stallAfter: 1 } });

    const response = await post(server, { text: "First, then." });
    const reader = response.body!.getReader();
    const first = await reader.read();

    expect(new TextDecoder().decode(first.value)).toBe('{"delta":"先"}\n');
    expect(model.requests[0]!.finished).toBe(false);
    await reader.cancel();
  });

  it("labels the stream as newline-delimited JSON", async () => {
    const { server } = await setup();

    const response = await post(server, { text: "Hello." });

    expect(response.headers.get("content-type")).toMatch(/^application\/x-ndjson/);
    await response.body?.cancel();
  });

  it("asks the model for a streamed chat completion with one user message and no system prompt", async () => {
    const { model, server } = await setup();

    await translate(server, { text: "The fox jumped." });

    const [request] = model.chatRequests();
    expect(request!.method).toBe("POST");
    expect(request!.chat!.stream).toBe(true);
    expect(request!.chat!.messages.map((m) => m.role)).toEqual(["user"]);
    expect(request!.system).toBe("");
    expect(request!.chat!.temperature).toBeTypeOf("number");
    expect(request!.chat!.max_tokens).toBeGreaterThan(0);
  });

  it("uses the model card's settings for sampling", async () => {
    const { model, server } = await setup();

    await translate(server, { text: "The fox jumped." });

    expect(model.chatRequests()[0]!.chat).toMatchObject({ temperature: 0.7, top_p: 0.6, top_k: 20, repeat_penalty: 1.05 });
  });

  it("sends a plain translate instruction and the paragraph when there is no context", async () => {
    const { model, server } = await setup();

    await translate(server, { text: "The fox jumped." });

    expect(model.chatRequests()[0]!.user).toBe(
      "Translate the following text into Simplified Chinese. Tokens like [[1]] are names: keep them exactly as written. " +
        "Note that you must ONLY output the translated result without any additional explanation:\n\nThe fox jumped.",
    );
  });

  it("sends the previous paragraph as background information, apart from the text to translate", async () => {
    const { model, server } = await setup();

    await translate(server, { text: "She nodded.", context: "He asked if she would come." });

    expect(model.chatRequests()[0]!.user).toBe(
      "[Background Information]\nHe asked if she would come.\n\n" +
        "Please translate the following text into Simplified Chinese, taking the provided background information into consideration. " +
        "Tokens like [[1]] are names: keep them exactly as written. " +
        "Note that you must ONLY output the translated result without any additional explanation.\n\n" +
        "[Source Text]\nShe nodded.",
    );
  });

  it("sends no background section when there is no previous paragraph", async () => {
    const { model, server } = await setup();

    await translate(server, { text: "First paragraph." });
    await translate(server, { text: "Again.", context: "" });

    for (const request of model.chatRequests()) expect(request.user).not.toContain("[Background Information]");
  });

  it("sends the configured model name and API key to the model server", async () => {
    const { model, server } = await setup({ apiKey: "secret-key" }, { model: "hy-mt2-7b", apiKey: "secret-key" });

    const response = await translate(server, { text: "Hello." });

    expect(response.events.at(-1)).toEqual({ done: true });
    const [request] = model.chatRequests();
    expect(request!.chat!.model).toBe("hy-mt2-7b");
    expect(request!.headers.authorization).toBe("Bearer secret-key");
  });

  it("sends neither a model name nor an authorization header when none are configured", async () => {
    const { model, server } = await setup();

    await translate(server, { text: "Hello." });

    const [request] = model.chatRequests();
    expect(request!.chat).not.toHaveProperty("model");
    expect(request!.headers.authorization).toBeUndefined();
  });

  it("works with a base URL that ends in /v1 or a slash", async () => {
    const model = await startModelStandIn();
    cleanups.push(() => model.close());
    const server = await startTestServer({ translate: resolveConfig({}, { READER_TRANSLATE_URL: `${model.url}/v1/` }).translate });
    cleanups.push(() => server.dispose());

    const response = await translate(server, { text: "Hello." });

    expect(response.events.at(-1)).toEqual({ done: true });
  });

  it("ignores the model's reasoning fields, whichever server names them, and shows only the answer", async () => {
    const { server } = await setup({ reply: { reasoning: ["Let me think. "], chunks: ["答案。"] } });
    const ollama = await setup({ reply: { reasoning: ["Hmm. "], reasoningField: "reasoning", chunks: ["答案。"] } });

    expect((await translate(server, { text: "Answer." })).events).toEqual([{ delta: "答案。" }, { done: true }]);
    expect((await translate(ollama.server, { text: "Answer." })).events).toEqual([{ delta: "答案。" }, { done: true }]);
  });

  it("drops a <think> block that a server left inside the content", async () => {
    const { server } = await setup({ reply: { chunks: ["<thi", "nk>pondering</th", "ink>\n\n", "答案。"] } });

    const response = await translate(server, { text: "Answer." });

    expect(response.text).toBe("答案。");
  });

  it("drops whitespace around the translation", async () => {
    const { server } = await setup({ reply: { chunks: ["\n\n  你好", "，世界。 "], trailingWhitespace: true } });

    const response = await translate(server, { text: "Hello, world." });

    expect(response.text).toBe("你好，世界。");
  });

  it("keeps a Chinese character that a network chunk splits in two", async () => {
    const bytes = Buffer.from(`data: ${JSON.stringify({ choices: [{ delta: { content: "你好" } }] })}\n\ndata: [DONE]\n\n`);
    const cut = bytes.indexOf(Buffer.from("你")) + 1; // inside the three bytes of 你
    // The stand-in writes strings as UTF-8, so this one test serves the two halves as real bytes itself.
    const net = await import("node:net");
    const raw = net.createServer((socket) => {
      socket.once("data", () => {
        socket.write("HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\n\r\n");
        const chunk = (b: Buffer) => Buffer.concat([Buffer.from(`${b.length.toString(16)}\r\n`), b, Buffer.from("\r\n")]);
        socket.write(chunk(bytes.subarray(0, cut)));
        setTimeout(() => {
          socket.write(chunk(bytes.subarray(cut)));
          socket.end("0\r\n\r\n");
        }, 50);
      });
    });
    await new Promise<void>((resolve) => raw.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise((resolve) => raw.close(resolve)));
    const port = (raw.address() as import("node:net").AddressInfo).port;
    const split = await startTestServer({ translate: { url: `http://127.0.0.1:${port}` } });
    cleanups.push(() => split.dispose());

    const response = await translate(split, { text: "Hello." });

    expect(response.text).toBe("你好");
  });

  it("reads events separated by CRLF and comment lines", async () => {
    const event = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\r\n\r\n`;
    const { server } = await setup({ reply: { raw: [": keep-alive\r\n\r\n", event("你好"), "event: message\r\n", event("。"), "data: [DONE]\r\n\r\n"] } });

    const response = await translate(server, { text: "Hello." });

    expect(response.events).toEqual([{ delta: "你好" }, { delta: "。" }, { done: true }]);
  });

  it("accepts a stream that ends with a finish reason but no [DONE] line", async () => {
    const { server } = await setup({ reply: { chunks: ["你好。"], sendDone: false } });

    const response = await translate(server, { text: "Hello." });

    expect(response.events).toEqual([{ delta: "你好。" }, { done: true }]);
  });
});

describe("requests the server turns away", () => {
  it("says translation is not set up when READER_TRANSLATE_URL is unset", async () => {
    const server = await startTestServer();
    cleanups.push(() => server.dispose());

    const response = await post(server, { text: "Hello." });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "not-configured", message: "Translation is not set up on this server." } });
  });

  it.each([
    ["a body that is not JSON", "this is not json at all, and it says Zorblax"],
    ["no text", {}],
    ["blank text", { text: "   " }],
    ["text that is not a string", { text: 42 }],
    ["context that is not a string", { text: "Hello.", context: 5 }],
  ])("refuses %s with a 400 and never calls the model", async (_name, body) => {
    const { model, server } = await setup();

    const response = await post(server, body);

    expect(response.status).toBe(400);
    const { error } = (await response.json()) as { error: { code: string; message: string } };
    expect(error.code).toBe("bad-request");
    expect(error.message).not.toContain("Zorblax");
    expect(model.requests).toHaveLength(0);
  });

  it("refuses an absurdly long paragraph with a 413", async () => {
    const { model, server } = await setup();

    const response = await post(server, { text: "a".repeat(20_001) });

    expect(response.status).toBe(413);
    expect(model.requests).toHaveLength(0);
  });
});

describe("requests from other web sites", () => {
  const host = (server: TestServer) => new URL(server.url).host;
  const send = (server: TestServer, headers: Record<string, string>, body = JSON.stringify({ text: "Hello." })) =>
    fetch(`${server.url}/api/translate`, { method: "POST", headers, body });

  it("refuses a body that is not labelled as JSON with a 415, even a 'simple' text/plain one a web page could send", async () => {
    const { model, server } = await setup();

    const response = await send(server, { "content-type": "text/plain" });

    expect(response.status).toBe(415);
    const { error } = (await response.json()) as { error: { code: string; message: string } };
    expect(error.code).toBe("unsupported-media-type");
    expect(error.message).toMatch(/application\/json/);
    expect(model.requests).toHaveLength(0);
  });

  it("refuses a body with no content type at all with a 415", async () => {
    const { model, server } = await setup();

    const response = await send(server, {});

    expect(response.status).toBe(415);
    expect(model.requests).toHaveLength(0);
  });

  it("accepts the JSON content type with a charset, in any letter case", async () => {
    const { server } = await setup();

    const response = await send(server, { "content-type": "Application/JSON; charset=utf-8" });

    expect(response.status).toBe(200);
    await response.body?.cancel();
  });

  it("refuses a request from another site's origin with a 403, before the model is asked", async () => {
    const { model, server } = await setup();

    for (const origin of ["http://evil.example", "https://evil.example", "null", `http://${host(server)}.evil.example`, "http://127.0.0.1:1"]) {
      const response = await send(server, { "content-type": "application/json", origin });
      expect(response.status, origin).toBe(403);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("forbidden-origin");
    }
    expect(model.requests).toHaveLength(0);
  });

  it("tells a foreign origin it is refused before it can learn anything about the body", async () => {
    const { server } = await setup();

    const response = await send(server, { "content-type": "text/plain", origin: "http://evil.example" });

    expect(response.status).toBe(403);
  });

  it("accepts the app's own origin, over http or https and with the port", async () => {
    const { server } = await setup();

    for (const origin of [`http://${host(server)}`, `https://${host(server)}`]) {
      const response = await send(server, { "content-type": "application/json", origin });
      expect(response.status, origin).toBe(200);
      await response.body?.cancel();
    }
  });

  it("accepts a request with no Origin header (curl, other programs)", async () => {
    const { server } = await setup();

    const response = await send(server, { "content-type": "application/json" });

    expect(response.status).toBe(200);
    await response.body?.cancel();
  });

  it("still lets anyone read the status", async () => {
    const { server } = await setup();

    const response = await fetch(`${server.url}/api/translate/status`, { headers: { origin: "http://evil.example" } });

    expect(response.status).toBe(200);
  });
});

describe("keeping names in English", () => {
  const paragraph = "Mr. Bennet replied that he had not, and Mrs. Long left for Netherfield Park on Monday.";
  const before = "She told Mrs. Long that England was cold, and Mr. Bennet laughed.";
  const allNames = ["Bennet", "Long", "Netherfield", "Park"];

  it("never lets the model server see a name, and gives the names the same numbers in the context and the paragraph", async () => {
    const { model, server } = await setup();

    await translate(server, { text: paragraph, context: before });

    const user = model.chatRequests()[0]!.user;
    for (const name of allNames) expect(user).not.toContain(name);
    expect(model.chatRequests()[0]!.text).not.toContain("Bennet");
    expect(user).toContain("[Background Information]\nShe told Mrs. [[1]] that England was cold, and Mr. [[2]] laughed.\n\n");
    expect(user).toContain("[Source Text]\nMr. [[2]] replied that he had not, and Mrs. [[1]] left for [[3]] on Monday.");
  });

  it("leaves England, Monday and the other words that are not names to be translated", async () => {
    const { model, server } = await setup();

    await translate(server, { text: "On Monday in March the English left England for France.", context: "Sunday was quiet." });

    expect(model.chatRequests()[0]!.user).toContain("On Monday in March the English left England for France.");
    expect(model.chatRequests()[0]!.user).toContain("Sunday was quiet.");
  });

  it("puts the names back in what the browser gets", async () => {
    const { server } = await setup({ reply: { chunks: ["[[2]]先生回答说没有，[[1]]太太去了", "[[3]]。"] } });

    const response = await translate(server, { text: paragraph, context: before });

    expect(response.text).toBe("Bennet先生回答说没有，Long太太去了Netherfield Park。");
    expect(response.events.at(-1)).toEqual({ done: true });
  });

  it("restores every name wherever the model's chunks are cut", async () => {
    const answer = "[[2]]先生说，[[1]]太太在[[3]]，[[ 2 ]]笑了。";
    const expected = "Bennet先生说，Long太太在Netherfield Park，Bennet笑了。";
    const { model, server } = await setup();
    const chars = [...answer];

    for (let cut = 0; cut <= chars.length; cut++) {
      model.setReply({ chunks: [chars.slice(0, cut).join(""), chars.slice(cut).join("")].filter(Boolean) });
      const response = await translate(server, { text: paragraph, context: before });

      expect(response.text, `cut at ${cut}`).toBe(expected);
      for (const event of response.events) if ("delta" in event) expect(event.delta, `cut at ${cut}`).not.toMatch(/[[\]]|\d/);
    }
    // And one character at a time.
    model.setReply({ chunks: chars });
    expect((await translate(server, { text: paragraph, context: before })).text).toBe(expected);
  });

  it("holds back only what might become a token, so the translation still streams", async () => {
    const { server } = await setup({ reply: { chunks: ["你好，", "[", "[2", "]]", "先生"], chunkDelayMs: 5 } });

    const response = await translate(server, { text: paragraph });

    expect(response.events).toEqual([{ delta: "你好，" }, { delta: "Long" }, { delta: "先生" }, { done: true }]);
  });

  it("tolerates a token the model dropped", async () => {
    const { server } = await setup({ reply: { chunks: ["先生回答说没有，太太去了。"] } });

    const response = await translate(server, { text: paragraph });

    expect(response.text).toBe("先生回答说没有，太太去了。");
    expect(response.events.at(-1)).toEqual({ done: true });
  });

  it("never shows a token it cannot restore: one made up, or one cut short at the end", async () => {
    const { model, server } = await setup();
    for (const chunks of [["好[[9]]", "的"], ["很好[[", "3"], ["很好[[3", "]"], ["很好["], ["很好[[ 2 "]]) {
      model.setReply({ chunks });
      const response = await translate(server, { text: paragraph });

      expect(response.text).toMatch(/^(好的|很好)$/);
      expect(response.events.at(-1)).toEqual({ done: true });
    }
  });

  it("reports an answer that was only a token it could not restore as empty", async () => {
    const { server } = await setup({ reply: { chunks: ["[[9]]"] } });

    const response = await translate(server, { text: paragraph });

    expect(response.events).toEqual([{ error: { code: "empty", message: expect.any(String) } }]);
  });

  it("restores a token the model wrote with spaces or full-width brackets", async () => {
    const { server } = await setup({ reply: { chunks: ["[[ 1 ]]、［［２］］、【【３】】。"] } });

    const response = await translate(server, { text: paragraph });

    expect(response.text).toBe("Bennet、Long、Netherfield Park。");
  });

  it("masks a name that starts a sentence when the caller lists it", async () => {
    const { model, server } = await setup({ reply: { chunks: ["[[1]]什么也没说。"] } });

    const response = await translate(server, { text: "Elizabeth said nothing.", names: ["Elizabeth"] });

    expect(model.chatRequests()[0]!.user).toContain("[[1]] said nothing.");
    expect(model.chatRequests()[0]!.user).not.toContain("Elizabeth");
    expect(response.text).toBe("Elizabeth什么也没说。");
  });

  it("does not mask that name when nothing says it is one", async () => {
    const { model, server } = await setup();

    await translate(server, { text: "Elizabeth said nothing." });
    await translate(server, { text: "Elizabeth said nothing.", names: [] });

    for (const request of model.chatRequests()) expect(request.user).toContain("\n\nElizabeth said nothing.");
  });

  it("masks a name that starts a sentence when it is in the middle of a sentence in the context", async () => {
    const { model, server } = await setup();

    await translate(server, { text: "Elizabeth said nothing.", context: "Nobody had seen Elizabeth leave." });

    const user = model.chatRequests()[0]!.user;
    expect(user).not.toContain("Elizabeth");
    expect(user).toContain("[[1]] said nothing.");
  });

  it("masks a listed name that has a title or a first name with it, and keeps the possessive outside", async () => {
    const { model, server } = await setup({ reply: { chunks: ["[[1]]的马。"] } });

    const response = await translate(server, { text: "Darcy’s horse was ready.", names: ["Mr. Darcy"] });

    expect(model.chatRequests()[0]!.user).toContain("[[1]]’s horse was ready.");
    expect(response.text).toBe("Darcy的马。");
  });

  it("is not confused by text in the Book that already looks like a token", async () => {
    const { model, server } = await setup({ reply: { chunks: ["见注[[1]]，[[2]]先生。"] } });

    const response = await translate(server, { text: "See note [[1]], Mr. Bennet." });

    expect(model.chatRequests()[0]!.user).toContain("See note [[1]], Mr. [[2]].");
    expect(response.text).toBe("见注[[1]]，Bennet先生。");
  });

  it("keeps the mapping to one request: the next one starts again at 1", async () => {
    const { model, server } = await setup();

    await translate(server, { text: "He met Darcy." });
    await translate(server, { text: "He met Bennet." });

    expect(model.chatRequests().map((r) => r.user.split("\n\n").pop())).toEqual(["He met [[1]].", "He met [[1]]."]);
  });
});

describe("the list of names in a request", () => {
  it.each([
    ["names that is not a list", { text: "Hello.", names: "Darcy" }],
    ["names with something that is not a string in it", { text: "Hello.", names: ["Darcy", 7] }],
    ["names with a name that is too long", { text: "Hello.", names: ["D".repeat(81)] }],
    ["names with too many names", { text: "Hello.", names: Array.from({ length: 501 }, (_, i) => `Name${i}`) }],
  ])("refuses %s with a 400 and never calls the model", async (_name, body) => {
    const { model, server } = await setup();

    const response = await post(server, body);

    expect(response.status).toBe(400);
    const { error } = (await response.json()) as { error: { code: string; message: string } };
    expect(error.code).toBe("bad-request");
    expect(error.message).toMatch(/names/);
    expect(model.requests).toHaveLength(0);
  });

  it("does not repeat a name in the error", async () => {
    const { server } = await setup();

    const response = await post(server, { text: "Hello.", names: ["Zorblax", 7] });

    expect(JSON.stringify(await response.json())).not.toContain("Zorblax");
  });

  it("accepts a list at the limits, null, an empty list and blank entries", async () => {
    const { model, server } = await setup();

    for (const names of [null, [], ["", "   "], ["D".repeat(80)], Array.from({ length: 500 }, (_, i) => `Name${i}`)]) {
      const response = await post(server, { text: "Hello.", names });
      expect(response.status, JSON.stringify(names).slice(0, 40)).toBe(200);
      await response.text();
    }
    expect(model.chatRequests()).toHaveLength(5);
  });
});

describe("the status endpoint", () => {
  it("says not configured when READER_TRANSLATE_URL is unset", async () => {
    const server = await startTestServer();
    cleanups.push(() => server.dispose());

    expect(await status(server)).toEqual({ configured: false, reachable: false, model: null });
  });

  it("says configured but unreachable when nothing answers at the address", async () => {
    const server = await startTestServer({ translate: { url: await deadModelUrl() } });
    cleanups.push(() => server.dispose());

    expect(await status(server)).toEqual({ configured: true, reachable: false, model: null });
  });

  it("says ready, with the model name the backend reports", async () => {
    const { server } = await setup({ models: ["Hy-MT2-7B-Q4_K_M.gguf"] });

    expect(await status(server)).toEqual({ configured: true, reachable: true, model: "Hy-MT2-7B-Q4_K_M.gguf" });
  });

  it("reports the configured model when the backend lists it among several", async () => {
    const { server } = await setup({ models: ["other", "wanted", "third"] }, { model: "wanted" });

    expect(await status(server)).toMatchObject({ reachable: true, model: "wanted" });
  });

  it("falls back to the configured model name, or none, when the backend lists no models", async () => {
    const { model, server } = await setup({ models: [] }, { model: "mine" });
    expect(await status(server)).toEqual({ configured: true, reachable: true, model: "mine" });

    model.setModels([]);
    const unnamed = await startTestServer({ translate: { url: model.url, statusCacheMs: 0 } });
    cleanups.push(() => unnamed.dispose());
    expect(await status(unnamed)).toEqual({ configured: true, reachable: true, model: null });
  });

  it("says unreachable when the backend answers its model list with an error", async () => {
    const { server } = await setup({ models: null });

    expect(await status(server)).toMatchObject({ configured: true, reachable: false });
  });

  it("gives up on a backend that is too slow to answer, quickly", async () => {
    const { server } = await setup({ modelsDelayMs: 1500 }, { statusTimeoutMs: 100 });
    const started = Date.now();

    expect(await status(server)).toMatchObject({ configured: true, reachable: false });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("follows the backend coming and going", async () => {
    const { model, server } = await setup();
    expect(await status(server)).toMatchObject({ reachable: true });

    await model.close();

    expect(await status(server)).toMatchObject({ reachable: false });
  });

  it("reuses an answer for a short while instead of asking the backend each time", async () => {
    const { model, server } = await setup({}, { statusCacheMs: 60_000 });

    await Promise.all([status(server), status(server)]);
    await status(server);

    expect(model.requests.filter((r) => r.path === "/v1/models")).toHaveLength(1);
  });

  it("sends the API key when checking the backend", async () => {
    const { model, server } = await setup({ apiKey: "k" }, { apiKey: "k" });

    expect(await status(server)).toMatchObject({ reachable: true });
    expect(model.requests[0]!.headers.authorization).toBe("Bearer k");
  });
});

describe("limiting the load on the model", () => {
  it("runs one request at a time by default and serves the rest in the order they arrived", async () => {
    const first = gate();
    const { model, server } = await setup({ reply: (request) => ({ chunks: [`译:${paragraphOf(request.user)}`], waitFor: request.user.includes("one") ? first.promise : undefined }) });

    const one = translate(server, { text: "one" });
    await model.until(() => model.requests.length === 1);
    const two = translate(server, { text: "two" });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const three = translate(server, { text: "three" });
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Only the first has reached the model; the others are waiting at the app.
    expect(model.chatRequests()).toHaveLength(1);
    first.resolve();
    const results = await Promise.all([one, two, three]);

    expect(results.map((r) => r.text)).toEqual(["译:one", "译:two", "译:three"]);
    expect(model.chatRequests().map((r) => paragraphOf(r.user))).toEqual(["one", "two", "three"]);
    expect(model.peakInFlight()).toBe(1);
  });

  it("runs as many at once as READER_TRANSLATE_CONCURRENCY allows", async () => {
    const release = gate();
    const { model, server } = await setup({ reply: { waitFor: release.promise } }, { concurrency: 2 });

    const all = [1, 2, 3, 4].map((n) => translate(server, { text: `paragraph ${n}` }));
    await model.until(() => model.inFlight() === 2);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(model.chatRequests()).toHaveLength(2);
    release.resolve();
    const results = await Promise.all(all);

    expect(results.every((r) => r.events.at(-1) && "done" in r.events.at(-1)!)).toBe(true);
    expect(model.chatRequests()).toHaveLength(4);
    expect(model.peakInFlight()).toBe(2);
  });

  it("frees the place when a request fails, so the next one runs", async () => {
    const { model, server } = await setup();
    model.replyOnce({ status: 500 });

    const failed = await translate(server, { text: "bad luck" });
    const next = await translate(server, { text: "next" });

    expect(failed.events[0]).toMatchObject({ error: { code: "backend-error" } });
    expect(next.events.at(-1)).toEqual({ done: true });
  });
});

describe("a browser that goes away", () => {
  it("drops a request that is still waiting for its turn, without ever calling the model for it", async () => {
    const release = gate();
    const { model, server } = await setup({ reply: (request) => (request.user.includes("blocker") ? { waitFor: release.promise } : {}) });
    const blocker = translate(server, { text: "blocker" });
    await model.until(() => model.requests.length === 1);

    const abandoned = new AbortController();
    const waiting = translate(server, { text: "abandoned" }, { signal: abandoned.signal });
    await new Promise((resolve) => setTimeout(resolve, 100));
    abandoned.abort();
    await expect(waiting).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 100));
    release.resolve();
    await blocker;
    const after = await translate(server, { text: "after" });

    expect(after.events.at(-1)).toEqual({ done: true });
    const asked = model.chatRequests().map((r) => r.user);
    expect(asked).toHaveLength(2);
    expect(asked.some((user) => user.includes("abandoned"))).toBe(false);
  });

  it("aborts the request to the model when the browser leaves mid-translation, and frees the place", async () => {
    const { model, server } = await setup({ reply: { chunks: ["一", "二"], stallAfter: 1 } });
    const leaving = new AbortController();
    const response = await post(server, { text: "Long paragraph." }, leaving.signal);
    await response.body!.getReader().read(); // the first chunk has come through

    leaving.abort();

    await model.until(() => model.chatRequests()[0]!.aborted);
    model.setReply({});
    const after = await translate(server, { text: "Next." });
    expect(after.events.at(-1)).toEqual({ done: true });
  });

  it("aborts the request to the model when the browser leaves before the model has said anything", async () => {
    const { model, server } = await setup({ reply: { hang: true } });
    const leaving = new AbortController();
    const response = await post(server, { text: "Silence." }, leaving.signal); // headers come at once, text never
    await model.until(() => model.requests.length === 1);

    leaving.abort();

    await expect(response.text()).rejects.toThrow();
    await model.until(() => model.chatRequests()[0]!.aborted);
  });
});

describe("trouble with the model, reported cleanly", () => {
  const lastEvent = (events: StreamedEvent[]) => events.at(-1) as { error: { code: string; message: string } };

  it("reports a model server that is not running", async () => {
    const server = await startTestServer({ translate: { url: await deadModelUrl() } });
    cleanups.push(() => server.dispose());

    const response = await translate(server, { text: "Hello." });

    expect(response.status).toBe(200);
    expect(response.events).toEqual([{ error: { code: "unreachable", message: expect.any(String) } }]);
  });

  it.each([
    [500, "backend-error", /HTTP 500/],
    [503, "backend-error", /HTTP 503/],
    [400, "backend-error", /HTTP 400/],
    [401, "backend-error", /READER_TRANSLATE_API_KEY/],
    [404, "backend-error", /READER_TRANSLATE_URL/],
  ])("reports HTTP %i from the model server as %s", async (httpStatus, code, message) => {
    const { server } = await setup({ reply: { status: httpStatus } });

    const response = await translate(server, { text: "Hello." });

    expect(response.events).toHaveLength(1);
    expect(lastEvent(response.events).error.code).toBe(code);
    expect(lastEvent(response.events).error.message).toMatch(message);
  });

  it("reports an error the model sends inside the stream, after some text", async () => {
    const { server } = await setup({ reply: { chunks: ["半"], errorEvent: { message: "out of memory" }, sendDone: false, finishReason: null } });

    const response = await translate(server, { text: "Half." });

    expect(response.events[0]).toEqual({ delta: "半" });
    expect(lastEvent(response.events).error.code).toBe("backend-error");
    expect(response.events).toHaveLength(2);
  });

  it("reports a model that declines to translate", async () => {
    const { server } = await setup({ reply: { chunks: [""], finishReason: "content_filter" } });

    expect(lastEvent((await translate(server, { text: "Hello." })).events).error.code).toBe("refused");
  });

  it("reports a translation cut off at the length limit, after the part that came", async () => {
    const { server } = await setup({ reply: { chunks: ["很长"], finishReason: "length" } });

    const response = await translate(server, { text: "Hello." });

    expect(response.events[0]).toEqual({ delta: "很长" });
    expect(lastEvent(response.events).error.code).toBe("truncated");
  });

  it("reports an answer with no translation in it", async () => {
    const { server } = await setup({ reply: { chunks: ["", "  \n"] } });

    expect(lastEvent((await translate(server, { text: "Hello." })).events).error.code).toBe("empty");
  });

  it.each([
    ["an event that is not JSON", ["data: {not json\n\n"]],
    ["an event that is not an object", ["data: 42\n\n"]],
    ["a stream that ends in the middle, with no finish and no [DONE]", [`data: ${JSON.stringify({ choices: [{ delta: { content: "半" } }] })}\n\n`]],
    ["a plain HTML page instead of a stream", ["<html>Not a model</html>"]],
  ])("reports %s as a bad stream", async (_name, raw) => {
    const { server } = await setup({ reply: { raw } });

    const response = await translate(server, { text: "Hello." });

    expect(response.status).toBe(200);
    expect(lastEvent(response.events).error.code).toBe("bad-stream");
  });

  it("reports a model that goes silent as stalled, aborts the request, and moves on", async () => {
    const { model, server } = await setup({ reply: { chunks: ["一", "二"], stallAfter: 1 } }, { idleTimeoutMs: 200 });

    const response = await translate(server, { text: "Hello." });

    expect(response.events[0]).toEqual({ delta: "一" });
    expect(lastEvent(response.events).error.code).toBe("stalled");
    await model.until(() => model.chatRequests()[0]!.aborted);
    model.setReply({});
    expect((await translate(server, { text: "Again." })).events.at(-1)).toEqual({ done: true });
  });

  it("reports a model that never starts answering as stalled", async () => {
    const { model, server } = await setup({ reply: { hang: true } }, { idleTimeoutMs: 150 });

    const response = await translate(server, { text: "Hello." });

    expect(lastEvent(response.events).error.code).toBe("stalled");
    await model.until(() => model.chatRequests()[0]!.aborted);
  });

  it("gives up on a translation that takes too long overall even while the model keeps talking", async () => {
    const { model, server } = await setup(
      { reply: { chunks: Array.from({ length: 40 }, () => "字"), chunkDelayMs: 40 } },
      { requestTimeoutMs: 300, idleTimeoutMs: 5000 },
    );

    const response = await translate(server, { text: "Hello." });

    expect(lastEvent(response.events).error.code).toBe("timeout");
    await model.until(() => model.chatRequests()[0]!.aborted);
  });

  it("counts reasoning text from the model as a sign of life", async () => {
    const { server } = await setup(
      { reply: { reasoning: ["a", "b", "c", "d", "e"], chunkDelayMs: 0, delayMs: 0, chunks: ["好"] } },
      { idleTimeoutMs: 300 },
    );

    expect((await translate(server, { text: "Hello." })).events).toEqual([{ delta: "好" }, { done: true }]);
  });

  it("keeps working after every kind of failure", async () => {
    const { model, server } = await setup();
    for (const reply of [{ status: 500 }, { raw: ["data: {\n\n"] }, { hang: true }]) {
      model.replyOnce(reply);
    }
    const tight = await startTestServer({ translate: { url: model.url, idleTimeoutMs: 150 } });
    cleanups.push(() => tight.dispose());

    for (let i = 0; i < 3; i++) await translate(tight, { text: "Trouble." });

    expect((await translate(tight, { text: "Fine." })).events.at(-1)).toEqual({ done: true });
    expect((await translate(server, { text: "Fine." })).events.at(-1)).toEqual({ done: true });
  });
});

describe("privacy", () => {
  const english = "Zorblax Quillfeather walked to Marrowgate at dawn.";
  const context = "Previously, Zorblax Quillfeather had slept badly.";
  const chinese = "佐布拉克斯·奎尔费瑟黎明时走向马罗门。";

  /** Every file under `dir`, read as bytes. */
  function allFiles(dir: string): Buffer[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? allFiles(path) : [readFileSync(path)];
    });
  }

  function captureOutput(): () => string {
    const captured: string[] = [];
    const keep = (...args: unknown[]) => void captured.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(" "));
    for (const method of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, method).mockImplementation(keep);
    const writer = (chunk: unknown) => (captured.push(String(chunk)), true);
    vi.spyOn(process.stdout, "write").mockImplementation(writer as typeof process.stdout.write);
    vi.spyOn(process.stderr, "write").mockImplementation(writer as typeof process.stderr.write);
    return () => captured.join("\n");
  }

  it("leaves no Book text in logs, error messages, the data folder or the database, whatever happens", async () => {
    const output = captureOutput();
    const { model, server } = await setup({ reply: { chunks: [chinese] } }, { idleTimeoutMs: 150 });
    const responses: string[] = [];
    const remember = async (promise: Promise<{ text: string; events: StreamedEvent[] }>) =>
      void responses.push(JSON.stringify((await promise).events.filter((e) => !("delta" in e))));

    await remember(translate(server, { text: english, context })); // success
    // The model server's error answers often repeat the request; none of it may travel on.
    model.replyOnce({ status: 400, body: JSON.stringify({ error: { message: `bad prompt: ${english} ${context} ${chinese}` } }) });
    await remember(translate(server, { text: english, context }));
    model.replyOnce({ raw: [`data: {broken ${english}\n\n`] });
    await remember(translate(server, { text: english, context }));
    model.replyOnce({ chunks: [chinese], errorEvent: { message: english }, sendDone: false, finishReason: null });
    await remember(translate(server, { text: english, context }));
    model.replyOnce({ chunks: [chinese], stallAfter: 1 }); // stalls
    await remember(translate(server, { text: english, context }));
    await post(server, `{"text": "${english}", `); // malformed JSON
    const leaving = new AbortController();
    model.replyOnce({ hang: true });
    const pending = post(server, { text: english }, leaving.signal);
    await model.until(() => model.requests.length > 5);
    leaving.abort();
    await pending.catch(() => {});
    await model.until(() => model.chatRequests().at(-1)!.aborted);

    for (const secret of [english, context, chinese, "Zorblax", "Quillfeather", "Marrowgate", "佐布拉克斯"]) {
      expect(output(), `logs mention ${secret}`).not.toContain(secret);
      for (const line of responses) expect(line, `an error message mentions ${secret}`).not.toContain(secret);
      for (const file of allFiles(server.dataDir)) {
        expect(file.includes(Buffer.from(secret)), `a file in the data folder holds ${secret}`).toBe(false);
        expect(file.includes(Buffer.from(secret, "utf16le")), `a file in the data folder holds ${secret} (UTF-16)`).toBe(false);
      }
    }
    // The scan is not vacuous: the stand-in did see the text (with the names masked).
    expect(model.chatRequests()[0]!.user).toContain("[[1]] walked to [[2]] at dawn.");
  });
});

describe("configuration", () => {
  const translateOf = (env: Record<string, string>) => resolveConfig({}, env).translate;

  it("is not set up when READER_TRANSLATE_URL is missing or blank", () => {
    expect(translateOf({}).url).toBeUndefined();
    expect(translateOf({ READER_TRANSLATE_URL: "   " }).url).toBeUndefined();
  });

  it("reads the URL, model and API key from the environment", () => {
    expect(
      translateOf({ READER_TRANSLATE_URL: "http://127.0.0.1:8080", READER_TRANSLATE_MODEL: "m", READER_TRANSLATE_API_KEY: "k" }),
    ).toMatchObject({ url: "http://127.0.0.1:8080", model: "m", apiKey: "k" });
    expect(translateOf({ READER_TRANSLATE_URL: "http://x:1" })).toMatchObject({ model: undefined, apiKey: undefined });
  });

  it.each([
    ["http://127.0.0.1:8080/", "http://127.0.0.1:8080"],
    ["http://127.0.0.1:8080/v1", "http://127.0.0.1:8080"],
    ["http://127.0.0.1:8080/v1/", "http://127.0.0.1:8080"],
    ["https://gpu-pc.tail1234.ts.net", "https://gpu-pc.tail1234.ts.net"],
    ["http://gpu-pc:11434/ollama/v1", "http://gpu-pc:11434/ollama"],
  ])("tidies the URL %s to %s", (given, expected) => {
    expect(translateOf({ READER_TRANSLATE_URL: given }).url).toBe(expected);
  });

  it.each(["not a url", "127.0.0.1:8080", "ftp://host"])("refuses the unusable URL %s with a message that names the variable", (url) => {
    expect(() => translateOf({ READER_TRANSLATE_URL: url })).toThrow(ConfigError);
    expect(() => translateOf({ READER_TRANSLATE_URL: url })).toThrow(/READER_TRANSLATE_URL/);
  });

  it("allows one request at a time unless READER_TRANSLATE_CONCURRENCY says otherwise", () => {
    expect(translateOf({}).concurrency).toBe(1);
    expect(translateOf({ READER_TRANSLATE_CONCURRENCY: "" }).concurrency).toBe(1);
    expect(translateOf({ READER_TRANSLATE_CONCURRENCY: "3" }).concurrency).toBe(3);
  });

  it.each(["0", "-1", "1.5", "many"])("refuses READER_TRANSLATE_CONCURRENCY=%s", (value) => {
    expect(() => translateOf({ READER_TRANSLATE_CONCURRENCY: value })).toThrow(/READER_TRANSLATE_CONCURRENCY/);
  });

  it("has time limits that suit a slow laptop by default", () => {
    const { requestTimeoutMs, idleTimeoutMs, statusTimeoutMs } = translateOf({});
    expect(requestTimeoutMs).toBeGreaterThanOrEqual(120_000);
    expect(idleTimeoutMs).toBeGreaterThanOrEqual(30_000);
    expect(statusTimeoutMs).toBeLessThanOrEqual(5_000);
  });

  it("starts the whole server from the environment variables", async () => {
    const model = await startModelStandIn();
    cleanups.push(() => model.close());
    vi.stubEnv("READER_TRANSLATE_URL", model.url);
    vi.stubEnv("READER_TRANSLATE_MODEL", "from-env");
    vi.stubEnv("READER_TRANSLATE_API_KEY", "key-from-env");
    const { startServer } = await import("../../src/server/server.ts");
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const root = await mkdtemp(join(tmpdir(), "reader-env-"));
    const server = await startServer({ dataDir: join(root, "data"), libraryDir: join(root, "library"), port: 0 });
    cleanups.push(() => server.close().then(() => rm(root, { recursive: true, force: true })));

    const response = await translate(server, { text: "Hello." });

    expect(response.events.at(-1)).toEqual({ done: true });
    expect(model.chatRequests()[0]!.chat!.model).toBe("from-env");
    expect(model.chatRequests()[0]!.headers.authorization).toBe("Bearer key-from-env");
  });
});
