import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const directory=mkdtempSync(join(tmpdir(),'devflow-migration-'));
const database=join(directory,'old.db');
const old=new DatabaseSync(database);
old.exec(`
 CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT UNIQUE NOT NULL,password TEXT NOT NULL);
 CREATE TABLE organizations(id TEXT PRIMARY KEY,name TEXT NOT NULL);
 CREATE TABLE members(org_id TEXT REFERENCES organizations(id),user_id TEXT REFERENCES users(id),role TEXT CHECK(role IN ('Owner','Admin','Member','Viewer')),PRIMARY KEY(org_id,user_id));
 CREATE TABLE idempotency(user_id TEXT,key TEXT,request_hash TEXT,response TEXT,PRIMARY KEY(user_id,key));
 INSERT INTO organizations VALUES('org','Engineering');
 INSERT INTO users VALUES('user','user@test.dev','user','unused');
 INSERT INTO members VALUES('org','user','Owner');
 INSERT INTO idempotency VALUES('user','legacy','hash','{}');
 `);
old.close();
process.env.DATABASE_PATH=database;
process.env.TOKEN_KEY='e'.repeat(64);
const {db,get}=await import('../src/core.js');

test('legacy database receives schema migration and indexes',()=>{
 const role=get("SELECT \"notnull\" AS required FROM pragma_table_info('members') WHERE name='role'");
 assert.equal(role.required,1);
 assert.equal(get('SELECT count(*) AS n FROM schema_migrations').n,1);
 assert.equal(get('SELECT created_at>0 AS ok FROM idempotency WHERE key=?','legacy').ok,1);
 assert.ok(get("SELECT 1 FROM sqlite_master WHERE type='index' AND name='notifications_user_read'"));
});

test.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
