import { test, expect } from '@playwright/test';
import {openGame,train,cameraFixture,url} from './helpers.mjs';
test('unsettled audio activation never blocks a silent training mission',async({page})=>{
 await page.addInitScript(()=>{window.AudioContext=class {state='suspended';resume(){return new Promise(()=>{});}close(){return Promise.resolve();}};});
 await openGame(page);await page.locator('#trainingButton').click();await expect(page.locator('#gameApp')).toHaveAttribute('data-phase','game');
});
test('combat shortcuts fire and reload once without hijacking native buttons',async({page})=>{
 await train(page);await page.locator('#hud-weapon-sidearm').click();await page.locator('#arCanvas').focus();const before=Number(await page.locator('#ammoValue').textContent());await page.keyboard.press('Space');await expect.poll(async()=>Number(await page.locator('#ammoValue').textContent())).toBe(before-1);await page.keyboard.press('r');await expect.poll(async()=>Number(await page.locator('#ammoValue').textContent())).toBe(before);
 await page.locator('#pauseButton').focus();await page.keyboard.press('Space');await expect(page.locator('#pauseScreen')).toBeVisible();expect(Number(await page.locator('#ammoValue').textContent())).toBe(before);
});
test('paused scenes stop continuous GPU drawing and resume explicitly',async({page})=>{
 await train(page);await expect.poll(()=>page.evaluate(()=>window.__DEADZONE__.getRendererDiagnostics().layer?.renderCount||0)).toBeGreaterThan(1);await page.locator('#pauseButton').click();await page.waitForTimeout(100);const before=await page.evaluate(()=>({count:window.__DEADZONE__.getRendererDiagnostics().layer.renderCount,elapsed:window.__DEADZONE__.getState().elapsed}));await page.waitForTimeout(300);expect(await page.evaluate(()=>window.__DEADZONE__.getRendererDiagnostics().layer.renderCount)).toBe(before.count);expect(await page.evaluate(()=>window.__DEADZONE__.getState().elapsed)).toBe(before.elapsed);await page.locator('#resumeButton').click();await expect.poll(()=>page.evaluate(()=>window.__DEADZONE__.getRendererDiagnostics().layer.renderCount)).toBeGreaterThan(before.count);
});
