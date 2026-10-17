"""Login resend UI contracts. All HTTP requests are fixtures; no real SMS or database."""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
PHONE = '16600000940'

def main():
 with sync_playwright() as p:
  browser = p.chromium.launch(channel=os.environ.get('WQT_BROWSER_CHANNEL') or None, headless=True)
  try:
   for kind, path, button, field in [
    ('player','/player/','#send-code','[name=phone]'),
    ('admin','/admin/login','button:has-text("发送验证码")','input[placeholder="请输入手机号"]'),
    ('register','/register.html','#send-sms','#phone'),
    ('reset','/reset-password.html','#send-code-btn','#phone'),
   ]:
    context=browser.new_context();page=context.new_page();page.clock.install()
    calls=[];errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    def route_request(route):
     url=urlsplit(route.request.url)
     if url.hostname!='localhost': return route.abort()
     if url.path.startswith('/api/'):
      data={};status=200
      if url.path=='/api/auth/verification-options':data={'captchaEnabled':False,'sms':True,'smsMode':'mock'}
      elif url.path=='/api/settings':data={'accountModel':'accounts','settings':[]}
      elif url.path=='/api/card-groups':data={'groups':[]}
      elif url.path=='/api/auth/sms/send':
       calls.append(json.loads(route.request.post_data))
       if len(calls)==1:status=429;data={'code':'SMS_RESEND_COOLDOWN','retryAfterSeconds':3,'error':'请等待 3 秒后重试'}
       else:data={'ok':True,'resendAfterSeconds':5}
      return route.fulfill(status=status,content_type='application/json',body=json.dumps(data))
     if url.path.startswith('/admin/'):
      target=ROOT/'admin-web/dist'/url.path.removeprefix('/admin/')
      if not target.is_file():target=ROOT/'admin-web/dist/index.html'
     elif url.path.startswith('/shared/browser/'):
      target=ROOT/url.path.lstrip('/')
     else:
      target=ROOT/'public'/url.path.lstrip('/')
      if target.is_dir():target=target/'index.html'
     if not target.is_file():return route.fulfill(status=404,body='')
     mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'}.get(target.suffix,'application/octet-stream')
     return route.fulfill(content_type=mime,body=target.read_bytes())
    context.route('**/*',route_request)
    page.goto('http://localhost'+path)
    if kind=='player':page.locator('#enter').click();page.locator('#auth-sms').click()
    if kind=='admin':page.get_by_text('短信验证',exact=True).click()
    page.locator(field).fill(PHONE)
    page.locator(button).click()
    # Use the stable DOM element because its label changes throughout countdown.
    send=page.locator('#send-code' if kind=='player' else '#send-sms' if kind=='register' else '#send-code-btn' if kind=='reset' else '.el-form button').filter(has_text='3s' if kind=='admin' else '3秒')
    expect(send).to_be_disabled()
    assert len(calls)==1
    page.clock.fast_forward(1000)
    expect(page.get_by_text('请等待 2 秒后重试',exact=True)).to_be_visible()
    page.clock.fast_forward(2000)
    if kind=='admin':button='button:has-text("发送验证码")'
    else:button='#send-code' if kind=='player' else '#send-sms' if kind=='register' else '#send-code-btn'
    expect(page.locator(button)).to_be_enabled()
    assert page.get_by_text('请等待 2 秒后重试',exact=True).count()==0
    page.locator(button).click()
    page.wait_for_function("() => [...document.querySelectorAll('button')].some(b=>b.disabled && /5秒|5s/.test(b.textContent))")
    assert len(calls)==2
    page.clock.fast_forward(10000)
    expect(page.locator(button)).to_be_enabled()
    assert not errors,errors
    print(json.dumps({'entry':kind,'dynamic429':True,'successWait':True,'expiryUnlocked':True,'pageErrors':errors}))
    context.close()
  finally:browser.close()

if __name__=='__main__':main()
