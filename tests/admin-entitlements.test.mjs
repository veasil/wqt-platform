import assert from 'node:assert/strict';
import {test} from 'node:test';
import {addYear,renewalUntil,createOperationClient} from '../admin-web/src/utils/entitlements.js';

const actor={identityId:1,accountId:11};
function storage() {
  const map=new Map();
  return {getItem:key=>map.get(key) ?? null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key),map};
}
test('annual renewal handles expiry, early renewal and leap day',()=>{
  const now=Date.UTC(2026,9,11),future=Date.UTC(2027,9,11);
  assert.equal(renewalUntil(now-1,now),future);
  assert.equal(renewalUntil(future,now),Date.UTC(2028,9,11));
  assert.equal(addYear(Date.UTC(2024,1,29)),Date.UTC(2025,1,28));
});
test('lost delivery response survives reload and retries the same request; changed input is blocked',async()=>{
  const saved=storage(),requests=[];
  const options={storage:saved,actor,randomId:()=> 'delivery-fixture-001',post:async(path,body)=>{
    requests.push([path,body]);throw new Error('lost response');
  }};
  let client=createOperationClient(options);
  await assert.rejects(client.execute('/api/admin/subscriptions',{plan:'group',organizationName:'A'}),/lost/);
  assert.equal(saved.map.size,1);
  client=createOperationClient({...options,post:async(path,body)=>{requests.push([path,body]);return {ok:true}}});
  await assert.rejects(client.execute('/api/admin/subscriptions',{plan:'city',organizationName:'A'}),/上一笔/);
  await client.retry();
  assert.deepEqual(requests[0],requests[1]);
  assert.equal(client.pending,null);assert.equal(saved.map.size,0);
});
test('pending operation is scoped to both identity and account',async()=>{
  const saved=storage();
  const client=createOperationClient({storage:saved,actor,post:async()=>{throw new Error('offline')}});
  await assert.rejects(client.execute('/api/admin/subscriptions/renew',{subscriptionId:2}));
  const other=createOperationClient({storage:saved,actor:{identityId:1,accountId:12},post:async()=>({})});
  assert.equal(other.pending,null);
});
test('definite initial rejection clears pending; auth failure after uncertain write retains it',async()=>{
  const saved=storage();let status=503;
  const client=createOperationClient({storage:saved,actor,post:async()=>{throw {response:{status}}}});
  await assert.rejects(client.execute('/api/admin/account-bindings',{accountId:2,identityId:3}));
  assert.ok(client.pending);status=403;
  await assert.rejects(client.retry());assert.ok(client.pending);
  const rejected=createOperationClient({storage:storage(),actor,post:async()=>{throw {response:{status:400}}}});
  await assert.rejects(rejected.execute('/api/admin/account-bindings',{accountId:2,identityId:3}));assert.equal(rejected.pending,null);
});
test('identity passwords and SMS are never saved in recovery storage',async()=>{
  const saved=storage();const client=createOperationClient({storage:saved,actor,post:async()=>{throw new Error('offline')}});
  await assert.rejects(client.execute('/api/admin/identities',{password:'secret-fixture',smsCode:'123456'}));
  assert.equal(saved.map.size,0);
});
test('parallel submits of the same action share one in-flight request',async()=>{
  let finish,calls=0;
  const response=new Promise(resolve=>{finish=resolve});
  const client=createOperationClient({storage:storage(),actor,post:async()=>{calls++;return response}});
  const body={subscriptionId:5};
  const first=client.execute('/api/admin/subscriptions/renew',body);
  const second=client.execute('/api/admin/subscriptions/renew',body);
  finish({ok:true});
  assert.deepEqual(await Promise.all([first,second]),[{ok:true},{ok:true}]);assert.equal(calls,1);
});
