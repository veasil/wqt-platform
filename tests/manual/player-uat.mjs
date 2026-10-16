// Owned local UAT. Only allowlisted AI configuration may be reused; never inherit business DBs.
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import dotenv from 'dotenv';
import {createOwnedDatabase,dropOwnedDatabase,sanitizedChildEnv} from '../helpers/runtime-test-env.mjs';
if(process.argv.includes('--child')){
 if(process.env.WQT_RUNTIME_TEST_CHILD!=='1'||!/^wqt_r1_[a-f0-9]{20}$/.test(process.env.WQT_REDIS_NAMESPACE||''))throw new Error('Owned UAT environment required');
 const [{startRuntime},{dbRun,dbGet},{cardsDbRun},{deliverSubscription,bindAccount}]=await Promise.all([import('../../src/runtime.js'),import('../../src/db.js'),import('../../src/cards-db.js'),import('../../src/platform/accounts/service.js')]);
 const {createUatStorage}=await import('../helpers/uat-storage.mjs');
 const storage=process.env.ALIBABA_CLOUD_ACCESS_KEY_ID?createUatStorage(process.env):null;
 const runtime=await startRuntime({port:8188,host:'127.0.0.1',storageClient:storage});
 try{
 const now=Date.now();
 const {seedDemoDirectory}=await import('../helpers/demo-directory.mjs');
 await seedDemoDirectory({dbGet,dbRun,deliverSubscription,bindAccount,
  phones:['16600000888','16600000889','16600000890','16600000891','16600000892','16600000893'],password:'PlayerUat2026!'});
 if(process.env.WQT_UAT_REVIEW_PHONE){
  const {Client}=await import('pg');const {provisionUatReviewer}=await import('../helpers/uat-reviewer.mjs');
  const client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();
  try{await provisionUatReviewer(client,{phone:process.env.WQT_UAT_REVIEW_PHONE,password:process.env.WQT_UAT_REVIEW_PASSWORD});console.log('UAT reviewer permissions provisioned')}finally{await client.end()}
 }
 await dbRun("INSERT INTO activities(name,organizer,activity_code,status) VALUES('新版验收体验活动','本机验收室','WQTUAT','active')");
 const cards=JSON.parse(readFileSync(new URL('../../scripts/cards_2026.json',import.meta.url),'utf8')),ids=[];
 for(const [i,c]of cards.entries()){
 const id=(await cardsDbRun("INSERT INTO cards(key,safety_type,event,phase,options_json,status,title,card_code,guide_text) VALUES(?,?,?,?,?,'released',?,?,?)",[202610000+i,c.safety_type,c.event,c.phase,JSON.stringify(c.options),c.title,c.card_code,c.guide_text])).lastID;
 ids.push((await cardsDbRun('INSERT INTO cards_released(card_id,key,safety_type,event,phase,options_json,released_at,title,card_code,guide_text) VALUES(?,?,?,?,?,?,?,?,?,?)',[id,202610000+i,c.safety_type,c.event,c.phase,JSON.stringify(c.options),now,c.title,c.card_code,c.guide_text])).lastID);
 }
 await cardsDbRun('UPDATE card_groups SET is_default=0');await cardsDbRun("INSERT INTO card_groups(name,released_ids_json,is_default,created_at) VALUES('2026验收卡牌',?,1,?)",[JSON.stringify(ids),now]);
 if(storage){const payload=Buffer.from('伍力全开 · 本机验收资料（合成测试文件）');const id='uat-materials',key='download-center/'+id;await storage.put(key,payload,{headers:{'x-oss-object-acl':'private'}});const {createHash}=await import('node:crypto');await dbRun('INSERT INTO download_releases(id,title,version,filename,object_key,size,sha256,created_at) VALUES(?,?,?,?,?,?,?,?)',[id,'验收演示资料','UAT-1','验收资料.txt',key,payload.length,createHash('sha256').update(payload).digest('hex'),now])}
 console.log('PLAYER_UAT_READY http://127.0.0.1:8188/player/');
 if(process.argv.includes('--check-ai')){const {generateFeedback}=await import('../../src/game/player/feedback.js');const {feedbackPrompt}=await import('../../src/game/player/feedback-policy.js');try{const response=await generateFeedback(feedbackPrompt(cards[0],'先放下手机，和家人一起吃饭'));console.log(JSON.stringify({liveAI:true,provider:response.provider,model:response.model,safe:response.safe}));}catch(e){console.log(JSON.stringify({liveAI:false,status:e.status||0,upstreamStatus:e.upstreamStatus||null,reason:e.status?e.message:'供应商连接未通过'}))}}
 await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve)});
 }finally{await runtime.stop();if(storage)await storage.cleanup()}
}else{
 if(!process.env.WQT_TEST_PG_ADMIN_URL||!process.env.WQT_TEST_REDIS_URL)throw new Error('Dedicated test PG and Redis required');
 const external={};
 if(process.argv.includes('--live-sms')){
  const local=dotenv.parse(readFileSync(new URL('../../.env',import.meta.url)));
  for(const key of ['BMOB_APP_ID','BMOB_REST_KEY']){if(!local[key])throw new Error('Requested SMS configuration missing');external[key]=local[key]}
 }
 if(process.argv.includes('--reviewer')){
  const local=dotenv.parse(readFileSync(new URL('../../.env',import.meta.url)));
  for(const key of ['WQT_UAT_REVIEW_PHONE','WQT_UAT_REVIEW_PASSWORD']){if(!local[key])throw new Error('Local reviewer configuration missing');external[key]=local[key]}
 }
 if(process.argv.includes('--live-captcha')){
  const local=dotenv.parse(readFileSync(new URL('../../.env',import.meta.url)));
  for(const key of ['CAPTCHA_APP_ID','CAPTCHA_APP_SECRET_KEY','TENCENT_SECRET_ID','TENCENT_SECRET_KEY']){
   if(!local[key])throw new Error('Live captcha configuration missing: '+key);
   external[key]=local[key];
  }
  external.CAPTCHA_ENABLED='true';
 }
 const owned=await createOwnedDatabase();
 try{
 if(process.argv.includes('--live-oss')){const local=dotenv.parse(readFileSync(new URL('../../.env',import.meta.url)));for(const key of ['ALIBABA_CLOUD_ACCESS_KEY_ID','ALIBABA_CLOUD_ACCESS_KEY_SECRET','OSS_BUCKET_NAME','OSS_REGION','OSS_ENDPOINT'])if(local[key])external[key]=local[key]}
 if(process.argv.includes('--live-ai')){const local=dotenv.parse(readFileSync(new URL('../../.env',import.meta.url)));for(const [key,value] of Object.entries(local))if(/^(DEEPSEEK|DASHSCOPE|OPENAI|GEMINI)_(API_KEY|BASE_URL|MODEL)$/.test(key))external[key]=value;external.DEFAULT_LLM_PROVIDER='阿里云 DashScope';external.DEFAULT_LLM_MODEL='qwen-plus'}
 const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--child',...(process.argv.includes('--live-ai')&&!process.argv.includes('--skip-ai-check')?['--check-ai']:[])],{windowsHide:true,stdio:'inherit',env:sanitizedChildEnv({...external,WQT_RUNTIME_TEST_CHILD:'1',WQT_ACCOUNT_MODEL:'accounts',DATABASE_URL:owned.connectionString,CARDS_DATABASE_URL:owned.connectionString,CARDS_SOURCE:'postgres',REDIS_URL:process.env.WQT_TEST_REDIS_URL,WQT_REDIS_NAMESPACE:owned.database,JWT_SECRET:'local-player-uat-synthetic-secret',SETTINGS_ENCRYPTION_KEY:'0123456789abcdef'.repeat(4)})});
 const stop=()=>child.kill();process.once('SIGINT',stop);process.once('SIGTERM',stop);process.exitCode=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject)})||0;
 }finally{if(process.argv.includes('--live-oss')){const {createUatStorage}=await import('../helpers/uat-storage.mjs');await createUatStorage({...external,WQT_RUNTIME_TEST_CHILD:'1',WQT_REDIS_NAMESPACE:owned.database}).cleanup()}await dropOwnedDatabase(owned)}
}
