import { test, expect } from '@playwright/test';
import {openGame,train,cameraFixture,url} from './helpers.mjs';
test('unsettled audio activation never blocks a silent training mission',async({page})=>{
 await page.addInitScript(()=>{window.AudioContext=class {state='suspended';resume(){return new Promise(()=>{});}close(){return Promise.resolve();}};});
 await openGame(page);await page.locator('#trainingButton').click();await expect(page.locator('#gameApp')).toHaveAttribute('data-phase','game');
});
