import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';

async function harness() {
 let now=100000,next=0;
 const timers=new Map(),store=new Map(),values=[];
 const context=vm.createContext({
  Date:{now:()=>now},Map,Number,String,Math,
  sessionStorage:{getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)},
  setInterval:fn=>{const id=++next;timers.set(id,fn);return id},clearInterval:id=>timers.delete(id),
 });
 const source=(await readFile('shared/browser/sms-cooldown.js','utf8')).replace('export function','function');
 vm.runInContext(source+';this.create=createSmsCooldown;',context);
 return {store,values,timers,make:()=>context.create(value=>values.push(value)),advance(ms){now+=ms;for(const fn of [...timers.values()])fn()}};
}

test('server remaining wait counts down, catches up after a suspended tab and unlocks at deadline',async()=>{
 const h=await harness(),c=h.make();c.select('16600000940');c.start('16600000940',31);
 assert.equal(h.values.at(-1),31);h.advance(1000);assert.equal(h.values.at(-1),30);
 h.advance(29000);assert.equal(h.values.at(-1),1);h.advance(1000);assert.equal(h.values.at(-1),0);
 assert.equal(h.timers.size,0);assert.equal(h.store.size,0);
});

test('view changes/reloads preserve the wait, while another phone has an independent deadline',async()=>{
 const h=await harness(),c=h.make();c.select('16600000940');c.start('16600000940',60);c.dispose();
 h.advance(29000);const next=h.make();next.select('16600000940');assert.equal(h.values.at(-1),31);
 next.select('16600000941');assert.equal(h.values.at(-1),0);
 next.start('16600000940',20);assert.equal(h.values.at(-1),0,'a delayed response must not block another phone');
 next.select('16600000940');assert.equal(h.values.at(-1),20);
 next.dispose();assert.equal(h.timers.size,0);
});

test('blocked browser storage still supports in-memory countdown without weakening server enforcement',async()=>{
 const source=(await readFile('shared/browser/sms-cooldown.js','utf8')).replace('export function','function');
 const values=[];let tick,now=0;
 const context=vm.createContext({Map,Number,String,Math,Date:{now:()=>now},sessionStorage:{getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}},setInterval:fn=>{tick=fn;return 1},clearInterval(){}});
 vm.runInContext(source+';this.create=createSmsCooldown;',context);
 const c=context.create(value=>values.push(value));c.select('16600000940');c.start('16600000940',2);assert.equal(values.at(-1),2);
 now=2000;tick();assert.equal(values.at(-1),0);c.dispose();
});
