// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/discard-probe.js',import.meta.url),'utf8');
function setup() {
 const logs=[],timers=new Map();let handler,calls=0,subject='[YubinBox discard test]',answer='compose-1';
 const button={addEventListener:(type,fn)=>{handler=fn;},removeEventListener(){},remove(){}};
 const root={ownerDocument:{createElement:()=>button,defaultView:{prompt:()=>answer}},appendChild(){}};
 const view=Object.assign(new EventEmitter(),{getElement:()=>root,getSubject:()=>subject,getCurrentDraftID:async()=> 'fixture-draft',
 discard(){calls++;view.emit('discard',{cancel(){throw Error('must not cancel');}});view.destroyed=true;view.emit('destroy');}});
 const c=vm.createContext({console:{log:s=>logs.push(JSON.parse(s.split('\n')[1]))},
 setTimeout:(fn,ms)=>{const id={};timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(source,c);
 return {api:c.YubinBoxDiscardTest,view,logs,timers,click:async trusted=>handler({isTrusted:trusted}),calls:()=>calls,
 subject:s=>subject=s,answer:s=>answer=s};
}
test('discard test requires opt-in, trusted click, exact subject and explicit compose confirmation',async()=>{
 const f=setup();for(const enabled of [false,undefined,'true'])f.api.start({getElement(){throw Error('disabled');}},'compose-1',enabled)();
 const stop=f.api.start(f.view,'compose-1',true);assert.equal(f.calls(),0);
 await f.click(false);f.subject('ordinary draft');await f.click(true);assert.equal(f.calls(),0);
 f.subject('[YubinBox discard test]');f.answer('wrong');await f.click(true);assert.equal(f.calls(),0);stop();
});
test('discard test calls once, records synchronous events in order and reads draft after destroy',async()=>{
 const f=setup();f.api.start(f.view,'compose-1',true);await f.click(true);await f.click(true);
 assert.equal(f.calls(),1);
 assert.deepEqual(f.logs.map(x=>x.reason),['draft-id','discard-call-start','discard-event','destroy-event','discard-return','draft-id']);
 assert.equal(f.logs[4].returnValue,'undefined');assert.equal(f.logs[5].phase,'after');
 for(const {fn,ms} of [...f.timers.values()])if(ms===5000)fn();
 assert.equal(f.logs.at(-1).discardSeen,true);assert.equal(f.logs.at(-1).destroySeen,true);
 assert.equal(f.view.listenerCount('destroy'),0);
});
test('discard exception is sanitized and never retried',async()=>{
 const f=setup();f.view.discard=()=>{throw new TypeError('PRIVATE');};f.api.start(f.view,'compose-1',true);
 await f.click(true);await f.click(true);assert.equal(f.logs.filter(x=>x.reason==='discard-call-start').length,1);
 assert.equal(f.logs.find(x=>x.reason==='discard-exception').name,'TypeError');assert.ok(!JSON.stringify(f.logs).includes('PRIVATE'));
 for(const {fn} of [...f.timers.values()])fn();
});
