import { expect, test } from "@playwright/test";

test("the Library page loads and shows an empty state", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await expect(page.getByText("Your Library is empty")).toBeVisible();
});

test("tells the user when the server cannot be reached", async ({ page }) => {
  await page.route("**/api/books", (route) => route.abort());

  await page.goto("/");

  await expect(page.getByRole("alert")).toContainText("Cannot reach the server");
});
