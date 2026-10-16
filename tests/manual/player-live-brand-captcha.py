"""Owned UAT brand publication and actual SDK loading; no real captcha ticket claimed."""
from uuid import uuid4
import subprocess
from playwright.sync_api import sync_playwright
BASE='http://127.0.0.1:8188'
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=browser.new_page()
 client=page.request
 auth=client.post(BASE+'/api/auth/login',data={'phone':'16600000889','password':'PlayerUat2026!','verificationMethod':'password'}).json()
 boss=next(a for a in auth['accounts'] if a['role']=='boss')
 token=client.post(BASE+'/api/auth/select-account',data={'accountId':boss['id']},headers={'Authorization':'Bearer '+auth['token']}).json()['token']
 headers={'Authorization':'Bearer '+token}
 def publish(revision,image):
  import json
  response=client.put(BASE+'/api/admin/settings',headers=headers,data={'requestId':str(uuid4()),'key':'PLAYER_BRAND_RESOURCE','value':json.dumps({'revision':revision,'image':image,'title':'一起探索 · 一起守护','alt':'伍力全开'})})
  assert response.ok,response.status
 publish('uat-live-brand','/player/brand-references/boardgame-box-cover.jpg')
 try:
  page.goto(BASE+'/player/')
  page.locator('#brand-resource[data-revision="uat-live-brand"]').wait_for()
  assert 'revision=uat-live-brand' in page.locator('#brand-resource img').get_attribute('src')
  before=page.locator('#brand-resource img').get_attribute('src')
  publish('uat-invalid-brand','/player/nonexistent-brand-image.png')
  page.evaluate('() => window.dispatchEvent(new Event("focus"))')
  page.wait_for_timeout(500)
  assert page.locator('#brand-resource img').get_attribute('src')==before
  publish('uat-live-brand-2','/player/brand-references/product-logo.png')
  page.evaluate('() => window.dispatchEvent(new Event("focus"))')
  page.locator('#brand-resource[data-revision="uat-live-brand-2"]').wait_for()
  # Fresh createApp loads the edited headers without restarting the user's UAT again.
  # No runtime startup, database connection or migration is performed.
  server=subprocess.Popen(['node','--input-type=module','-e',"import {createApp} from './src/app.js';const server=createApp().listen(0,'127.0.0.1',()=>console.log('READY '+server.address().port));"],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
  try:
   port=int(server.stdout.readline().strip().split()[-1])
   sdk_page=browser.new_page()
   sdk_page.route('**/api/**',lambda route:route.fulfill(status=503,content_type='application/json',body='{}'))
   sdk_page.goto('http://127.0.0.1:'+str(port)+'/player/')
   header=client.get('http://127.0.0.1:'+str(port)+'/player/').headers['content-security-policy']
   assert 'https://turing.captcha.gtimg.com' in header and "frame-src 'self' https://turing.captcha.qcloud.com" in header
   sdk_page.add_script_tag(url='https://turing.captcha.qcloud.com/TCaptcha.js')
   assert sdk_page.evaluate('() => typeof window.TencentCaptcha === "function"')
  finally:
   server.terminate();server.wait(timeout=5)
  print('BRAND_PUBLICATION_FALLBACK_AND_REAL_CAPTCHA_SDK_PASS')
 finally:
  publish('default','/player/brand-references/product-logo.png')
  browser.close()
