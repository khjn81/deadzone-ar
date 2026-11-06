import { test, expect } from "@playwright/test";
import { openGame, train, cameraFixture, url } from "./helpers.mjs";
test("unsettled audio activation never blocks a silent training mission", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.AudioContext = class {
      state = "suspended";
      resume() {
        return new Promise(() => {});
      }
      close() {
        return Promise.resolve();
      }
    };
  });
  await openGame(page);
  await page.locator("#trainingButton").click();
  await expect(page.locator("#gameApp")).toHaveAttribute("data-phase", "game");
});
test("combat shortcuts fire and reload once without hijacking native buttons", async ({
  page,
}) => {
  await train(page);
  await page.locator("#hud-weapon-sidearm").click();
  await page.locator("#arCanvas").focus();
  const before = Number(await page.locator("#ammoValue").textContent());
  await page.keyboard.press("Space");
  await expect
    .poll(async () => Number(await page.locator("#ammoValue").textContent()))
    .toBe(before - 1);
  await page.keyboard.press("r");
  await expect
    .poll(async () => Number(await page.locator("#ammoValue").textContent()))
    .toBe(before);
  await page.locator("#pauseButton").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#pauseScreen")).toBeVisible();
  expect(Number(await page.locator("#ammoValue").textContent())).toBe(before);
});
test("paused scenes stop continuous GPU drawing and resume explicitly", async ({
  page,
}) => {
  await train(page);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__DEADZONE__.getRendererDiagnostics().layer?.renderCount || 0,
      ),
    )
    .toBeGreaterThan(1);
  await page.locator("#pauseButton").click();
  await page.waitForTimeout(100);
  const before = await page.evaluate(() => ({
    count: window.__DEADZONE__.getRendererDiagnostics().layer.renderCount,
    elapsed: window.__DEADZONE__.getState().elapsed,
  }));
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(
      () => window.__DEADZONE__.getRendererDiagnostics().layer.renderCount,
    ),
  ).toBe(before.count);
  expect(
    await page.evaluate(() => window.__DEADZONE__.getState().elapsed),
  ).toBe(before.elapsed);
  await page.locator("#resumeButton").click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__DEADZONE__.getRendererDiagnostics().layer.renderCount,
      ),
    )
    .toBeGreaterThan(before.count);
});
async function sensorMission(page) {
  await cameraFixture(page);
  await page.addInitScript(() => {
    Object.defineProperty(window.DeviceOrientationEvent, "requestPermission", {
      configurable: true,
      value: async () => "granted",
    });
    window.__sensor = (stamp, gamma) => {
      const e = new Event("deviceorientation");
      for (const [k, v] of Object.entries({
        alpha: 0,
        beta: 90,
        gamma,
        timeStamp: stamp,
      }))
        Object.defineProperty(e, k, { value: v });
      dispatchEvent(e);
    };
  });
  await openGame(page);
  await page.locator("#startButton").click();
  await expect(page.locator("#gameApp")).toHaveAttribute("data-phase", "game");
}
test("paused sensor observations cannot turn the view", async ({ page }) => {
  await sensorMission(page);
  await page.evaluate(() => window.__sensor(1000, 0));
  await page.locator("#pauseButton").click();
  const before = await page.evaluate(() => window.__DEADZONE__.getView().yaw);
  await page.evaluate(() => {
    for (let i = 1; i <= 8; i++) window.__sensor(1000 + i * 20, 28);
  });
  expect(
    await page.evaluate(() => window.__DEADZONE__.getView().yaw),
  ).toBeCloseTo(before, 6);
});
test("reordered sensor events cannot steer a live mission", async ({
  page,
}) => {
  await sensorMission(page);
  await page.evaluate(() => {
    window.__sensor(1000, 0);
    window.__sensor(1020, 28);
  });
  const before = await page.evaluate(() => window.__DEADZONE__.getView().yaw);
  await page.evaluate(() => window.__sensor(1010, -28));
  expect(
    await page.evaluate(() => window.__DEADZONE__.getView().yaw),
  ).toBeCloseTo(before, 6);
});
test("window blur pauses and clears a held turn before explicit resume", async ({
  page,
}) => {
  await train(page);
  const b = await page.locator("#turnRightButton").boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await expect
    .poll(() =>
      page.evaluate(() => window.__DEADZONE__.getView().manualTurnRate),
    )
    .toBeGreaterThan(0);
  await page.evaluate(() => dispatchEvent(new Event("blur")));
  await expect(page.locator("#gameApp")).toHaveAttribute("data-phase", "pause");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(150);
  expect(
    await page.evaluate(() => window.__DEADZONE__.getView().manualTurnRate),
  ).toBe(0);
});
test("blocked landscape viewport pauses instead of running behind its warning", async ({
  page,
}) => {
  await train(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator("#gameApp")).toHaveAttribute("data-phase", "pause");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#resumeButton").click();
  await expect(page.locator("#gameApp")).toHaveAttribute("data-phase", "game");
});
test("hidden capture stops all tracks and reconnects only after an explicit retry", async ({
  page,
}) => {
  await cameraFixture(page);
  await openGame(page);
  await page.locator("#startButton").click();
  await expect(page.locator("#gameApp")).toHaveAttribute("data-phase", "game");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#gameApp")).toHaveAttribute(
    "data-camera",
    "false",
  );
  expect(
    await page.evaluate(() =>
      window.__latestMedia.getTracks().every((t) => t.readyState === "ended"),
    ),
  ).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#gameApp")).toHaveAttribute(
    "data-camera",
    "false",
  );
  await page.locator("#retryAccessButton").click();
  await expect(page.locator("#gameApp")).toHaveAttribute("data-camera", "true");
  await page.locator("#resumeButton").click();
  await expect(page.locator("#gameApp")).toHaveAttribute("data-phase", "game");
});
test("compact phone controls keep44px targets and permit browser zoom", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openGame(page);
  expect(
    await page.locator('meta[name="viewport"]').getAttribute("content"),
  ).not.toContain("user-scalable=no");
  for (const id of [
    "startButton",
    "trainingButton",
    "cameraAimButton",
    "seatedTurnButton",
    "weapon-sidearm",
    "weapon-burst",
    "weapon-scatter",
    "weapon-rail",
    "weapon-cryo",
  ]) {
    const e = page.locator("#" + id);
    await e.scrollIntoViewIfNeeded();
    const b = await e.boundingBox();
    expect(b.width, id).toBeGreaterThanOrEqual(44);
    expect(b.height, id).toBeGreaterThanOrEqual(44);
  }
  await page.locator("#trainingButton").click();
  await expect(page.locator("#gameApp")).toHaveAttribute("data-phase", "game");
  for (const id of [
    "pauseButton",
    "turnLeftButton",
    "turnRightButton",
    "reloadButton",
    "fireButton",
    "hud-weapon-sidearm",
    "hud-weapon-burst",
    "hud-weapon-scatter",
    "hud-weapon-rail",
    "hud-weapon-cryo",
  ]) {
    const b = await page.locator("#" + id).boundingBox();
    expect(b.width, id).toBeGreaterThanOrEqual(44);
    expect(b.height, id).toBeGreaterThanOrEqual(44);
    expect(b.y + b.height, id).toBeLessThanOrEqual(640);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});

test("stable HUD values avoid repeated DOM writes while simulation keeps running", async ({
  page,
}) => {
  await train(page);
  const result = await page.evaluate(async () => {
    let writes = 0;
    const observer = new MutationObserver((records) => {
      writes += records.length;
    });
    for (const id of [
      "scoreValue",
      "ammoValue",
      "ammoMaxValue",
      "weaponName",
      "weaponSubtitle",
    ])
      observer.observe(document.getElementById(id), {
        childList: true,
        subtree: true,
        characterData: true,
      });
    for (const button of document.querySelectorAll(".hud-weapon-chip"))
      observer.observe(button, {
        attributes: true,
        attributeFilter: ["aria-pressed", "disabled"],
      });
    const before = window.__DEADZONE__.getState().elapsed;
    await new Promise((resolve) => setTimeout(resolve, 300));
    observer.disconnect();
    return { writes, elapsed: window.__DEADZONE__.getState().elapsed - before };
  });
  expect(result.elapsed).toBeGreaterThan(0.15);
  expect(result.writes).toBe(0);
});
