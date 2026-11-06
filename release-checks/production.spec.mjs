import { captureApp } from "./capture.mjs";
import { test, expect } from "@playwright/test";
import { url } from "../e2e/helpers.mjs";
test("public production journey reaches a real mission result and replay", async ({
  page,
}, info) => {
  const errors = [],
    external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (new URL(r.url()).origin !== "http://127.0.0.1:4211")
      external.push(r.url());
  });
  await page.goto("/");
  await expect(page).toHaveURL(/\/game\/index\.html$/);
  await page.goto(url);
  await expect(page.locator("#introScreen")).toBeVisible();
  await captureApp(page, info, "intro.png");
  await page.locator("#weapon-sidearm").click();
  await page.locator("#trainingButton").click();
  await expect(page.locator("#gameApp")).toHaveAttribute("data-phase", "game");
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__DEADZONE__.getRendererDiagnostics().enemyRenderMode,
      ),
    )
    .toMatch(/ready|fallback/);
  if (info.project.name !== "webkit-production")
    expect(
      await page.evaluate(
        () => window.__DEADZONE__.getRendererDiagnostics().layer?.modelReady,
      ),
    ).toBe(true);
  const ammo = Number(await page.locator("#ammoValue").textContent());
  await page.locator("#fireButton").click();
  await expect
    .poll(async () => Number(await page.locator("#ammoValue").textContent()))
    .toBe(ammo - 1);
  await page.locator("#reloadButton").click();
  await expect
    .poll(async () => Number(await page.locator("#ammoValue").textContent()))
    .toBe(ammo);
  await captureApp(page, info, "game.png");
  await page.keyboard.press("Escape");
  await expect(page.locator("#resumeButton")).toBeFocused();
  await captureApp(page, info, "pause.png");
  await page.locator("#resumeButton").click();
  await expect(page.locator("#pauseButton")).toBeFocused();
  await expect(page.locator("#resultScreen")).toBeVisible({ timeout: 14000 });
  await captureApp(page, info, "result.png");
  await page.locator("#replayButton").click();
  await expect(page.locator("#gameApp")).toHaveAttribute("data-phase", "game");
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
