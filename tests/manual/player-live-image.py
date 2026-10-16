"""One real image request, using only the owned local UAT synthetic identity."""
from playwright.sync_api import sync_playwright
BASE='http://127.0.0.1:8188'
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 client=browser.new_context().request
 login=client.post(BASE+'/api/auth/login',data={'phone':'16600000889','password':'PlayerUat2026!','verificationMethod':'password'})
 assert login.ok,login.status
 auth=login.json();paid=next(a for a in auth['accounts'] if a['role']=='watcher' and a['valid_until'])
 selected=client.post(BASE+'/api/auth/select-account',data={'accountId':paid['id']},headers={'Authorization':'Bearer '+auth['token']})
 assert selected.ok,selected.status
 headers={'Authorization':'Bearer '+selected.json()['token']}
 session=client.get(BASE+'/api/game/last-session',headers=headers).json()['session']
 assert session,'Complete the isolated account walkthrough first'
 response=client.post(BASE+'/api/llm/image',headers=headers,data={'sessionId':session['id'],'prompt':'温暖的儿童绘本插画：一家人在餐桌旁放下手机交流，柔和蓝色背景，没有文字，没有危险行为。','size':'1024*1024'},timeout=150000)
 data=response.json()
 if response.ok:
  assert data.get('dataUri','').startswith('data:image/'), 'Missing actual generated image bytes'
  print('REAL_IMAGE_PASS',{'status':response.status,'provider':data.get('provider'),'model':data.get('model'),'imageBytes':len(data['dataUri'])})
 else:
  print('REAL_IMAGE_FAILED',{'status':response.status})
  raise AssertionError('Real image provider did not complete; inspect sanitized service logs')
 browser.close()
