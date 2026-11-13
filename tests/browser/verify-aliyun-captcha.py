"""Real page contracts with synthetic Aliyun SDK/API; no network, SMS or database."""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
SDK = """if(window.AliyunCaptchaConfig?.region!=='cn'||window.AliyunCaptchaConfig?.prefix!=='synthetic-prefix')
  throw new Error('Aliyun SDK loaded before public config');
window.__aliyunInitializations=0;
window.initAliyunCaptcha=options=>{
  if(options.SceneId!=='synthetic-scene')throw new Error('Scene mismatch');
  if(!document.querySelector(options.element)||!document.querySelector(options.button))throw new Error('Missing SDK host elements');
  const sequence=++window.__aliyunInitializations;
  const challenge=document.createElement('button');challenge.type='button';challenge.textContent='完成测试验证';
  challenge.onclick=()=>options.success('synthetic-proof-'+sequence);
  setTimeout(()=>options.getInstance({
    show(){
      if(window.__aliyunMode==='error'){options.onError({code:'synthetic-load-error'});return;}
      document.body.append(challenge);
    },destroyCaptcha(){challenge.remove();}
  }),0);
};
"""

def main():
 with sync_playwright() as p:
  browser=p.chromium.launch(channel=os.environ.get('WQT_BROWSER_CHANNEL') or None,headless=True)
  try:
   for kind,path,mode in [
    ('admin','/admin/login','password'),('admin','/admin/login','sms'),
    ('enterprise','/enterprise/login','password'),
    ('player','/player/','password'),('player','/player/','sms'),
    ('register','/register.html','sms'),('reset','/reset-password.html','sms'),
   ]:
    context=browser.new_context();page=context.new_page();calls=[];errors=[];sdk_loads=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    def route_request(route):
     url=urlsplit(route.request.url)
     if url.hostname=='o.alicdn.com':
      sdk_loads.append(url.path)
      return route.fulfill(content_type='text/javascript',body=SDK)
     if url.hostname!='localhost':return route.abort()
     if url.path.startswith('/api/'):
      data={};status=200
      if url.path=='/api/auth/verification-options':data={'captchaEnabled':True,'captchaProvider':'aliyun','captchaRegion':'cn','captchaPrefix':'synthetic-prefix','captchaSceneId':'synthetic-scene','sms':True,'smsMode':'live'}
      elif url.path=='/api/settings':data={'accountModel':'accounts','settings':[]}
      elif url.path=='/api/card-groups':data={'groups':[]}
      elif url.path in ['/api/auth/sms/send','/api/auth/login']:
       body=json.loads(route.request.post_data);calls.append({'path':url.path,'body':body})
       assert body['captchaVerifyParam'].startswith('synthetic-proof-')
       assert 'captchaTicket' not in body
       status=400;data={'error':'测试业务拒绝，可重新验证'}
      return route.fulfill(status=status,content_type='application/json',body=json.dumps(data))
     if url.path.startswith('/admin/') or url.path.startswith('/enterprise/'):
      prefix='admin' if url.path.startswith('/admin/') else 'enterprise'
      dist=ROOT/('admin-web' if prefix=='admin' else 'enterprise-panel')/'dist'
      target=dist/url.path.removeprefix('/'+prefix+'/')
      if not target.is_file():target=dist/'index.html'
     elif url.path.startswith('/shared/browser/'):target=ROOT/url.path.lstrip('/')
     else:
      target=ROOT/'public'/url.path.lstrip('/')
      if target.is_dir():target=target/'index.html'
     if not target.is_file():return route.fulfill(status=404,body='')
     mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'}.get(target.suffix,'application/octet-stream')
     return route.fulfill(content_type=mime,body=target.read_bytes())
    context.route('**/*',route_request)
    page.goto('http://localhost'+path)
    if kind in ['admin','enterprise']:
     phone='input[placeholder="请输入手机号"]'
     if mode=='sms':page.get_by_text('短信验证',exact=True).click();trigger=page.get_by_role('button',name='发送验证码',exact=True)
     else:
      page.locator('input[placeholder="请输入密码"]').fill('SyntheticPassword!')
      trigger=page.get_by_role('button',name='登 录',exact=True)
    elif kind=='player':
     page.locator('#enter').click();phone='[name=phone]'
     if mode=='sms':page.locator('#auth-sms').click();trigger=page.locator('#send-code')
     else:page.locator('[name=password]').fill('SyntheticPassword!');trigger=page.locator('#auth-form .primary')
    else:
     phone='#phone';trigger=page.locator('#send-sms' if kind=='register' else '#send-code-btn')
    page.locator(phone).fill('16600000940')
    # Exercise the SDK error recovery through the actual login/send button.
    page.evaluate("() => {window.__aliyunMode='error'}")
    trigger.click();expect(page.get_by_text('人机验证服务暂不可用，请重试',exact=True)).to_be_visible()
    assert not calls
    page.evaluate("() => {window.__aliyunMode='success'}")
    for attempt in range(2):
     expect(trigger).to_be_enabled();trigger.click()
     expect(page.get_by_role('button',name='完成测试验证')).to_be_visible()
     assert len(calls)==attempt,'No business API before challenge callback'
     page.get_by_role('button',name='完成测试验证').click()
     expect(page.get_by_text('测试业务拒绝，可重新验证',exact=True)).to_be_visible()
     expect(trigger).to_be_enabled()
     assert len(calls)==attempt+1
    assert calls[0]['body']['captchaVerifyParam']!=calls[1]['body']['captchaVerifyParam']
    assert len(sdk_loads)==1
    assert not errors,errors
    print(json.dumps({'entry':kind,'method':mode,'sdkErrorRecovered':True,'freshProofs':True,'pageErrors':errors}))
    context.close()
  finally:browser.close()

if __name__=='__main__':main()
