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
  return ((await response.json()) as { entries: Array<{ name: string; form: string; seen: number }> }).entries;
};

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
