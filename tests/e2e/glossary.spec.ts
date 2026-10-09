// The Glossary panel (issue #29): an English Book's names with their Chinese forms, most often met first; changing a
// form translates the paragraphs on screen again with it; names can be added and removed; and the panel is only there
// for an English Book.
import { expect, test } from "./fixtures.ts";
import type { Page } from "@playwright/test";
import { openBook, setTranslation, untilReady } from "./translation-helpers.ts";

test.use({ withModel: true });

const panel = (page: Page) => page.getByRole("complementary", { name: "Glossary" });
const glossaryOf = async (page: Page) => {
  const id = new URL(page.url()).hash.split("/").pop();
  return (await (await page.request.get(`/api/books/${id}/glossary`)).json()).entries as Array<{ name: string; form: string; byReader: boolean }>;
};

test("the panel lists the names translation met, and a changed form is used when the text on screen is translated again", async ({ page, model }) => {
  model.setNameReply((asked) => ({ chunks: [asked.map((name) => `${name} = ${name === "Elizabeth" ? "伊丽莎白" : "某人"}`).join("\n")] }));
  await openBook(page, "english-mixed.epub", /Mixed English/);
  await setTranslation(page, true);
  await untilReady(page, 3);

  await page.getByRole("button", { name: "Glossary" }).click();

  const elizabeth = panel(page).getByRole("textbox", { name: "Chinese for Elizabeth" });
  await expect(elizabeth).toHaveValue("伊丽莎白");
  const asked = model.chatRequests().length;

  await elizabeth.fill("丽萃");
  await elizabeth.press("Enter");

  await expect(panel(page).getByRole("status")).toHaveText("Elizabeth is now 丽萃.");
  await expect.poll(() => model.chatRequests().slice(asked).some((request) => request.user.includes("Elizabeth = 丽萃"))).toBe(true);
  expect(await glossaryOf(page)).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Elizabeth", form: "丽萃", byReader: true })]));
});

test("a name can be added and removed, and a form that is not Chinese is refused", async ({ page }) => {
  await openBook(page, "english-mixed.epub", /Mixed English/);
  await page.getByRole("button", { name: "Glossary" }).click();
  const add = panel(page).getByRole("form", { name: "Add a name" });

  await add.getByRole("textbox", { name: "Name" }).fill("Wickham");
  await add.getByRole("textbox", { name: "Chinese" }).fill("Wickham");
  await add.getByRole("button", { name: "Add" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("must be Chinese characters");

  await add.getByRole("textbox", { name: "Chinese" }).fill("威克姆");
  await add.getByRole("button", { name: "Add" }).click();
  await expect(panel(page).getByRole("textbox", { name: "Chinese for Wickham" })).toHaveValue("威克姆");

  await panel(page).getByRole("button", { name: "Remove Wickham" }).click();
  await expect(panel(page).getByRole("textbox", { name: "Chinese for Wickham" })).toHaveCount(0);
  expect(await glossaryOf(page)).toEqual([]);
});

test("a Book that is not in English has no Glossary", async ({ page }) => {
  await openBook(page, "chinese-search.epub", "石头记");
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Glossary" })).toHaveCount(0);
});
