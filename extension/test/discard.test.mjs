// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const script=await readFile(new URL('../src/discard.js',import.meta.url),'utf8');
function setup(nodes=[]) {
 const logs=[]; let callback, pending, disconnected=false;
 const c=vm.createContext({console:{log:s=>logs.push(JSON.parse(s.split('\n')[1]))},
 setTimeout:fn=>{pending=fn;return 1;},clearTimeout:()=>{pending=null;},
 MutationObserver:class{constructor(fn){callback=fn;} observe(root,opt){assert.equal(opt.subtree,true);} disconnect(){disconnected=true;}}});
 vm.runInContext(script,c);
 const root={querySelectorAll:()=>nodes,contains:p=>p===root,getAttribute:()=>null};
 return {api:c.YubinBoxDiscard,root,logs,mutate:()=>callback(),flush:()=>pending?.(),disconnected:()=>disconnected};
}
function node(attrs={},classes=[]) {return {tagName:'DIV',getAttribute:key=>attrs[key]??null,classList:{contains:k=>classes.includes(k)},click(){throw Error('must not click');}};}
test('discard strict opt-in avoids any root access',()=>{
 const f=setup();for(const enabled of [false,undefined,'true']) f.api.start({getElement(){throw Error('disabled');}},'one',enabled)();
 assert.equal(f.logs.length,0);
});
test('discard handles English, Japanese and class candidates without action or private data',()=>{
 for(const attrs of [{'aria-label':'Discard draft (Ctrl-Shift-D)'},{title:'下書きを破棄'},{'data-action':'discard-draft'},{}]) {
 const el=node({...attrs,'data-tooltip-id':'PRIVATE','data-secret':'PRIVATE'},Object.keys(attrs).length?[]:['oh']);
 const f=setup([el]);el.parentElement=f.root;
 const stop=f.api.start({getElement:()=>f.root},'one',true);
 assert.equal(f.logs[0].candidateCount,1);assert.equal(f.logs[0].uniqueCandidate,true);
 assert.equal(f.logs[0].stableAttributeVerified,false);
 assert.ok(!JSON.stringify(f.logs).includes('PRIVATE'));
 f.mutate();f.flush();assert.equal(f.logs.length,1);
 stop();assert.equal(f.disconnected(),true);f.mutate();assert.equal(f.logs.length,1);
 }
});
test('discard zero and multiple candidates remain unresolved; errors stay local',()=>{
 for(const nodes of [[],[node({title:'Discard'}),node({title:'破棄'})]]){
 const f=setup(nodes);const stop=f.api.start({getElement:()=>f.root},'x',true);
 assert.equal(f.logs[0].candidateCount,nodes.length);assert.equal(f.logs[0].identification,'unresolved');stop();
 }
 const f=setup();assert.doesNotThrow(()=>f.api.start({getElement(){throw Error('PRIVATE');}},'x',true)());
 assert.equal(f.logs[0].status,'error');assert.ok(!JSON.stringify(f.logs).includes('PRIVATE'));
});
