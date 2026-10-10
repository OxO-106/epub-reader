// Checking new names (issue #44, ADR 0180): when translation adds names to the Book's Glossary, a card asks about each
// one; Keep saves the form (edited or not) as the reader's, Not a name keeps the word out of the names, Later moves
// on, and Stop asking turns the card off until the Glossary panel turns it back on.
import { expect, test } from "./fixtures.ts";
import type { Page } from "@playwright/test";
import { openBook, setTranslation, untilReady } from "./translation-helpers.ts";

test.use({ withModel: true });

const card = (page: Page) => page.getByRole("region", { name: /New name/ });
const glossaryOf = async (page: Page) => {
  const id = new URL(page.url()).hash.split("/").pop();
  return (await (await page.request.get(`/api/books/${id}/glossary`)).json()).entries as Array<{
    name: string;
    form: string;
    byReader: boolean;
    notName: boolean;
  }>;
};
const forms: Record<string, string> = { Elizabeth: "伊丽莎白", Darcy: "达西" };

test.beforeEach(async ({ model }) => {
  model.setNameReply((asked) => ({ chunks: [asked.map((name) => `${name} = ${forms[name] ?? "某人"}`).join("\n")] }));
});

test("a new name is asked about: Keep saves the form as the reader's, and Not a name keeps the word out", async ({ page, model }) => {
  await openBook(page, "english-mixed.epub", /Mixed English/);
  await setTranslation(page, true);
  await untilReady(page, 3);

  await expect(card(page)).toContainText("New name · 1 of 2");
  await expect(card(page)).toContainText("Elizabeth");
  const field = card(page).getByRole("textbox", { name: "Chinese for Elizabeth" });
  await expect(field).toHaveValue("伊丽莎白");
  await expect(field).not.toBeFocused(); // reading goes on: the card never takes focus

  const asked = model.chatRequests().length;
  await field.fill("丽萃");
  await card(page).getByRole("button", { name: "Keep" }).click();

  await expect(card(page)).toContainText("Darcy");
  await expect.poll(() => model.chatRequests().slice(asked).some((request) => request.user.includes("Elizabeth = 丽萃"))).toBe(true);

  // Let the retranslation Keep started finish first: its requests still list Darcy as a name, and one still on its
  // way to the model when the count is taken would be counted below.
  await untilReady(page, 3);
  const before = model.chatRequests().length;
  await card(page).getByRole("button", { name: "Not a name" }).click();

  await expect(card(page)).toHaveCount(0);
  expect(await glossaryOf(page)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "Elizabeth", form: "丽萃", byReader: true }),
      expect.objectContaining({ name: "Darcy", notName: true }),
    ]),
  );
  await expect.poll(() => model.chatRequests().length).toBeGreaterThan(before);
  await untilReady(page, 3);
  expect(model.chatRequests().slice(before).some((request) => /Darcy =|Names in the text:[^.]*Darcy/.test(request.user))).toBe(false);
});

test("Later moves on and leaves the name not checked; Stop asking hides the card until the Glossary panel asks again", async ({ page }) => {
  await openBook(page, "english-mixed.epub", /Mixed English/);
  await setTranslation(page, true);
  await untilReady(page, 3);

  await expect(card(page)).toContainText("Elizabeth");
  await card(page).getByRole("button", { name: "Ask later" }).click();
  await expect(card(page)).toContainText("Darcy");
  await card(page).getByRole("button", { name: "Stop asking" }).click();
  await expect(card(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Glossary" }).click();
  const panel = page.getByRole("complementary", { name: "Glossary" });
  const names = panel.getByRole("list", { name: "Names" });
  await expect(names.getByRole("listitem").filter({ hasText: "Elizabeth" })).toContainText("not checked");
  const ask = panel.getByRole("checkbox", { name: "Ask about new names as they come" });
  await expect(ask).not.toBeChecked();

  await panel.getByRole("button", { name: "Keep Elizabeth as 伊丽莎白" }).click();
  await expect(names.getByRole("listitem").filter({ hasText: "Elizabeth" })).not.toContainText("not checked");

  await panel.getByRole("button", { name: "Darcy is not a name" }).click();
  const notNames = panel.getByRole("list", { name: "Not names" });
  await expect(notNames).toContainText("Darcy");
  await panel.getByRole("button", { name: "Treat Darcy as a name again" }).click();
  await expect(notNames).toHaveCount(0);

  await ask.check();
  expect(await page.evaluate(() => localStorage.getItem("reader.askNames"))).toBe("on");
});
