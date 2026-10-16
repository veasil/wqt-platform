// Interactive UAT: synthetic people, owned PostgreSQL database, isolated Redis namespace.
// No .env loading or implicit business database fallback.
import {spawn,execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createOwnedDatabase,dropOwnedDatabase,sanitizedChildEnv} from '../helpers/runtime-test-env.mjs';

if(process.argv.includes('--child')) {
  if(process.env.WQT_RUNTIME_TEST_CHILD!=='1' || !process.env.WQT_REDIS_NAMESPACE?.startsWith('wqt_r1_')) throw new Error('Owned UAT environment required');
  const [{startRuntime},{dbRun,dbGet},{deliverSubscription,bindAccount}]=await Promise.all([
    import('../../src/runtime.js'),import('../../src/db.js'),import('../../src/platform/accounts/service.js')
  ]);
  const runtime=await startRuntime({port:8186,host:'127.0.0.1'});
  try {
    const {seedDemoDirectory}=await import('../helpers/demo-directory.mjs');
    await seedDemoDirectory({dbGet,dbRun,deliverSubscription,bindAccount,
      phones:['16600000901','16600000902','16600000903','16600000904','16600000905','16600000906'],password:'UatOnly2026!'});
    console.log('ADMIN_UAT_READY http://127.0.0.1:8186/admin/');
    await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve)});
  } finally {await runtime.stop()}
} else {
  if(!process.env.WQT_TEST_PG_ADMIN_URL || !process.env.WQT_TEST_REDIS_URL) throw new Error('Explicit dedicated WQT_TEST_PG_ADMIN_URL and WQT_TEST_REDIS_URL required');
  const owned=await createOwnedDatabase();
  try {
    const restoreIndex=process.argv.indexOf('--restore');
    if (restoreIndex>=0) {
      const backup=resolve(process.argv[restoreIndex+1] || '');
      if (!backup.startsWith('C:\\ArdenDev\\tmp\\') || !existsSync(backup)) throw new Error('Restore requires an explicit local synthetic UAT backup in C:/ArdenDev/tmp');
      execFileSync('C:/ArdenDev/tmp/wqt006-pg/tools/pg_restore.exe',['--no-owner','--no-acl','--dbname',owned.connectionString,backup],{windowsHide:true,stdio:'inherit'});
    }
    const namespace=process.env.WQT_UAT_REDIS_NAMESPACE || owned.database;
    if (!/^wqt_r1_[a-f0-9]{20}$/.test(namespace)) throw new Error('Owned UAT Redis namespace required');
    const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--child'],{windowsHide:true,stdio:'inherit',env:sanitizedChildEnv({
      WQT_RUNTIME_TEST_CHILD:'1',WQT_ACCOUNT_MODEL:'accounts',DATABASE_URL:owned.connectionString,CARDS_DATABASE_URL:owned.connectionString,CARDS_SOURCE:'postgres',
      REDIS_URL:process.env.WQT_TEST_REDIS_URL,WQT_REDIS_NAMESPACE:namespace,SETTINGS_ENCRYPTION_KEY:'0123456789abcdef'.repeat(4),JWT_SECRET:'local-uat-synthetic-credentials-only'
    })});
    const stop=()=>child.kill();process.once('SIGINT',stop);process.once('SIGTERM',stop);
    const code=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject)});
    process.exitCode=code || 0;
  } finally {await dropOwnedDatabase(owned)}
}
