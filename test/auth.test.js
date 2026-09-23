import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_PATH=':memory:';
const {server}=await import('../src/server.js');
const {get}=await import('../src/core.js');
let base;
before(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;});
after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
const valid={email:' Register+test@Example.COM ',name:'register-user',password:'registration-password'};
async function post(path,body){const r=await fetch(base+'/api/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
test('registration normalizes email, stores a password hash and permits subsequent login',async()=>{
 const registered=await post('register',valid);
 assert.equal(registered.status,200);assert.equal(registered.body.email,'register+test@example.com');
 assert.equal(registered.body.token,undefined);assert.equal(registered.body.password,undefined);
 assert.notEqual(get('SELECT password FROM users WHERE id=?',registered.body.id).password,valid.password);
 assert.equal((await post('login',{email:registered.body.email,password:valid.password})).status,200);
});
test('duplicate email or username cannot create another account',async()=>{
 assert.equal((await post('register',{...valid,name:'other-user'})).status,409);
 assert.equal((await post('register',{...valid,email:'other@example.com'})).status,409);
 assert.equal(get('SELECT count(*) AS n FROM users').n,1);
});
test('malformed email addresses are rejected by the API',async()=>{
 for(const email of ['bad@@address','no-at-sign','@example.com','a@','a b@example.com','a@bad domain.com','a@-example.com','a@example..com','.a@example.com','a..b@example.com','a.@example.com','a@localhost']){
  const r=await post('register',{...valid,email,name:'invalid-mail'});
  assert.equal(r.status,400,email);
 }
 assert.equal(get('SELECT count(*) AS n FROM users').n,1);
});
test('registration rejects missing username and invalid passwords',async()=>{
 for(const body of [{...valid,name:''},{...valid,name:'a'},{...valid,password:'short'},{...valid,password:'x'.repeat(201)}])assert.equal((await post('register',body)).status,400);
 assert.equal(get('SELECT count(*) AS n FROM users').n,1);
});
