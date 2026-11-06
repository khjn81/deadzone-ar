import { captureApp } from "./capture.mjs";
import { test, expect } from "@playwright/test";
import { url } from "../e2e/helpers.mjs";
test("installed shell reloads and starts training offline", async ({
  page,
  context,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, {
          once: true,
        }),
      );
    await (
      await caches.open("unrelated-project-sentinel")
    ).put("/sentinel", new Response("keep"));
  });
  try {
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator("#introScreen")).toBeVisible();
    await page.locator("#trainingButton").click();
    await expect(page.locator("#gameApp")).toHaveAttribute(
      "data-phase",
      "game",
    );
    expect(
      await page.evaluate(() => caches.has("unrelated-project-sentinel")),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context.setOffline(false);
  }
});
test("native WebGL context loss keeps Canvas combat usable", async ({
  page,
}, info) => {
  await page.goto(url);
  await page.locator("#trainingButton").click();
  await expect(page.locator("#gameApp")).toHaveAttribute("data-phase", "game");
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__DEADZONE__.getRendererDiagnostics().enemyRenderMode,
      ),
    )
    .toBe("ready");
  const lost = await page.evaluate(() => {
    const gl = document.querySelector("#worldCanvas").getContext("webgl2"),
      ext = gl?.getExtension("WEBGL_lose_context");
    if (!ext) return false;
    ext.loseContext();
    return true;
  });
  expect(lost).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__DEADZONE__.getRendererDiagnostics().enemyRenderMode,
      ),
    )
    .toBe("fallback");
  await page.locator("#hud-weapon-sidearm").click();
  const before = Number(await page.locator("#ammoValue").textContent());
  await page.locator("#fireButton").click();
  await expect
    .poll(async () => Number(await page.locator("#ammoValue").textContent()))
    .toBe(before - 1);
  await captureApp(page, info, "canvas-fallback.png");
});
