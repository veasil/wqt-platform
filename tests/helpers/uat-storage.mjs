import OSS from 'ali-oss';
export function createUatStorage(env){
 if(env.WQT_RUNTIME_TEST_CHILD!=='1'||!/^wqt_r1_[a-f0-9]{20}$/.test(env.WQT_REDIS_NAMESPACE||''))throw new Error('Owned UAT storage only');
 const prefix='wqt-player-uat/'+env.WQT_REDIS_NAMESPACE+'/';
 const client=new OSS({accessKeyId:env.ALIBABA_CLOUD_ACCESS_KEY_ID,accessKeySecret:env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,bucket:env.OSS_BUCKET_NAME,secure:true,...(env.OSS_ENDPOINT?{endpoint:env.OSS_ENDPOINT}:{region:(env.OSS_REGION||'cn-hongkong').startsWith('oss-')?env.OSS_REGION:'oss-'+env.OSS_REGION})});
 const key=value=>{if(typeof value!=='string'||value.startsWith('/')||value.includes('..')||value.includes('\\'))throw new Error('UAT storage key invalid');return prefix+value};
 return {put:(name,...args)=>client.put(key(name),...args),get:(name,...args)=>client.get(key(name),...args),getStream:(name,...args)=>client.getStream(key(name),...args),delete:(name,...args)=>client.delete(key(name),...args),list:async options=>{const result=await client.list({...options,prefix:prefix+(options.prefix||'')});return {...result,objects:result.objects?.map(o=>({...o,name:o.name.slice(prefix.length),url:undefined}))}},cleanup:async()=>{let marker;do{const result=await client.list({prefix,marker,'max-keys':100});for(const object of result.objects||[]){if(!object.name.startsWith(prefix))throw new Error('UAT cleanup prefix mismatch');await client.delete(object.name)}marker=result.isTruncated?result.nextMarker:null}while(marker)}};
}
