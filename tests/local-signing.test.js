'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {selectSigningIdentity,signingEnvironment}=require('../build/signing-policy');
const hash='B'.repeat(40), list=()=>`1) ${hash} "Handy Local Code Signing"\n1 valid identities found`;
test('local signing uses exact persistent fingerprint and never names',()=>{
  assert.deepEqual(selectSigningIdentity({PANEL_LOCAL_SIGNING_IDENTITY:hash},list),{identity:hash,adhoc:false,local:true});
  assert.throws(()=>selectSigningIdentity({PANEL_LOCAL_SIGNING_IDENTITY:'Handy Local Code Signing'},list),/指纹/);
});
test('local identity missing, duplicate or conflicting cannot fall back',()=>{
  assert.throws(()=>selectSigningIdentity({PANEL_LOCAL_SIGNING_IDENTITY:hash,PANEL_ALLOW_ADHOC_SIGNING:'1'},()=>''),/不会退回/);
  assert.throws(()=>selectSigningIdentity({PANEL_LOCAL_SIGNING_IDENTITY:hash},()=>list()+list()),/不唯一/);
  assert.throws(()=>selectSigningIdentity({PANEL_LOCAL_SIGNING_IDENTITY:hash,PANEL_DEVELOPER_ID:'test'},list),/同时/);
});
test('community and CI builds never implicitly use private local config',()=>{
  const env={PANEL_ALLOW_ADHOC_SIGNING:'1'};
  assert.equal(signingEnvironment(env),env);
  const ci={CI:'true'};
  assert.equal(signingEnvironment(ci),ci);
  assert.throws(()=>selectSigningIdentity({CI:'true',PANEL_LOCAL_SIGNING_IDENTITY:hash},list),/GitHub/);
});
