// Optional real Chromium check. Isolated in-memory DB; never writes to live accounts.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
process.env.DATABASE_PATH=':memory:';
const {server}=await import('../src/server.js');
const {tick}=await import('../src/worker.js');
const binary=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
if(!existsSync(binary))throw Error('Set CHROME_PATH to a Chromium/Chrome executable');
mkdirSync('data',{recursive:true});
const profile=mkdtempSync(resolve('data/browser-smoke-'));
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const chrome=spawn(binary,['--headless=new','--disable-gpu','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let socket;
try{
 const endpoint=await new Promise((resolve,reject)=>{let output='';const timeout=setTimeout(()=>reject(Error('Chromium startup timeout')),20000);chrome.once('error',reject);chrome.stderr.on('data',data=>{output+=data;const match=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});});
 console.log('Chromium launched');socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Debugger connection timeout')),10000);socket.onopen=()=>{clearTimeout(timer);resolve();};socket.onerror=reject;});let sequence=0;const pending=new Map(),exceptions=[];
 socket.onmessage=message=>{const data=JSON.parse(message.data);if(data.id){const p=pending.get(data.id);if(p){pending.delete(data.id);data.error?p.reject(Error(data.error.message)):p.resolve(data.result);}}else if(data.method==='Runtime.exceptionThrown')exceptions.push(data.params.exceptionDetails);};
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},10000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 const call=(method,params)=>send(method,params,sessionId);
 await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
 async function until(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+expression+'; '+await evaluate('document.body.innerText'));}
 console.log('Debugger attached');await call('Page.navigate',{url:origin});await until("typeof document.querySelector('#authForm')?.onsubmit === 'function'");console.log('UI loaded');
 assert.equal(await evaluate("!!document.querySelector('#authForm input[name=name]')"),false);
 await evaluate("document.querySelector('#showRegister').click()");
 await until("!document.querySelector('#registerForm').hidden && document.querySelector('#authForm').hidden");
 await evaluate("document.querySelector('#backToLogin').click()");
 assert.ok(await evaluate("document.querySelector('#registerForm').hidden && !document.querySelector('#authForm').hidden"));
 await evaluate("document.querySelector('#showRegister').click()");
 await evaluate("(()=>{const f=document.querySelector('#registerForm');f.elements.email.value='browser@test.dev';f.elements.password.value='browser-password-123';f.elements.name.value='browser';f.requestSubmit();})()");
 await until("!document.querySelector('#authForm').hidden && document.querySelector('#registerForm').hidden && document.querySelector('#notice').textContent.includes('oluşturuldu')");
 assert.equal(await evaluate("document.querySelector('#authForm').elements.email.value"),'browser@test.dev');
 assert.equal(await evaluate("document.querySelector('#authForm').elements.password.value"),'');
 assert.ok(await evaluate("document.querySelector('#workspace').hidden"),'Registration does not sign in automatically');
 assert.equal(await evaluate("location.href"),origin+'/','Registration stays on the same page');
 await evaluate("document.querySelector('#showRegister').click()");
 await evaluate("(()=>{const f=document.querySelector('#registerForm');f.elements.email.value='browser@test.dev';f.elements.password.value='browser-password-123';f.elements.name.value='browser';f.requestSubmit();})()");
 await until("!document.querySelector('#registerNotice').hidden && document.querySelector('#registerNotice').textContent.includes('kayıtlı')");
 assert.equal(await evaluate("document.querySelector('#registerForm').hidden"),false);
 await evaluate("document.querySelector('#backToLogin').click();document.querySelector('#authForm').elements.password.value='browser-password-123';document.querySelector('#authForm [value=login]').click()");
 await until("!document.querySelector('#workspace').hidden");console.log('Separate registration card, duplicate error, return to login and sign-in verified');
 await evaluate("window.prompt=()=> 'Browser organization';document.querySelector('#newOrg').click()");await until("document.querySelector('#org').options.length===1");
 await evaluate("window.prompt=()=> 'Browser project';document.querySelector('#newProject').click()");await until("document.querySelectorAll('.column').length===5");console.log('Organization and project created');
 await evaluate("document.querySelector('[data-tab=settings]').click()");await until("document.querySelector('#teamPanel') && !document.querySelector('#settings').hidden && document.querySelectorAll('#teamMembers input').length===1");
 await evaluate(`(()=>{const f=document.querySelector('#teamForm');f.elements.name.value='Browser team';document.querySelector('#teamMembers input').checked=true;f.requestSubmit();})()`);await until("document.querySelector('#teams').textContent.includes('Browser team') && document.querySelector('#teams').textContent.includes('browser')");console.log('Team created and member listed');
 await evaluate("document.querySelector('[data-remove-member]').click()");await until("!!document.querySelector('[data-add-member]')");
 await evaluate("const add=document.querySelector('[data-add-member]');add.elements.member.selectedIndex=1;add.requestSubmit()");await until("!!document.querySelector('[data-remove-member]')");
 await call('Page.reload');await until("!document.querySelector('#workspace').hidden && document.querySelectorAll('.column').length===5");
 await evaluate("document.querySelector('[data-tab=settings]').click()");await until("!!document.querySelector('[data-remove-member]')");
 await evaluate("window.confirm=()=>false;document.querySelector('[data-delete-team]').click()");
 assert.ok(await evaluate("!!document.querySelector('[data-team]')"),'Cancel preserves team');
 await evaluate("window.confirm=()=>true;document.querySelector('[data-delete-team]').click()");await until("!document.querySelector('[data-team]')");
 console.log('Team member removed, re-added, persisted after reload and team deleted');
 await evaluate("window.prompt=()=> 'Empty organization';document.querySelector('#newOrg').click()");await until("document.querySelector('#org').options.length===2");
 await evaluate("document.querySelector('#org').selectedIndex=1;document.querySelector('#org').dispatchEvent(new Event('change',{bubbles:true}))");
 await until("document.querySelector('#project').options.length===0 && document.querySelector('#kanban').textContent.includes('Organizasyonunuza')");
 assert.equal(await evaluate("document.querySelector('#repoForm').elements.repo.value"),'','Organization switch clears project integration forms');
 await evaluate("document.querySelector('#org').selectedIndex=0;document.querySelector('#org').dispatchEvent(new Event('change',{bubbles:true}))");await until("document.querySelector('#project').options.length===1");
 await evaluate("document.querySelector('[data-tab=board]').click()");await until("document.querySelectorAll('.column').length===5");
 console.log('Switching to an empty organization clears the previous project state');
 await evaluate("document.querySelector('[data-tab=board]').click()");await until("!document.querySelector('#board').hidden");
 await evaluate("document.querySelector('#newTask').click()");await until("document.querySelector('#taskDialog').open");
 await evaluate(`(()=>{const f=document.querySelector('#taskForm');f.elements.title.value='Login validation';f.elements.assignee.selectedIndex=1;f.elements.labels.value='bug, auth';f.requestSubmit();})()`);
 await until("document.querySelectorAll('.card').length===1 && !document.querySelector('#taskDialog').open");
 // Worker executes the exact same durable queue handlers as the standalone process.
 while(await tick()){}
 await evaluate("document.querySelector('.card').click()");await until("document.querySelector('#taskDialog').open");
 await evaluate(`(()=>{const f=document.querySelector('#taskForm');f.elements.column_id.selectedIndex=2;f.requestSubmit();})()`);
 await until("document.querySelectorAll('.column')[2].querySelector('.card')!==null");
 while(await tick()){}
 await evaluate("document.querySelector('[data-tab=chat]').click()");await until("!document.querySelector('#chat').hidden");
 await evaluate(`(()=>{const f=document.querySelector('#chatForm');f.elements.body.value='@browser TASK-1 PR hazır';f.requestSubmit();})()`);await until("document.querySelector('#messages').textContent.includes('PR hazır')");
 while(await tick()){}
 await evaluate("document.querySelector('[data-tab=inbox]').click()");await until("document.querySelectorAll('#notifications .item').length>0");
 await evaluate("document.querySelector('[data-tab=board]').click()");await until("!document.querySelector('#board').hidden");
 const screenshot=await call('Page.captureScreenshot',{format:'png'});writeFileSync('data/browser-smoke.png',Buffer.from(screenshot.data,'base64'));
 assert.deepEqual(exceptions,[],'No browser runtime exceptions');console.log('PASS: Chromium register → login → org → project → task → status → chat/mention → inbox; screenshot data/browser-smoke.png');
}finally{socket?.close();chrome.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
