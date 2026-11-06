import { test, expect } from '@playwright/test';
import { openGame, train } from './helpers.mjs';
test('first visit loads real3D assets and exposes every loadout without device permission',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await openGame(page);
 await expect.poll(()=>page.evaluate(()=>window.__DEADZONE__.getRendererDiagnostics().layer?.modelReady)).toBe(true);
 for(const id of ['sidearm','burst','scatter','rail','cryo']){await page.locator('#weapon-'+id).click();await expect(page.locator('#weapon-'+id)).toHaveAttribute('aria-pressed','true');}
 await page.screenshot({path:info.outputPath('intro.png')});expect(errors).toEqual([]);
});
test('training completes firing, weapon choice, reload, pause, result and replay',async({page})=>{
 await train(page);for(const id of ['sidearm','burst','scatter','rail','cryo'])await page.locator('#hud-weapon-'+id).click();
 await page.locator('#hud-weapon-sidearm').click();const before=Number(await page.locator('#ammoValue').textContent());await page.locator('#fireButton').click();await expect.poll(async()=>Number(await page.locator('#ammoValue').textContent())).toBe(before-1);
 await page.locator('#reloadButton').click();await expect.poll(async()=>Number(await page.locator('#ammoValue').textContent())).toBe(before);
 await page.locator('#pauseButton').click();await expect(page.locator('#pauseScreen')).toBeVisible();await page.locator('#resumeButton').click();
 await expect(page.locator('#resultScreen')).toBeVisible({timeout:14000});await page.locator('#replayButton').click();await expect(page.locator('#gameApp')).toHaveAttribute('data-phase','game');
});
