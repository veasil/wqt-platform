import assert from 'node:assert/strict';
import {test} from 'node:test';
import {csvCell,filterOrganizations,filterUsers,organizationsCsv,usersCsv} from '../admin-web/src/utils/operations-export.mjs';

const organizations=[
  {id:1,name:'林知夏咨询师',plan:'personal',entitled:true,status:'active'},
  {id:2,name:'暖禾社工室',location:'青禾社区',plan:'group',entitled:true,status:'active'},
  {id:3,name:'星桥学校',plan:'group',entitled:false,status:'active'},
  {id:0,name:'免费组织',entitled:false,status:'active'}
];
test('organization filtering defaults to effective paid rights; level, state and search compose',()=>{
  assert.deepEqual(filterOrganizations(organizations).map(o=>o.id),[1,2]);
  assert.deepEqual(filterOrganizations(organizations,{level:'group',query:'青禾'}).map(o=>o.id),[2]);
  assert.deepEqual(filterOrganizations(organizations,{level:'group',entitlement:'not_entitled'}).map(o=>o.id),[3]);
  assert.equal(filterOrganizations(organizations,{entitlement:''}).length,4);
  assert.equal(filterOrganizations(organizations,{entitlement:'',query:'不存在'}).length,0);
});
const users=[
  {id:8,guardian_name:'林老师',real_name:'林知夏',phone:'16600000001',status:'active',online:true,categories:['entitled'],accounts:[{plan:'personal',organization_name:'咨询师'},{plan:'group',organization_name:'暖禾社工室'},{plan:'group',organization_name:'暖禾社工室'}]},
  {id:9,guardian_name:'顾青',phone:'16600000002',status:'active',categories:['free'],accounts:[]}
];
test('user export filters by identity once, composing category, organization level and query',()=>{
  const filtered=filterUsers(users,{level:'group',category:'entitled',query:'暖禾'});
  assert.equal(filtered.length,1);
  assert.equal(filterUsers(users,{level:'group',category:'free'}).length,0);
  assert.equal(filterUsers(users,{category:'free'}).length,1);
  const output=usersCsv(filtered);
  assert.ok(output.startsWith('\uFEFF'));
  assert.equal(output.split('\r\n').length,3);
  assert.ok(output.includes('咨询师、暖禾社工室'));
  assert.ok(output.includes('"3"')); // Account count differs from the single user count.
});
test('CSV escapes quotes, commas and multiline fields and neutralizes formulas',()=>{
  assert.equal(csvCell('a,"b"\nc'),'"a,""b""\nc"');
  for(const value of ['=1+1',' +SUM(1)','-2','@SUM(1)','\t=1','\nhello','\uFEFF=2']) assert.ok(csvCell(value).startsWith('"\''));
  assert.equal(csvCell('16600000001'),'"16600000001"');
  assert.equal(csvCell(null),'""');
});
test('exports use an explicit column list and never include credential or internal snapshot fields',()=>{
  const privateFields={password_hash:'secret-hash',credential_version:'secret-version',session:{token:'secret-token'},unlisted:'secret-extra'};
  const output=organizationsCsv([{...organizations[0],...privateFields,name:'=1+1'}])+usersCsv([{...users[0],...privateFields}]);
  assert.ok(output.includes("'=1+1"));
  for(const value of Object.values(privateFields).filter(value=>typeof value==='string')) assert.ok(!output.includes(value));
  assert.ok(!output.includes('secret-token'));
});
