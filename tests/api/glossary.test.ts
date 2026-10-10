// A Book's Glossary (issue #28): the first time a name is met its Chinese form is decided by one short name request and
// saved; every later paragraph of that Book is translated with that form, whatever the model would say; a failed name
// request never fails the paragraph; and the Glossary goes with its Book.
import { afterEach, describe, expect, it } from "vitest";
import { chineseForm, glossaryKey, parseNameForms } from "../../src/server/glossary.ts";
import { startModelStandIn, type ModelStandIn, type RecordedRequest, type StandInReply } from "../helpers/model-stand-in.ts";
import { startTestServer, translate, uploadFixture, type TestServer } from "./helpers.ts";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

/**
 * The app with a Book, and a model that answers name requests from `forms` (name → Chinese) and paragraphs with a
 * fixed sentence. `nameReply` replaces the answer to name requests.
 */
async function setup(options: { forms?: Record<string, string>; nameReply?: (request: RecordedRequest) => StandInReply; concurrency?: number } = {}) {
  const forms = options.forms ?? { River: "瑞弗", Darcy: "达西" };
  const model: ModelStandIn = await startModelStandIn({
    reply: { chunks: ["译文。"] },
    names: (asked, request) => options.nameReply?.(request) ?? { chunks: [asked.map((name) => `${name} = ${forms[name] ?? "某"}`).join("\n")] },
  });
  cleanups.push(() => model.close());
  const server = await startTestServer({ translate: { url: model.url, concurrency: options.concurrency ?? 1 } });
  cleanups.push(() => server.dispose());
  const bookId = (await (await uploadFixture(server, "sample.epub")).json()).book.id as string;
  return { model, server, bookId };
}

const paragraphRequests = (model: ModelStandIn) => model.chatRequests();
const nameRequests = (model: ModelStandIn) => model.nameRequests();
const glossary = async (server: TestServer, bookId: string) => {
  const response = await fetch(`${server.url}/api/books/${bookId}/glossary`);
  return ((await response.json()) as { entries: Array<{ name: string; form: string; seen: number; byReader: boolean; notName: boolean }> }).entries;
};

const put = (server: TestServer, bookId: string, body: unknown) =>
  fetch(`${server.url}/api/books/${bookId}/glossary`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("the Glossary in translation", () => {
  it("asks for a new name's form once, saves it, and gives it with the paragraph", async () => {
    const { model, server, bookId } = await setup();

    const result = await translate(server, { text: "The water near River was cold.", bookId });

    expect(result.text).toBe("译文。");
    expect(nameRequests(model)).toHaveLength(1);
    expect(nameRequests(model)[0]!.user).toMatch(/\n\nRiver$/);
    expect(paragraphRequests(model)[0]!.user).toContain("Use exactly these Chinese forms for names: River = 瑞弗.");
    expect(await glossary(server, bookId)).toMatchObject([{ name: "River", form: "瑞弗", seen: 1 }]);
  });

  it("uses the saved form in later paragraphs without asking again", async () => {
    const { model, server, bookId } = await setup();
    await translate(server, { text: "They met River at dawn.", bookId });

    await translate(server, { text: "Later, the boat took River's things away.", bookId });

    expect(nameRequests(model)).toHaveLength(1);
    expect(paragraphRequests(model)[1]!.user).toContain("River = 瑞弗");
    expect(await glossary(server, bookId)).toMatchObject([{ name: "River", seen: 2 }]);
  });

  it("asks only about the names that are new", async () => {
    const { model, server, bookId } = await setup();
    await translate(server, { text: "They met River at dawn.", bookId });

    await translate(server, { text: "Then River saw Mr. Darcy by the gate.", bookId });

    expect(nameRequests(model)).toHaveLength(2);
    expect(nameRequests(model)[1]!.user).toMatch(/\n\nDarcy$/);
    expect(paragraphRequests(model)[1]!.user).toContain("Use exactly these Chinese forms for names: River = 瑞弗, Darcy = 达西.");
  });

  it("keeps the first form even if the model would now say another", async () => {
    let form = "瑞弗";
    const { server, bookId, model } = await setup({ nameReply: () => ({ chunks: [`River = ${form}`] }) });
    await translate(server, { text: "They met River at dawn.", bookId });
    form = "里佛";

    await translate(server, { text: "The light found River again.", bookId });

    expect(paragraphRequests(model).at(-1)!.user).toContain("River = 瑞弗");
  });

  it("translates the paragraph with the plain rule when the name request fails, and asks again next time", async () => {
    let fail = true;
    const { model, server, bookId } = await setup({ nameReply: () => (fail ? { status: 500, body: "{}" } : { chunks: ["River = 瑞弗"] }) });

    const first = await translate(server, { text: "They met River at dawn.", bookId });

    expect(first.text).toBe("译文。");
    expect(first.events.at(-1)).toEqual({ done: true });
    expect(paragraphRequests(model)[0]!.user).toContain("Names in the text: River.");
    expect(paragraphRequests(model)[0]!.user).not.toContain("Use exactly");
    expect(await glossary(server, bookId)).toEqual([]);

    fail = false;
    await translate(server, { text: "Then River slept.", bookId });
    expect(await glossary(server, bookId)).toMatchObject([{ name: "River", form: "瑞弗" }]);
  });

  it("ignores an answer that is not a Chinese form", async () => {
    const { model, server, bookId } = await setup({ nameReply: () => ({ chunks: ["River = River (a name)\nSure! Here you go."] }) });

    await translate(server, { text: "They met River at dawn.", bookId });

    expect(await glossary(server, bookId)).toEqual([]);
    expect(paragraphRequests(model)[0]!.user).toContain("Names in the text: River.");
  });

  it("makes one entry when two paragraphs meet the same new name at once", async () => {
    let answer = 0;
    const forms = ["瑞弗", "里佛"];
    const { server, bookId, model } = await setup({
      concurrency: 2,
      nameReply: () => ({ chunks: [`River = ${forms[answer++ % 2]}`], delayMs: 50 }),
    });

    await Promise.all([translate(server, { text: "They met River at dawn.", bookId }), translate(server, { text: "Later River slept.", bookId })]);

    const entries = await glossary(server, bookId);
    expect(entries).toHaveLength(1);
    const used = paragraphRequests(model).map((request) => /River = (\S+?)[.,]/.exec(request.user)?.[1]);
    expect(used).toEqual([entries[0]!.form, entries[0]!.form]);
  });

  it("is per Book, and translation without a Book uses none", async () => {
    const { model, server, bookId } = await setup();
    const other = (await (await uploadFixture(server, "sample.md")).json()).book.id as string;
    await translate(server, { text: "They met River at dawn.", bookId });

    await translate(server, { text: "They met River at dawn.", bookId: other });
    await translate(server, { text: "They met River at dawn." });

    expect(nameRequests(model)).toHaveLength(2); // the first Book's and the second's; none without a Book
    expect(paragraphRequests(model)[2]!.user).toContain("Names in the text: River.");
  });

  it("ignores an id that is not a Book", async () => {
    const { model, server } = await setup();
    const result = await translate(server, { text: "They met River at dawn.", bookId: "0".repeat(64) });
    expect(result.text).toBe("译文。");
    expect(nameRequests(model)).toHaveLength(0);
  });

  it("is deleted with its Book", async () => {
    const { server, bookId } = await setup();
    await translate(server, { text: "They met River at dawn.", bookId });

    await fetch(`${server.url}/api/books/${bookId}`, { method: "DELETE" });
    await uploadFixture(server, "sample.epub");

    expect(await glossary(server, bookId)).toEqual([]);
  });
});

describe("names of several words (issue #43)", () => {
  it("keeps River Cartwright one name at the start of a sentence, and gives its parts their own entries", async () => {
    const { model, server, bookId } = await setup({ forms: { "River Cartwright": "瑞弗·卡特怀特" } });

    await translate(server, { text: "River Cartwright looked up.", bookId });

    expect(nameRequests(model)[0]!.user).toMatch(/\n\nRiver Cartwright$/);
    expect(paragraphRequests(model)[0]!.user).toContain("River Cartwright = 瑞弗·卡特怀特");
    expect((await glossary(server, bookId)).map((entry) => `${entry.name}=${entry.form}`).sort()).toEqual([
      "Cartwright=卡特怀特",
      "River Cartwright=瑞弗·卡特怀特",
      "River=瑞弗",
    ]);
  });

  it("knows the Glossary's names at the start of a sentence", async () => {
    const { model, server, bookId } = await setup({ forms: { "River Cartwright": "瑞弗·卡特怀特" } });
    await translate(server, { text: "River Cartwright looked up.", bookId });

    await translate(server, { text: "River laughed.", bookId });

    expect(nameRequests(model)).toHaveLength(1);
    expect(paragraphRequests(model)[1]!.user).toContain("River = 瑞弗");
  });

  it("tells the model the forms already used for the parts of a new name", async () => {
    const { model, server, bookId } = await setup({ forms: { Cartwright: "卡特怀特" } });
    await translate(server, { text: "They met Cartwright.", bookId });

    await translate(server, { text: "They met River Cartwright.", bookId });

    expect(nameRequests(model)[1]!.user).toContain("Keep the forms already used in this book for parts of these names: Cartwright = 卡特怀特.");
  });

  it("gives the parts of a name the reader sets their own entries, keeping the ones there", async () => {
    const { server, bookId } = await setup();
    await put(server, bookId, { name: "Cartwright", form: "卡莱特" });

    expect((await put(server, bookId, { name: "River Cartwright", form: "瑞弗·卡特怀特" })).status).toBe(200);

    expect((await glossary(server, bookId)).map((entry) => `${entry.name}=${entry.form}`).sort()).toEqual([
      "Cartwright=卡莱特",
      "River Cartwright=瑞弗·卡特怀特",
      "River=瑞弗",
    ]);
  });
});

describe("reading names and forms", () => {
  it("keeps the forms of one name under one key", () => {
    expect(glossaryKey("Darcy")).toBe("darcy");
    expect(glossaryKey("Darcy's")).toBe("darcy");
    expect(glossaryKey("Mr. Darcy")).toBe("darcy");
    expect(glossaryKey("Elizabeth  Bennet")).toBe("elizabeth bennet");
    expect(glossaryKey("Lady")).toBe("lady");
  });

  it("accepts Chinese characters with the separator dot, and nothing else", () => {
    expect(chineseForm("瑞弗")).toBe("瑞弗");
    expect(chineseForm(" 伊丽莎白・班内特。")).toBe("伊丽莎白·班内特");
    expect(chineseForm("“达西”")).toBe("达西");
    expect(chineseForm("River")).toBeUndefined();
    expect(chineseForm("瑞弗 (River)")).toBeUndefined();
    expect(chineseForm("")).toBeUndefined();
    expect(chineseForm("长".repeat(13))).toBeUndefined();
  });

  it("reads one line per name, in the usual shapes, and only the names asked about", () => {
    const forms = parseNameForms("1. River = 瑞弗\n- Darcy: 达西\nLondon → 伦敦\nBingley = 宾利\nnoise", ["River", "Darcy", "London"]);
    expect([...forms]).toEqual([
      ["river", "瑞弗"],
      ["darcy", "达西"],
      ["london", "伦敦"],
    ]);
  });
});

describe("the Glossary API", () => {
  const send = (server: TestServer, bookId: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${server.url}/api/books/${bookId}/glossary${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it("adds a name the reader gives, and changes a form; the model never replaces it", async () => {
    const { server, bookId, model } = await setup();

    const added = await send(server, bookId, "PUT", "", { name: "River", form: "里弗" });
    expect(added.status).toBe(200);
    expect(await added.json()).toMatchObject({ key: "river", name: "River", form: "里弗", byReader: true });

    await translate(server, { text: "They met River at dawn.", bookId });
    expect(model.nameRequests()).toHaveLength(0);
    expect(paragraphRequests(model)[0]!.user).toContain("River = 里弗");

    await send(server, bookId, "PUT", "", { name: "Mr. River", form: "瑞福" });
    expect(await glossary(server, bookId)).toMatchObject([{ name: "River", form: "瑞福" }]);
  });

  it("refuses a form that is not Chinese, and a missing name", async () => {
    const { server, bookId } = await setup();
    expect((await send(server, bookId, "PUT", "", { name: "River", form: "River" })).status).toBe(400);
    expect((await send(server, bookId, "PUT", "", { name: " ", form: "瑞弗" })).status).toBe(400);
    expect((await send(server, bookId, "PUT", "", { name: "x".repeat(81), form: "瑞弗" })).status).toBe(400);
  });

  it("removes a name, so it is asked about afresh", async () => {
    const { server, bookId, model } = await setup();
    await translate(server, { text: "They met River at dawn.", bookId });

    const removed = await fetch(`${server.url}/api/books/${bookId}/glossary/${encodeURIComponent("river")}`, { method: "DELETE" });

    expect(removed.status).toBe(204);
    expect(await glossary(server, bookId)).toEqual([]);
    await translate(server, { text: "They met River at dawn.", bookId });
    expect(model.nameRequests()).toHaveLength(2);
    expect((await fetch(`${server.url}/api/books/${bookId}/glossary/nobody`, { method: "DELETE" })).status).toBe(404);
  });

  it("lists the names most often met first", async () => {
    const { server, bookId } = await setup();
    await translate(server, { text: "They met River and Darcy.", bookId });
    await translate(server, { text: "Then Darcy left.", bookId });
    expect((await glossary(server, bookId)).map((entry) => entry.name)).toEqual(["Darcy", "River"]);
  });

  it("exports the Glossary as JSON and imports it into another Book, keeping the reader's own forms", async () => {
    const { server, bookId } = await setup();
    await translate(server, { text: "They met River and Darcy.", bookId });
    const exported = await fetch(`${server.url}/api/books/${bookId}/glossary/export`);
    expect(exported.headers.get("content-disposition")).toMatch(/attachment/);
    const file = await exported.json();
    expect(file).toMatchObject({ format: "reader-glossary", version: 1, entries: expect.arrayContaining([{ name: "River", form: "瑞弗" }]) });

    const other = (await (await uploadFixture(server, "sample.md")).json()).book.id as string;
    await send(server, other, "PUT", "", { name: "Darcy", form: "达尔西" });
    const imported = await send(server, other, "POST", "/import", file);

    expect(await imported.json()).toEqual({ added: 1, changed: 0, kept: 1 });
    const entries = await glossary(server, other);
    expect(entries).toEqual(expect.arrayContaining([expect.objectContaining({ name: "River", form: "瑞弗" }), expect.objectContaining({ name: "Darcy", form: "达尔西" })]));
  });

  it("refuses an import that is not a Glossary", async () => {
    const { server, bookId } = await setup();
    expect((await send(server, bookId, "POST", "/import", { entries: "no" })).status).toBe(400);
    expect((await send(server, bookId, "POST", "/import", { entries: [{ name: "River", form: "River" }] })).status).toBe(400);
    expect(await glossary(server, bookId)).toEqual([]);
  });

  it("refuses writes from other sites, and anything but JSON", async () => {
    const { server, bookId } = await setup();
    expect((await send(server, bookId, "PUT", "", { name: "River", form: "瑞弗" }, { origin: "https://example.com" })).status).toBe(403);
    expect((await send(server, bookId, "PUT", "", { name: "River", form: "瑞弗" }, { "content-type": "text/plain" })).status).toBe(415);
    expect((await fetch(`${server.url}/api/books/${bookId}/glossary/river`, { method: "DELETE", headers: { origin: "https://example.com" } })).status).toBe(403);
    expect((await fetch(`${server.url}/api/books/${"0".repeat(64)}/glossary`)).status).toBe(404);
  });
});

describe("checking new names (issue #44)", () => {
  it("reports the names a request added, before the text, and only the first time", async () => {
    const { server, bookId } = await setup({ forms: { "River Cartwright": "瑞弗·卡特怀特" } });

    const first = await translate(server, { text: "River Cartwright looked up.", bookId });
    const again = await translate(server, { text: "They saw River Cartwright.", bookId });

    expect(first.events[0]).toEqual({ names: [{ key: "river cartwright", name: "River Cartwright", form: "瑞弗·卡特怀特" }] });
    expect(first.text).toBe("译文。");
    expect(again.events.some((event) => "names" in event)).toBe(false);
  });

  it("sends no names without a Book", async () => {
    const { server } = await setup();
    expect((await translate(server, { text: "They met River at dawn." })).events.some((event) => "names" in event)).toBe(false);
  });

  it("keeps a word the reader says is not a name out of the names, and never asks about it", async () => {
    const { model, server, bookId } = await setup();
    const marked = await put(server, bookId, { name: "Hope", notName: true });
    expect(marked.status).toBe(200);
    expect(await marked.json()).toMatchObject({ key: "hope", name: "Hope", form: "", notName: true, byReader: true });

    await translate(server, { text: "They said Hope was gone, and River smiled.", bookId });

    expect(nameRequests(model)[0]!.user).toMatch(/\n\nRiver$/);
    expect(paragraphRequests(model)[0]!.user).toContain("Use exactly these Chinese forms for names: River = 瑞弗.");
    expect(paragraphRequests(model)[0]!.user).not.toMatch(/Hope =|Names in the text:[^.]*Hope/);
  });

  it("shortens a joined name the reader says is not one to the name after the first word", async () => {
    const { model, server, bookId } = await setup({ forms: { Cartwright: "卡特怀特" } });
    await put(server, bookId, { name: "Dawn Cartwright", notName: true });

    await translate(server, { text: "Dawn Cartwright woke.", bookId });

    expect(nameRequests(model)[0]!.user).toMatch(/\n\nCartwright$/);
  });

  it("lists not-a-name entries, exports and imports them, and removing one lets the word be a name again", async () => {
    const { model, server, bookId } = await setup();
    await put(server, bookId, { name: "River", notName: true });
    expect(await glossary(server, bookId)).toMatchObject([{ name: "River", notName: true }]);

    const exported = await (await fetch(`${server.url}/api/books/${bookId}/glossary/export`)).json();
    expect(exported.entries).toEqual([{ name: "River", notName: true }]);

    expect((await fetch(`${server.url}/api/books/${bookId}/glossary/river`, { method: "DELETE" })).status).toBe(204);
    await translate(server, { text: "They met River at dawn.", bookId });
    expect(nameRequests(model)).toHaveLength(1);

    const other = (await (await uploadFixture(server, "english-mixed.epub")).json()).book.id as string;
    const imported = await fetch(`${server.url}/api/books/${other}/glossary/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(exported),
    });
    expect(await imported.json()).toEqual({ added: 1, changed: 0, kept: 0 });
    expect(await glossary(server, other)).toMatchObject([{ name: "River", notName: true }]);
  });

  it("keeps a name with the model's form when the reader keeps it, which marks it checked", async () => {
    const { server, bookId } = await setup();
    await translate(server, { text: "They met River at dawn.", bookId });
    expect(await glossary(server, bookId)).toMatchObject([{ name: "River", form: "瑞弗", byReader: false }]);

    await put(server, bookId, { name: "River", form: "瑞弗" });

    expect(await glossary(server, bookId)).toMatchObject([{ name: "River", form: "瑞弗", byReader: true, notName: false }]);
  });
});
