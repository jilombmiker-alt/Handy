'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertSigningContinuity } = require('../scripts/install-identity');

test('installer validates candidate against existing designated requirement without shell execution', () => {
  const calls=[];
  const run=(command,args)=>{calls.push({command,args});return calls.length===1
    ? {status:0,stdout:'',stderr:'Executable=/Applications/Handy.app\n# designated => identifier "com.dynamicpanel.app" and anchor apple generic'}
    : {status:0};};
  assert.deepEqual(assertSigningContinuity('/Applications/Handy.app','/tmp/new build/Handy.app',run),{compatible:true,identityKind:'signed-requirement'});
  assert.deepEqual(calls[1],{command:'/usr/bin/codesign',args:['--verify','--strict','-R','=identifier "com.dynamicpanel.app" and anchor apple generic','/tmp/new build/Handy.app']});
});

test('changed ad-hoc hash or incompatible signer stops installation', () => {
  let count=0;
  assert.throws(()=>assertSigningContinuity('old','new',()=>++count===1
    ? {status:0,stdout:'designated => cdhash H"abc"'} : {status:3}),/已停止安装/);
});

test('identical ad-hoc identity is explicitly build-specific, not a stable signer', () => {
  let count=0;
  assert.equal(assertSigningContinuity('old','same',()=>++count===1
    ? {status:0,stdout:'designated => cdhash H"abc"'} : {status:0}).identityKind,'adhoc-build-specific');
});

test('missing, failed or unreadable signing requirement fails closed', () => {
  for(const result of [{status:1,stderr:'failed'},{status:0,stdout:'no requirement'},{status:null,error:Error('missing')}]){
    assert.throws(()=>assertSigningContinuity('old','new',()=>result),/无法读取/);
  }
});

test('installer checks identity before backup mutations and supports read-only preflight',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../scripts/install-local.js'),'utf8');
  assert.ok(source.indexOf('...assertSigningContinuity(old,source,undefined,migration)')<source.indexOf('fs.mkdirSync(backupRoot'));
  assert.ok(source.indexOf("process.argv.includes('--check')")<source.indexOf('fs.mkdirSync(backupRoot'));
  assert.ok(source.indexOf('unchanged:true')<source.indexOf('fs.mkdirSync(backupRoot'));
  assert.match(source,/assertSigningContinuity\(old,stage,undefined,migration\)/);
});

test('one-time local migration requires exact old hash and exact candidate certificate',()=>{
  const fromAdhocHash='A'.repeat(40),toCertificate='B'.repeat(40);
  const calls=[];
  const run=(cmd,args)=>{calls.push(args);return calls.length===1 ? {status:0,stdout:`designated => cdhash H"${fromAdhocHash}"`} : {status:calls.length===2 ? 3:0};};
  assert.equal(assertSigningContinuity('old','new',run,{fromAdhocHash,toCertificate}).migration,true);
  assert.equal(calls[2][3],`=identifier "com.dynamicpanel.app" and certificate leaf = H"${toCertificate}"`);
});

test('migration does not allow wrong old hash or an existing certificate signer',()=>{
  for(const requirement of [`cdhash H"${'C'.repeat(40)}"`,'identifier "com.dynamicpanel.app" and anchor apple generic']) {
    let calls=0;
    assert.throws(()=>assertSigningContinuity('old','new',()=>++calls===1 ? {status:0,stdout:`designated => ${requirement}`}:{status:3},
      {fromAdhocHash:'A'.repeat(40),toCertificate:'B'.repeat(40)}),/已停止安装/);
    assert.equal(calls,2);
  }
});
