import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID,randomBytes,scryptSync,timingSafeEqual,createHash,createCipheriv,createDecipheriv,createHmac} from 'node:crypto';
export const id=()=>randomUUID(), now=()=>Date.now();
const path=process.env.DATABASE_PATH||'data/devflow.db';
if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
export const db=new DatabaseSync(path);
db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
export const get=(sql,...args)=>db.prepare(sql).get(...args);
export const all=(sql,...args)=>db.prepare(sql).all(...args);
export const run=(sql,...args)=>db.prepare(sql).run(...args);
export function tx(fn,immediate=true){db.exec(immediate?'BEGIN IMMEDIATE':'BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
export function fail(status,message){throw Object.assign(new Error(message),{status});}
export function required(value,name='value'){if(typeof value!=='string'||!value.trim()||value.length>10000)fail(400,`Invalid ${name}`);return value.trim();}
export const hash=v=>createHash('sha256').update(v).digest('hex');
export function password(value,salt=randomBytes(16).toString('hex')){return salt+':'+scryptSync(value,salt,64).toString('hex');}
export function equal(a,b){const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);}
export function verifyPassword(value,stored){return equal(password(value,stored.split(':')[0]),stored);}
export function crypt(value,decrypt=false){const key=process.env.TOKEN_KEY;if(!/^[a-f0-9]{64}$/i.test(key||''))fail(503,'Configure TOKEN_KEY (32-byte hex)');if(decrypt){const [iv,tag,data]=value.split('.');const c=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(iv,'hex'));c.setAuthTag(Buffer.from(tag,'hex'));return Buffer.concat([c.update(Buffer.from(data,'hex')),c.final()]).toString();}const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);const data=Buffer.concat([c.update(value),c.final()]);return [iv.toString('hex'),c.getAuthTag().toString('hex'),data.toString('hex')].join('.');}
export function signature(secret,body,prefix='sha256='){if(!secret)fail(503,'Webhook secret not configured');return prefix+createHmac('sha256',secret).update(body).digest('hex');}
export function access(user,org,write=false,admin=false){const m=get('SELECT * FROM members WHERE org_id=? AND user_id=?',org,user);if(!m||(write&&m.role==='Viewer')||(admin&&!['Owner','Admin'].includes(m.role)))fail(403,'Forbidden');return m;}
export function project(user,pid,write=false,admin=false){const p=get('SELECT * FROM projects WHERE id=? AND deleted_at IS NULL',pid);if(!p)fail(404,'Project not found');access(user,p.org_id,write,admin);return p;}
export function task(user,tid,write=false){const t=get('SELECT t.*,c.name AS status FROM tasks t JOIN columns c ON c.id=t.column_id WHERE t.id=? AND t.deleted_at IS NULL',Number(tid));if(!t)fail(404,'Task not found');project(user,t.project_id,write);return t;}
export function enqueue(key,kind,payload,at=now()){run('INSERT OR IGNORE INTO jobs(job_key,kind,payload,available_at) VALUES(?,?,?,?)',key,kind,JSON.stringify(payload),at);}
export function audit(org,actor,action,payload){run('INSERT INTO audit(org_id,actor,action,payload,created_at) VALUES(?,?,?,?,?)',org,actor,action,JSON.stringify(payload),now());}
export function emit(pid,type,payload={},tid=null,actor=null,source='platform',key=id()){
 const result=run('INSERT OR IGNORE INTO events(event_key,project_id,task_id,source,type,actor,payload,created_at) VALUES(?,?,?,?,?,?,?,?)',key,pid,tid,source,type,actor,JSON.stringify(payload),now());
 if(!result.changes)return;const eid=Number(result.lastInsertRowid),p=get('SELECT * FROM projects WHERE id=?',pid);
 audit(p.org_id,actor,type,{event_id:eid,...payload});enqueue(`event:${eid}`,'event',{id:eid});return eid;
}
export function move(t,status,actor=null,source='automation'){
 const c=get('SELECT c.* FROM columns c JOIN boards b ON b.id=c.board_id WHERE b.project_id=? AND c.name=? ORDER BY c.position LIMIT 1',t.project_id,status);if(!c)fail(400,'Unknown task status');
 if(c.id===t.column_id)return;run('UPDATE tasks SET column_id=?,version=version+1 WHERE id=?',c.id,t.id);emit(t.project_id,'task.status_changed',{from:t.status,to:status},t.id,actor,source);
}
export function mentions(pid,body){return {tasks:[...new Set([...body.matchAll(/\bTASK-(\d+)\b/g)].map(m=>Number(m[1])))].filter(t=>get('SELECT id FROM tasks WHERE id=? AND project_id=? AND deleted_at IS NULL',t,pid)),users:[...new Set([...body.matchAll(/@([\w.-]+)/g)].map(m=>m[1]))].map(n=>get('SELECT u.id FROM users u JOIN members m ON m.user_id=u.id JOIN projects p ON p.org_id=m.org_id WHERE p.id=? AND u.name=?',pid,n)?.id).filter(Boolean),urls:body.match(/https:\/\/github\.com\/[^\s<>]+/g)||[]};}
