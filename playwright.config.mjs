import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'./e2e',timeout:25000,expect:{timeout:7000},globalTimeout:240000,workers:1,retries:0,forbidOnly:Boolean(process.env.CI),reporter:[['list']],
 use:{baseURL:'http://127.0.0.1:4210',channel:'chromium',trace:'off',screenshot:'only-on-failure',actionTimeout:5000},
 projects:[{name:'desktop',use:{viewport:{width:1280,height:800}}},{name:'mobile',use:{viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1}}],
 webServer:{command:'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4210 --strictPort',url:'http://127.0.0.1:4210/game/index.html',reuseExistingServer:false,timeout:30000,env:{NEXT_TELEMETRY_DISABLED:'1',WRANGLER_SEND_METRICS:'false'}},
});
