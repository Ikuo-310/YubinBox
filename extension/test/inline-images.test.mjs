// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const script = await readFile(new URL('../src/inline-images.js', import.meta.url), 'utf8');
const url = 'blob:https://mail.google.com/fixture';
function setup(fetch, main) {
  const logs = [];
  const img = { getAttribute: key => ({src:url, 'data-surl':'cid:fixture',alt:'fixture.jpg',width:'10',height:'20'})[key] };
  let disconnected = false;
  const c = vm.createContext({ fetch, Blob, AbortController, setTimeout, clearTimeout,
    browser: {runtime:{sendMessage:main}},
    console:{log:line=>logs.push(JSON.parse(line.split('\n')[1]))},
    MutationObserver: class { observe() {} disconnect(){disconnected=true;} },
  });
  vm.runInContext(script,c);
  return {api:c.YubinBoxInlineImages, logs, view:{getBodyElement:()=>({querySelectorAll:()=>[img,img]})}, disconnected:()=>disconnected};
}
test('inline fetch projects metadata only and opt-in does not access body', async()=>{
  let calls=0;
  const f=setup(async()=>{calls++;return {ok:true,blob:async()=>new Blob(['PRIVATE'],{type:'image/jpeg'})};},()=>{throw Error('no fallback');});
  for(const enabled of [false,'true',undefined]) f.api.start({getBodyElement(){throw Error('disabled');}},'one',enabled)();
  assert.equal(calls,0);
  const stop=f.api.start(f.view,'one',true);
  await new Promise(setImmediate);
  assert.equal(calls,1);
  assert.equal(f.logs[0].success,true);
  assert.equal(f.logs[0].size,7);
  assert.equal(f.logs[0].instanceofBlob,true);
  assert.ok(!JSON.stringify(f.logs).includes('PRIVATE'));
  assert.ok(!JSON.stringify(f.logs).includes(url));
  stop();assert.equal(f.disconnected(),true);
});
test('content failure falls back to MAIN metadata and sanitizes errors',async()=>{
  let messages=0;
  const f=setup(async()=>{throw new TypeError('PRIVATE URL');},async msg=>{messages++;assert.equal(msg.url,url);return {attempted:true,success:true,size:123,type:'image/png',instanceofBlob:true,extra:'PRIVATE'};});
  const stop=f.api.start(f.view,'one',true);await new Promise(setImmediate);
  assert.equal(messages,1);assert.equal(f.logs[0].error,'TypeError');
  assert.equal(f.logs[1].source,'inline-image-main-world');assert.equal(f.logs[1].success,true);
  assert.ok(!JSON.stringify(f.logs).includes('PRIVATE'));stop();
});
test('invalid URLs never fetch and destruction prevents fallback',async()=>{
  let finish;
  const f=setup(()=>new Promise(resolve=>{finish=resolve;}),()=>{throw Error('must not fallback');});
  assert.equal((await f.api.fetchMetadata('https://example.invalid')).attempted,false);
  const stop=f.api.start(f.view,'one',true);stop();finish({ok:false,status:404});
  await new Promise(setImmediate);assert.equal(f.logs.length,0);
});
