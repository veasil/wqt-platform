import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Run the shipped browser entry point, with provider failure stopping before paid generation.
for (const count of [0,1,6]) test(`review with ${count} cards reaches generation without a minimum-card setting`,async()=>{
  const calls=[];
  const events=Array.from({length:count},(_,i)=>({type:'card_choice',ts:1000+i,payload:{cardId:i+1,choice:'A',eventText:'情景',optionText:'观察'}}));
  const storage=new Map([['WQT_AUTH_TOKEN','test-token'],['WQT_SESSION_ID','1']]);
  const target={innerHTML:'',querySelector:()=>null};
  const context={window:{location:{search:''}},document:{getElementById:()=>target},localStorage:{getItem:k=>storage.get(k)||null},sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},console,URLSearchParams,crypto:globalThis.crypto,
    fetch:async(path)=>{calls.push(path);if(path==='/api/game/session/1')return {ok:true,json:async()=>({session:{id:1,started_at:1000,ended_at:2000},events})};return {ok:false,status:503,json:async()=>({error:'provider unavailable in test'})};}};
  vm.runInNewContext(await readFile(new URL('../../public/game-review.js',import.meta.url),'utf8'),context);
  await context.window.GameReview.openReview(target);
  assert.ok(calls.includes('/api/llm/story'),JSON.stringify(calls));
  assert.ok(!calls.includes('/api/settings'));
  assert.match(target.innerHTML,/provider unavailable in test/);
});
