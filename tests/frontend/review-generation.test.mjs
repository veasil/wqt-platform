import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../../public/game-review.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const data={session:{id:1,startedAt:1000,endedAt:2000,finalScore:3,players:null,location:null,mode:'standard'},cards:[{cardCode:'B01',eventText:'吃饭时手机响了',optionText:'先放下手机',choice:'A',phase:'启蒙期',safetyType:'身体',consequence:'注意身体的信号',attributeDelta:{安全力:1}}],skills:[],durationMs:1000};
const structured={overview:{summary:'认真观察后作出选择'},story:{paragraphs:['小伍先放下手机，注意身体的信号。'],scenes:[1,2,3].map(n=>({caption:'场景'+n,imagePrompt:'真实情境'+n}))},pact:{items:[]}};

function harness(){
 const pending=[],calls=[];
 const context={window:{location:{search:''}},location:{pathname:'/player/'},localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null},console:{warn(){}},URLSearchParams,
  fetch:async(path,options)=>{
   if(!path.startsWith('/api/'))return {ok:false,status:404};
   calls.push({path,body:JSON.parse(options.body)});
   let resolve;const response=new Promise(r=>resolve=r);
   pending.push({path,resolve});return response;
  }};
 vm.runInNewContext(source,context);
 return {review:context.window.GameReview,pending,calls};
}

for(const paragraphCount of [1,3,5,8])for(const failed of [false,true])test(`${paragraphCount}-paragraph report keeps three illustrations concurrent and ordered${failed?' with one rate-limited image':''}`,async()=>{
 const {review,pending,calls}=harness();
 const content={...structured,story:{...structured.story,paragraphs:Array.from({length:paragraphCount},(_,i)=>'第'+(i+1)+'段：小伍先放下手机，注意身体的信号。')}};
 let completed=false;
 const generation=review.generateReport(data).then(result=>{completed=true;return result});
 await tick();
 assert.equal(calls.length,1);
 assert.equal(calls[0].path,'/api/llm/story');
 const prompt=calls[0].body.prompt;
 assert.match(prompt,/正文合计300-500字/);
 assert.match(prompt,/3-5个自然段/);
 assert.doesNotMatch(prompt,/1500|8-14|逐关详写|逐关展开|来写长/);
 assert.match(prompt,/不含标题、插画说明、小贴士和行动公约/);
 assert.match(prompt,/严禁虚构/);
 assert.match(prompt,/吃饭时手机响了/);
 pending[0].resolve({ok:true,json:async()=>({story:JSON.stringify(content)})});
 await tick();
 assert.equal(pending.length,4,'all three requests start before any image completes');
 assert.ok(pending.slice(1).every(r=>r.path==='/api/llm/image'));
 assert.equal(completed,false);
 const images=['data:image/png;base64,Zmlyc3Q=','data:image/png;base64,c2Vjb25k','data:image/png;base64,dGhpcmQ='];
 pending[3].resolve({ok:true,json:async()=>({dataUri:images[2]})});
 await tick();assert.equal(completed,false,'waits for remaining images');
 pending[1].resolve({ok:true,json:async()=>({dataUri:images[0]})});
 await tick();assert.equal(completed,false,'slowest image still outstanding');
 pending[2].resolve(failed
  ?{ok:false,status:502,json:async()=>({error:'synthetic Throttling.RateQuota'})}
  :{ok:true,json:async()=>({dataUri:images[1]})});
 const result=await generation;
 assert.equal(result.missingImages,failed?1:0);
 assert.ok(result.reportHtml.includes(content.story.paragraphs[0]),'text survives image failure');
 const offsets=images.map(uri=>result.reportHtml.indexOf(uri));
 assert.ok(offsets[0]>=0&&offsets[2]>offsets[0],'output follows scene order, not completion order');
 if(failed)assert.equal(offsets[1],-1);
 else assert.ok(offsets[1]>offsets[0]&&offsets[1]<offsets[2]);
 assert.equal(calls.length,4,'no implicit extra paid generation or retries');
});
