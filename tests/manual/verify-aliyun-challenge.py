"""Open a genuine Aliyun challenge against local candidate assets; never solve or log in."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--live',action='store_true',required=True)
parser.add_argument('--prefix',required=True)
parser.add_argument('--scene',required=True)
parser.add_argument('--region',choices=['cn','sgp'],default='cn')
parser.add_argument('--proxy',help='Optional per-browser proxy; does not change system settings')
args=parser.parse_args()
root=Path(__file__).resolve().parents[2]
out=Path('C:/ArdenDev/tmp/wqt-aliyun-live');out.mkdir(parents=True,exist_ok=True)
public={'CAPTCHA_PROVIDER':'aliyun','CAPTCHA_ENABLED':'true','ALIYUN_CAPTCHA_REGION':args.region,
 'ALIYUN_CAPTCHA_PREFIX':args.prefix,'ALIYUN_CAPTCHA_SCENE_ID':args.scene,
 'ALIYUN_CAPTCHA_ACCESS_KEY_ID':'synthetic-not-used','ALIYUN_CAPTCHA_ACCESS_KEY_SECRET':'synthetic-not-used'}
source="""
process.env.NODE_ENV='test';Object.assign(process.env,CONFIG);
const {createApp}=await import('./src/app.js');
const s=createApp().listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));
const r=await fetch('http://127.0.0.1:'+s.address().port+'/api/auth/verification-options');
console.log('CONFIG:'+JSON.stringify({options:await r.json(),csp:r.headers.get('content-security-policy')}));
await new Promise(r=>s.close(r));
""".replace('CONFIG',json.dumps(public),1)
result=subprocess.run(['node','--input-type=module','-e',source],cwd=root,capture_output=True,text=True,encoding='utf-8',timeout=15)
if result.returncode:raise RuntimeError('Candidate public configuration bootstrap failed')
config=json.loads(next(line[7:] for line in result.stdout.splitlines() if line.startswith('CONFIG:')))
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,**({'proxy':{'server':args.proxy}} if args.proxy else {}))
 page=browser.new_page(viewport={'width':1440,'height':1000})
 responses=[];errors=[];unexpected=[];failed=[]
 page.add_init_script("window.__cspViolations=[];document.addEventListener('securitypolicyviolation',e=>window.__cspViolations.push({directive:e.effectiveDirective,blocked:e.blockedURI.split('?')[0]}));")
 page.on('pageerror',lambda e:errors.append(str(e)[:250]))
 page.on('requestfailed',lambda r:failed.append({'host':urlsplit(r.url).hostname,'path':urlsplit(r.url).path,'failure':r.failure}))
 page.on('response',lambda r:responses.append({'host':urlsplit(r.url).hostname,'path':urlsplit(r.url).path,'status':r.status}) if 'aliyuncs' in r.url or 'alicdn' in r.url else None)
 def route_request(route):
  url=urlsplit(route.request.url)
  if url.hostname!='admin.ai5000days.com':return route.continue_()
  if url.path.startswith('/api/'):
   if url.path=='/api/auth/verification-options':body=config['options']
   elif url.path=='/api/settings':body={'accountModel':'accounts','settings':[]}
   else:unexpected.append(url.path);return route.fulfill(status=403,body='Diagnostic stopped before business request')
   return route.fulfill(content_type='application/json',body=json.dumps(body))
  target=root/'admin-web/dist'/url.path.removeprefix('/admin/')
  if not target.is_file():target=root/'admin-web/dist/index.html'
  mime={'.html':'text/html','.js':'text/javascript','.css':'text/css'}.get(target.suffix,'application/octet-stream')
  return route.fulfill(content_type=mime,body=target.read_bytes(),headers={'Content-Security-Policy':config['csp']})
 page.route('**/*',route_request)
 try:
  page.goto('https://admin.ai5000days.com/admin/login',wait_until='domcontentloaded',timeout=30000)
  page.wait_for_function('() => typeof window.initAliyunCaptcha === "function"',timeout=15000)
  page.evaluate("""() => {
    window.__sdkEvents=[];const original=window.initAliyunCaptcha;
    window.initAliyunCaptcha=function(options){
      window.__sdkEvents.push({event:'init',scene:options.SceneId});
      for(const name of ['getInstance','onError','onClose','success','fail']){
        const callback=options[name];options[name]=function(value){
          window.__sdkEvents.push({event:name,argumentType:typeof value,
            ...(name==='getInstance'?{showType:typeof value?.show,methods:Object.keys(value||{})}:{}),
            ...(name==='onError'?{code:value?.code}:{}),
            ...(name==='onClose'?{reason:value}:{})});
          return callback?.(value);
        };
      }
      return original(options);
    };
  }""")
  page.locator('input[placeholder="请输入手机号"]').fill('16600000889')
  page.locator('input[placeholder="请输入密码"]').fill('synthetic-not-real-password')
  page.get_by_role('button',name='登 录',exact=True).click()
  try:
   page.wait_for_function("() => /请完成安全验证|初始化超时|服务暂不可用|初始化失败/.test(document.body.innerText)",timeout=25000)
  except Exception:pass
  page.wait_for_timeout(1000)
  page.screenshot(path=str(out/'challenge.png'),full_page=True)
  report={'sdk':page.evaluate('typeof window.initAliyunCaptcha'),'responses':responses,'errors':errors,
   'failedRequests':failed,'sdkEvents':page.evaluate('window.__sdkEvents'),
   'csp':page.evaluate('window.__cspViolations'),'businessRequestsBlocked':unexpected,
   'body':page.locator('body').inner_text()[-1200:]}
  (out/'evidence.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
  print(json.dumps(report,ensure_ascii=False))
 finally:browser.close()
