// Disposable local demonstration. Does not load .env or use application database defaults.
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createOwnedDatabase,dropOwnedDatabase,sanitizedChildEnv} from '../helpers/runtime-test-env.mjs';
if(process.argv.includes('--child')){
 const {run}=await import('../runtime/scenarios/team-courseware.mjs');await run({demo:true});
}else{
 for(const key of ['WQT_TEST_PG_ADMIN_URL','WQT_TEST_REDIS_URL']){
  const value=process.env[key];if(!value)throw new Error(key+' must explicitly point to a dedicated local test service');
  const url=new URL(value);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('Local test services required');
 }
 const owned=await createOwnedDatabase();let child;
 try{
  child=fork(fileURLToPath(import.meta.url),['--child'],{windowsHide:true,stdio:['inherit','inherit','inherit','ipc'],env:sanitizedChildEnv({WQT_RUNTIME_TEST_CHILD:'1',WQT_ACCOUNT_MODEL:'accounts',DATABASE_URL:owned.connectionString,CARDS_DATABASE_URL:owned.connectionString,CARDS_SOURCE:'postgres',REDIS_URL:process.env.WQT_TEST_REDIS_URL,WQT_REDIS_NAMESPACE:owned.database,JWT_SECRET:'disposable-courseware-demo-secret-only'})});
  const stop=()=>{if(child.connected)child.send({type:'stop'});};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);process.once('message',message=>{if(message?.type==='stop')stop()});
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>{process.exitCode=code||0;resolve()})});
  process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
 }finally{if(child && child.exitCode===null)child.kill();await dropOwnedDatabase(owned)}
}
