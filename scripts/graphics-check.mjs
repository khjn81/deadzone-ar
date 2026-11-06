import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
const result=spawnSync(process.execPath,['scripts/smoke-three-browser.mjs',...process.argv.slice(2)],{stdio:'inherit',timeout:180000,env:{...process.env,DEADZONE_CHROME_PATH:chromium.executablePath()}});
if(result.error)throw result.error;
process.exitCode=result.status??1;
