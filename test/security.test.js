import {test} from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_PATH=':memory:';
process.env.TOKEN_KEY='c'.repeat(64);
const {clientAddress}=await import('../src/server.js');

const request=(headers={},remoteAddress='127.0.0.1')=>({headers,socket:{remoteAddress}});

test('proxy address is trusted only when explicitly enabled',()=>{
 const previous=process.env.TRUST_PROXY;
 try{
  delete process.env.TRUST_PROXY;
  assert.equal(clientAddress(request({'cf-connecting-ip':'203.0.113.10'})),'127.0.0.1');
  process.env.TRUST_PROXY='cloudflare';
  assert.equal(clientAddress(request({'cf-connecting-ip':'203.0.113.10'})),'203.0.113.10');
  assert.equal(clientAddress(request({},'::1')),'::1');
 }finally{
  if(previous===undefined)delete process.env.TRUST_PROXY;else process.env.TRUST_PROXY=previous;
 }
});
