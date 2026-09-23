import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const directory=mkdtempSync(join(tmpdir(),'devflow-transaction-'));
process.env.DATABASE_PATH=join(directory,'test.db');
process.env.TOKEN_KEY='d'.repeat(64);
const {db,tx,run,get}=await import('../src/core.js');

test('deferred read transaction does not block an independent writer',()=>{
 run('CREATE TABLE IF NOT EXISTS transaction_probe(id INTEGER PRIMARY KEY,value TEXT)');
 const other=new DatabaseSync(process.env.DATABASE_PATH);
 other.exec('PRAGMA busy_timeout=100');
 try{
  tx(()=>{
   assert.equal(get('SELECT count(*) AS n FROM transaction_probe').n,0);
   other.exec('BEGIN IMMEDIATE');
   other.prepare('INSERT INTO transaction_probe(value) VALUES(?)').run('writer');
   other.exec('COMMIT');
  },false);
  assert.equal(get('SELECT count(*) AS n FROM transaction_probe').n,1);
 }finally{
  try{other.exec('ROLLBACK');}catch{}
  other.close();
 }
});

test.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
