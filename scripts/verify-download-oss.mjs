// Run only after approval to create one temporary private object in the named bucket.
// Never loads database credentials, starts the application, lists or edits existing objects.
import fs from 'node:fs';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import OSS from 'ali-oss';

const [configPath,expectedBucket]=process.argv.slice(2);
if(!configPath || !expectedBucket || process.env.WQT_APPROVED_OSS_PROBE!=='1')
  throw new Error('Explicit config path, expected bucket and approved OSS probe flag are required');
const config=dotenv.parse(fs.readFileSync(configPath));
if(config.OSS_BUCKET_NAME!==expectedBucket)throw new Error('OSS target does not match the approved bucket');
const client=new OSS({accessKeyId:config.ALIBABA_CLOUD_ACCESS_KEY_ID,accessKeySecret:config.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
  bucket:expectedBucket,secure:true,timeout:15000,
  region:config.OSS_REGION?.startsWith('oss-')?config.OSS_REGION:`oss-${config.OSS_REGION}`,
  ...(config.OSS_ENDPOINT?{endpoint:config.OSS_ENDPOINT}:{})});
const key=`download-center/verification/${crypto.randomUUID()}`;
const content=Buffer.from('WQT download private-object verification; synthetic content only.');
let uploaded=false,versionId;
console.log(JSON.stringify({probe:key,operation:'approved private-object verification'}));
try {
  const put=await client.put(key,content,{headers:{'x-oss-object-acl':'private'}});uploaded=true;
  versionId=put.res?.headers?.['x-oss-version-id'];
  const acl=await client.getACL(key);
  if(acl.acl!=='private')throw new Error('Probe object ACL is not private');
  const downloaded=await client.get(key);
  if(!Buffer.from(downloaded.content).equals(content))throw new Error('Probe contents differ');
  const url=new URL(client.signatureUrl(key,{expires:30}));
  url.search='';
  const anonymous=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});
  await anonymous.body?.cancel();
  if(anonymous.status!==403)throw new Error(`Anonymous object GET was not rejected with 403: ${anonymous.status}`);
  console.log(JSON.stringify({probe:key,privateACL:true,authenticatedContentsMatch:true,anonymousStatus:anonymous.status}));
} finally {
  if(uploaded){
    await client.delete(key,versionId?{versionId}:{});
    try { await client.head(key); throw new Error('Probe object still exists after cleanup'); }
    catch(error) { if(error.status!==404)throw error; }
    console.log(JSON.stringify({probe:key,cleanup:'deleted exact probe object'}));
  }
}
