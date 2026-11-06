import { test, expect } from '@playwright/test';
import { url,openGame,train,cameraFixture } from './helpers.mjs';
test('denied storage methods never break the first visit',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{Storage.prototype.getItem=()=>{throw new DOMException('Denied','SecurityError');};});
 await page.goto(url);await expect(page.locator('#capabilityStatus')).not.toContainText('확인 중');expect(errors).toEqual([]);await expect.poll(()=>page.evaluate(()=>Boolean(window.__DEADZONE__))).toBe(true);
});
test('pause dialog isolates background, focuses resume and traps keyboard focus',async({page})=>{
 await train(page);await page.locator('#pauseButton').click();await expect(page.locator('#resumeButton')).toBeFocused();expect(await page.locator('#gameHud').evaluate(e=>e.inert)).toBe(true);
 for(let i=0;i<16;i++){await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.querySelector('#pauseScreen').contains(document.activeElement))).toBe(true);}
 await page.locator('#resumeButton').click();await expect(page.locator('#pauseButton')).toBeFocused();
});
test('Escape pauses and resumes a live mission',async({page})=>{await train(page);await page.keyboard.press('Escape');expect(await page.locator('#gameApp').getAttribute('data-phase')).toBe('pause');await page.keyboard.press('Escape');await expect(page.locator('#gameApp')).toHaveAttribute('data-phase','game');});
test('native keyboard activation turns the view',async({page})=>{
 await train(page);const before=await page.evaluate(()=>window.__DEADZONE__.getView().yaw);await page.locator('#turnRightButton').focus();await page.keyboard.press('Enter');
 const after=await page.evaluate(()=>window.__DEADZONE__.getView().yaw);expect(((after-before+540)%360)-180).toBeGreaterThan(5);
});
test('training selection cancels an older pending camera request',async({page})=>{
 await cameraFixture(page,{defer:true});await openGame(page);await page.locator('#startButton').click();await page.locator('#trainingButton').click();await expect(page.locator('#gameApp')).toHaveAttribute('data-phase','game');
 await page.evaluate(()=>window.__mediaFixture.pending.shift()());await page.waitForTimeout(120);expect(await page.locator('#gameApp').getAttribute('data-camera')).toBe('false');expect(await page.evaluate(()=>window.__mediaFixture.stops)).toBeGreaterThan(0);
});
test('hiding during calibration cannot start a background mission',async({page})=>{
 await openGame(page);await page.locator('#trainingButton').click();await expect(page.locator('#calibrationScreen')).toBeVisible();await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForTimeout(2700);expect(await page.locator('#gameApp').getAttribute('data-phase')).not.toBe('game');
});
test('persisted pagehide keeps a resumable application',async({page})=>{
 await train(page);await page.evaluate(()=>{dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
 expect(await page.evaluate(()=>Boolean(window.__DEADZONE__))).toBe(true);await expect(page.locator('#pauseScreen')).toBeVisible();await page.locator('#resumeButton').click();await expect(page.locator('#gameApp')).toHaveAttribute('data-phase','game');
});
test('releasing an older turn pointer cannot cancel a newer held direction',async({page,context})=>{
 await train(page);const left=await page.locator('#turnLeftButton').boundingBox(),right=await page.locator('#turnRightButton').boundingBox();const a={x:left.x+left.width/2,y:left.y+left.height/2,id:1},b={x:right.x+right.width/2,y:right.y+right.height/2,id:2};
 const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});let touching=false;
 try{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a]});touching=true;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a,b]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[b]});const before=await page.evaluate(()=>window.__DEADZONE__.getView().yaw);await expect.poll(async()=>{const v=await page.evaluate(()=>window.__DEADZONE__.getView().yaw);return((v-before+540)%360)-180;}).toBeGreaterThan(5);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});touching=false;}finally{if(touching)await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await cdp.detach();}
});
test('ended camera tracks remove the active camera state',async({page})=>{
 await cameraFixture(page);await openGame(page);await page.locator('#startButton').click();await expect(page.locator('#gameApp')).toHaveAttribute('data-phase','game');await page.evaluate(()=>window.__latestMedia.getVideoTracks()[0].dispatchEvent(new Event('ended')));await expect(page.locator('#gameApp')).toHaveAttribute('data-camera','false');
});
test('elapsed mission time is preserved at a low drawing cadence',async({page})=>{
 await page.addInitScript(()=>{const native=requestAnimationFrame.bind(window);window.requestAnimationFrame=fn=>native(()=>setTimeout(()=>fn(performance.now()),100));});await train(page);const before=await page.evaluate(()=>window.__DEADZONE__.getState().elapsed);await page.waitForTimeout(1100);const after=await page.evaluate(()=>window.__DEADZONE__.getState().elapsed);expect(after-before).toBeGreaterThan(.8);
});
