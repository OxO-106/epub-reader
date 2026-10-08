import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.ts";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

// The server settles a copied file for a second and the page looks again every few seconds.
const eventually = { timeout: 20_000 };

test("a file copied into the library folder shows up on the open page, and a bad one is reported", async ({
  page,
  server,
}) => {
  await page.goto("/");
  await expect(page.getByText("Your Library is empty")).toBeVisible();

  copyFileSync(fixture("chinese.epub"), join(server.libraryDir, "chinese.epub"));
  copyFileSync(fixture("corrupt.epub"), join(server.libraryDir, "corrupt.epub"));

  await expect(page.locator(".books > li").filter({ hasText: "红楼梦" })).toBeVisible(eventually);
  const problems = page.getByRole("list", { name: "Library folder problems" });
  await expect(problems).toContainText('"corrupt.epub" is not a valid EPUB', eventually);
  await expect(page.locator(".books > li")).toHaveCount(1);
});
