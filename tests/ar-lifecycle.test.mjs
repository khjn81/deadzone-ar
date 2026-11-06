import test from 'node:test';
import assert from 'node:assert/strict';
import { ARController } from '../public/game/src/ar-controller.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
test('a late camera grant after destroy stops its stream without attaching it',async()=>{
 const pending=deferred();let stops=0,statuses=0;const stream={getTracks:()=>[{stop(){stops++;}}]};
 const video={srcObject:null,async play(){}};const ar=new ARController({globalObject:{navigator:{mediaDevices:{getUserMedia:()=>pending.promise}}},onStatus:()=>statuses++});
 const request=ar.requestAccess(video);ar.destroy();pending.resolve(stream);const result=await request;
 assert.equal(result.camera,false);assert.equal(ar.cameraActive,false);assert.equal(video.srcObject,null);assert.equal(stops,1);assert.equal(statuses,0);
});
test('a late sensor permission after cancellation never attaches a listener',async()=>{
 const pending=deferred();let attached=0;const ar=new ARController({globalObject:{DeviceOrientationEvent:{requestPermission:()=>pending.promise},addEventListener(){attached++;}}});
 const request=ar.requestAccess(null);ar.destroy();pending.resolve('granted');await request;assert.equal(attached,0);assert.equal(ar.sensorGranted,false);
});
