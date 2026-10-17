"""Player boot failure/recovery and activity application. Synthetic HTTP only."""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[2]

def main():
 with sync_playwright() as p:
  browser=p.chromium.launch(channel=os.environ.get('WQT_BROWSER_CHANNEL') or None,headless=True)
  try:
   for mode in ['slow','failed','normal','application']:
    context=browser.new_context();page=context.new_page();page.clock.install()
    pending=[];calls=[];created=[];errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    user={'identityId':51,'accountId':61,'guardianName':'示例守望者','validityValid':True}
    accounts=[{'id':61,'name':'示例账号','organization_id':71,'organization_name':'示例组织','role':'watcher'}]
    if mode=='application':context.add_init_script("localStorage.setItem('WQT_AUTH_TOKEN','synthetic-token')")
    def intercept(route):
     url=urlsplit(route.request.url)
     if url.hostname!='localhost':return route.abort()
     if url.path.startswith('/api/'):
      data={
       '/api/auth/verification-options':{'captchaEnabled':False},
       '/api/auth/session':{'user':user,'accounts':accounts,'session':{},'requiresAccountSelection':False},
       '/api/me':{'user':user},'/api/settings':{'accountModel':'accounts','settings':[]},
       '/api/card-groups':{'groups':[]},'/api/player/feedback':{'pending':[]},
       '/api/game/last-session':{'session':None},'/api/me/activities':{'activities':[]},
       '/api/me/activities/created':{'activities':created},
      }.get(url.path,{})
      if url.path=='/api/activities/apply':
       body=json.loads(route.request.post_data);calls.append(body)
       created.append({'id':81,'name':body['name'],'activity_code':'ATEST','status':'pending'})
       data={'ok':True,'id':81,'status':'pending','activity_code':'ATEST'}
      return route.fulfill(content_type='application/json',body=json.dumps(data))
     target=ROOT/url.path.lstrip('/') if url.path.startswith('/shared/browser/') else ROOT/'public'/url.path.lstrip('/')
     if target.is_dir():target=target/'index.html'
     if not target.is_file():return route.fulfill(status=404,body='')
     if url.path=='/player/player.js':
      if mode=='slow':pending.append(route);return
      if mode=='failed':return route.abort()
     mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'}.get(target.suffix,'application/octet-stream')
     return route.fulfill(content_type=mime,body=target.read_bytes())
    context.route('**/*',intercept)
    page.goto('http://localhost/player/',wait_until='commit')
    if mode=='slow':
     expect(page.locator('#player-boot')).to_be_visible()
     page.clock.fast_forward(11000)
     expect(page.locator('#player-boot-status')).to_have_text('加载时间较长，你可以继续等待或重新加载。')
     expect(page.locator('#player-boot-retry')).to_be_visible()
     assert pending
     pending[0].fulfill(content_type='text/javascript',body=(ROOT/'public/player/player.js').read_bytes())
     expect(page.locator('#enter')).to_be_visible()
     page.clock.fast_forward(20000)
     expect(page.locator('#player-boot')).to_have_count(0)
    elif mode=='failed':
     expect(page.locator('#player-boot-status')).to_have_text('页面未能完成加载，请重新加载后再试。')
     expect(page.locator('#player-boot-retry')).to_be_visible()
     mode='normal'
     page.locator('#player-boot-retry').click()
     expect(page.locator('#enter')).to_be_visible()
    elif mode=='application':
     expect(page.locator('#code-form')).to_be_visible()
     page.locator('#nav-me').click();page.locator('[data-tab=activities]').click()
     page.locator('#create-activity').click()
     page.locator('#activity-apply-form [name=name]').fill('示例活动')
     page.locator('#activity-apply-form [name=location]').fill('示例地点')
     page.locator('#activity-apply-form [type=submit]').click()
     expect(page.get_by_text('待审核 · 活动码 ATEST',exact=True)).to_be_visible()
     assert len(calls)==1 and calls[0]['requestId']
     user['validityValid']=False
     page.locator('#dialog-close').click()
     page.locator('#create-activity').click()
     expect(page.get_by_text('当前账号无有效权益，暂不能申请活动。你仍可按账号权益使用活动码参与已有活动。',exact=True)).to_be_visible()
     assert len(calls)==1
    else:expect(page.locator('#enter')).to_be_visible()
    assert '非正式计分' not in page.locator('body').inner_text()
    assert not errors,errors
    print(json.dumps({'mode':mode,'passed':True,'pageErrors':errors}))
    context.close()
  finally:browser.close()

if __name__=='__main__':main()
