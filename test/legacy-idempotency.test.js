import {test,after} from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_PATH=':memory:';
process.env.TOKEN_KEY='f'.repeat(64);
const {server}=await import('../src/server.js');
const {run,db}=await import('../src/core.js');
let base;
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
base='http://127.0.0.1:'+server.address().port;

test('idempotency writes remain compatible with a legacy timestamp column',async()=>{
 const register=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'legacy@test.dev',name:'legacy-user',password:'legacy-password-123'})});
 assert.equal(register.status,200);
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'legacy@test.dev',password:'legacy-password-123'})});
 const {token}=await login.json();
 run('ALTER TABLE idempotency ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0');
 const request=()=>fetch(base+'/api/organizations',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':'legacy-org-create'},body:JSON.stringify({name:'Legacy compatible org'})});
 const first=await request(),firstBody=await first.json();
 assert.equal(first.status,200);
 const second=await request(),secondBody=await second.json();
 assert.equal(second.status,200);
 assert.deepEqual(secondBody,firstBody);
});

after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(()=>{db.close();resolve();});}));
