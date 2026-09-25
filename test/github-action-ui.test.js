import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('GitHub settings expose the outbound action form without executing a provider write',()=>{
 assert.match(html,/id="githubActionForm"/);
 for(const action of ['create_issue','close_issue','comment','labels','branch','merge'])assert.match(html,new RegExp(`value="${action}"`));
 assert.match(html,/id="githubActionResult"/);
 assert.match(app,/\/projects\/\$\{pid\}\/github\/actions/);
 assert.match(app,/gerçek GitHub verisini değiştirebilir/);
 assert.match(app,/form\.dataset\.key\|\|crypto\.randomUUID\(\)/);
 assert.match(app,/query\.get\('org'\)/);
 assert.match(app,/sessionStorage\.setItem\('devflow-org',org\)/);
 assert.match(app,/sessionStorage\.setItem\('devflow-project',pid\)/);
});
