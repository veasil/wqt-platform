import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../../shared/browser/team-login-return.js',import.meta.url),'utf8').replace(/^export /gm,'');
function fixture(){
 const records=new Map();const origin='https://platform.example';
 const location={origin,pathname:'/connect/authorize.html',href:origin+'/connect/authorize.html?state=fixture',assign(url){this.assigned=url},replace(url){this.replaced=url}};
 const ctx={URL,Date,Number,JSON,location,sessionStorage:{getItem:k=>records.get(k)||null,setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)}};
 runInNewContext(source,ctx);return {ctx,records,location};
}
test('team login resumes the fixed same-origin authorization page once in the same tab',()=>{
 const {ctx,records,location}=fixture();ctx.beginTeamLogin();assert.equal(location.assigned,'/player/?team_connect=1');
 location.pathname='/player/';location.href=location.origin+'/player/?team_connect=1';
 assert.equal(ctx.returnToTeamAuthorization(),true);assert.equal(location.replaced,location.origin+'/connect/authorize.html?state=fixture');assert.equal(records.size,0);assert.equal(ctx.returnToTeamAuthorization(),false);
});
test('external, arbitrary internal and expired return destinations cannot redirect login',()=>{
 for(const [url,createdAt] of [['https://evil.example/',Date.now()],['/admin/',Date.now()],['/connect/authorize.html#fragment',Date.now()],['/connect/authorize.html',Date.now()-600001],['/connect/authorize.html',Date.now()+10000]]){
  const {ctx,records,location}=fixture();records.set('WQT_TEAM_LOGIN_RETURN',JSON.stringify({url,createdAt}));location.href=location.origin+'/player/?team_connect=1';assert.equal(ctx.returnToTeamAuthorization(),false);assert.equal(location.replaced,undefined);
 }
});
test('ordinary player navigation ignores a pending courseware continuation',()=>{
 const {ctx,location}=fixture();ctx.beginTeamLogin();location.href=location.origin+'/player/';assert.equal(ctx.returnToTeamAuthorization(),false);
});
