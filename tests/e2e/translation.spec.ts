import { expect, test } from "./fixtures.ts";
import { answerWithLabels, openBook, setTranslation, shownBlocks, translatedParagraphs, translationStatus, useFlow } from "./translation-helpers.ts";

test.describe("translation in scrolling mode", () => {
  test.use({ withModel: true });

  test("the paragraphs on screen are translated, each shown after its English", async ({ page, model }) => {
    answerWithLabels(model);
    await useFlow(page, "scrolled");
    await openBook(page, "long.epub", /Long Book/);

    await setTranslation(page, true);

    await expect.poll(async () => (await translatedParagraphs(page)).length).toBeGreaterThan(3);
    const blocks = await shownBlocks(page);
    const first = blocks.find((block) => block.state === "done")!;
    expect(first.english).toMatch(/^Chapter 1, paragraph 1\./);
    expect(first.zh).toBe("第1章第1段：灯火渐暗。");
    console.log(JSON.stringify(await translationStatus(page)), blocks.map((b) => b.state).join());
  });
});
