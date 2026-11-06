import { expect } from '@playwright/test';
export const url='/game/index.html?training=1&duration=8&seed=7&diagnostics=1';
export async function openGame(page){await page.goto(url);await expect.poll(()=>page.evaluate(()=>Boolean(window.__DEADZONE__?.getView))).toBe(true);}
export async function train(page){await openGame(page);await page.locator('#trainingButton').click();await expect(page.locator('#gameApp')).toHaveAttribute('data-phase','game');}
export async function cameraFixture(page,{defer=false}={}){
 await page.addInitScript(({defer})=>{
  window.__mediaFixture={pending:[],stops:0};
  const stream=()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const ctx=canvas.getContext('2d');ctx.fillRect(0,0,640,480);const media=canvas.captureStream(15);const timer=setInterval(()=>ctx.fillRect(0,0,640,480),50);for(const track of media.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{window.__mediaFixture.stops++;clearInterval(timer);stop();};}window.__latestMedia=media;return media;};
  navigator.mediaDevices.getUserMedia=()=>defer?new Promise(resolve=>window.__mediaFixture.pending.push(()=>resolve(stream()))):Promise.resolve(stream());
  if(window.DeviceOrientationEvent)Object.defineProperty(window.DeviceOrientationEvent,'requestPermission',{configurable:true,value:async()=> 'denied'});
 },{defer});
}
