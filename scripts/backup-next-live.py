#!/usr/bin/env python3
"""Backup only the explicitly named new-release PostgreSQL service."""
import base64,datetime,email.utils,fcntl,hashlib,hmac,json,os,subprocess,urllib.request
from pathlib import Path
root=Path('/var/lib/wqt-next-backup');root.mkdir(mode=0o700,exist_ok=True)
with (root/'backup.lock').open('w') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 target=root/('wqt-next-'+stamp+'.dump')
 try:
  with target.open('wb') as stream:
   subprocess.run(['kubectl','exec','-n','environment-6ad2657554d74b84a5bd1e57','deployment/service-6ad265dc38f4286bd6df61eb','--','pg_dump','-U','wqt_next','-d','wqt_next','-Fc','--no-owner','--no-acl'],stdout=stream,stderr=subprocess.PIPE,check=True,timeout=120)
  body=target.read_bytes();assert len(body)>1000
  creds=json.loads(Path('/etc/wqt-next-backup/oss.json').read_text())
  bucket='ai5000days-wqt-next-backups-hk';key='db/'+target.name;date=email.utils.formatdate(usegmt=True);contenttype='application/octet-stream'
  md5=base64.b64encode(hashlib.md5(body).digest()).decode()
  signature=base64.b64encode(hmac.new(creds['AccessKeySecret'].encode(),('PUT\n'+md5+'\n'+contenttype+'\n'+date+'\n/'+bucket+'/'+key).encode(),hashlib.sha1).digest()).decode()
  request=urllib.request.Request('https://'+bucket+'.oss-cn-hongkong.aliyuncs.com/'+key,data=body,method='PUT',headers={'Date':date,'Content-MD5':md5,'Content-Type':contenttype,'Authorization':'OSS '+creds['AccessKeyId']+':'+signature})
  with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request,timeout=45) as response:assert response.status==200
  state={'successAt':stamp,'object':key,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()};(root/'last-success.json').write_text(json.dumps(state))
  for old in sorted(root.glob('*.dump'))[:-3]:old.unlink()
  print(json.dumps(state))
 except Exception as error:
  print(json.dumps({'failedAt':stamp,'errorType':type(error).__name__}));raise SystemExit(1)
