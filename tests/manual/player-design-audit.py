from pathlib import Path
from playwright.sync_api import sync_playwright
import json
from uuid import uuid4
OUT=Path('C:/ArdenDev/tmp/wqt-player-design-audit');OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=browser.new_page(viewport={'width':1440,'height':900})
 def capture(name):
  page.wait_for_load_state('networkidle')
  if page.locator('#account-content').count():
   page.locator('#account-content[data-ready="true"]').wait_for()
  page.screenshot(path=str(OUT/(name+'.png')),full_page=True)
 base='http://127.0.0.1:8188'
 def api(path,body=None,token=None):
  headers={'Authorization':'Bearer '+token} if token else {}
  res=page.request.post(base+path,data=body,headers=headers) if body is not None else page.request.get(base+path,headers=headers)
  assert res.ok, str(res.status)
  return res.json()
 login=api('/api/auth/login',{'phone':'16600000889','password':'PlayerUat2026!','verificationMethod':'password'})
 selected=api('/api/auth/select-account',{'accountId':login['accounts'][0]['id']},login['token']);token=selected['token']
 groups=api('/api/card-groups',token=token)['groups'];group=next(g for g in groups if g['is_default'])
 previous=api('/api/game/last-session',token=token).get('session')
 if previous and previous.get('player_state_json'):
  st=json.loads(previous['player_state_json'])
  if not st['ended']: api('/api/player/action',{'requestId':str(uuid4()),'sessionId':previous['id'],'revision':st['revision'],'action':'finish'},token)
 sample=api('/api/player/start',{'requestId':str(uuid4()),'activityCode':'WQTUAT','location':'本机反馈验收场次','cardGroupId':group['id'],'settings':{'duration':5000,'counts':[1,0,0]}},token)
 api('/api/player/action',{'requestId':str(uuid4()),'sessionId':sample['sessionId'],'revision':0,'action':'finish'},token)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(base+'/player/')
 capture('01-entry')
 page.locator('#enter').click();capture('02-login')
 page.locator('#auth-sms').click();capture('03-sms')
 page.locator('#auth-password').click();page.locator('[name=phone]').fill('16600000889');page.locator('[name=password]').fill('PlayerUat2026!');page.locator('#auth-form .primary').click();page.locator('.account-choice').first.wait_for();capture('04-accounts')
 for box in page.locator('.account-choice-icon').all():
  assert box.evaluate('(el) => el.scrollWidth <= el.clientWidth'), 'Account number overflows'
 page.locator('.account-choice').first.click();page.locator('#another').wait_for();capture('ended')
 page.locator('#another').click();capture('activities')
 page.locator('[name=code]').fill('WQTUAT');page.locator('#code-form .primary').click();page.locator('#select-activity').wait_for();capture('activity-result');page.locator('#select-activity').click();capture('configure')
 page.on('dialog',lambda d:d.accept());page.locator('#config-form .primary').click();page.locator('#pick').wait_for();capture('idle');capture('05-card')
 page.locator('#pick').click();capture('06-picker');page.locator('.card-tile').first.click()
 for skill in ['安全力','脑波力','实感力','创心力']:
  page.locator('[data-skill="'+skill+'"]').click();capture('skill-'+skill);page.locator('#dialog-close').click()
 page.locator('#record-button').click();capture('07-record');page.locator('#dialog-close').click()
 page.locator('#nav-watch').click();capture('08-watch')
 page.locator('#nav-me').click();page.locator('.profile-grid').wait_for();capture('09-profile')
 for tab in ['study','activities','history','files','feedback']:
  page.locator('[data-tab='+tab+']').click();page.wait_for_load_state('networkidle');capture('me-'+tab)
 page.locator('#nav-downloads').click();page.locator('#download-list .content-list').wait_for();capture('10-downloads')
 page.locator('#nav-me').click();page.locator('.profile-grid').wait_for()
 page.route('**/api/me/files',lambda r:r.fulfill(status=503,content_type='application/json',body=json.dumps({'error':'验收模拟：资料服务暂不可用'})))
 page.locator('[data-tab=files]').click();page.locator('#retry-content').wait_for();capture('files-error');page.unroute('**/api/me/files');page.locator('#retry-content').click();page.locator('#account-content[data-ready="true"]').wait_for()
 page.locator('[data-tab=profile]').click();page.locator('.profile-grid').wait_for();page.locator('#change-password').click();capture('11-password');page.locator('#dialog-close').click()
 page.locator('#theme-toggle').click();capture('12-profile-light')
 page.set_viewport_size({'width':390,'height':844});capture('13-profile-mobile')
 page.locator('#nav-game').click();page.locator('#pick').wait_for();assert page.locator('#skill-list').is_hidden();page.locator('#skill-fold').click();assert page.locator('#skill-list').is_visible();page.locator('#skill-fold').click();assert page.evaluate('() => document.documentElement.scrollWidth <= innerWidth');capture('14-game-mobile');page.locator('#pick').click();capture('15-picker-mobile');page.locator('#dialog-close').click()
 for width in [1920,1440,1280,1024,850,700,390,320]:
  page.set_viewport_size({'width':width,'height':900})
  assert page.evaluate('() => document.documentElement.scrollWidth <= innerWidth'), str(width)+' horizontal overflow'
  for button in page.locator('header .nav button').all():
   assert button.evaluate('(el) => {const range=document.createRange();range.selectNodeContents(el);return range.getClientRects().length===1}'), str(width)+' wrapped navigation'
  theme=page.locator('#theme-toggle').bounding_box();icon=page.locator('#theme-toggle svg').bounding_box()
  assert abs(theme['width']-theme['height'])<1
  assert abs(icon['x']+icon['width']/2-theme['x']-theme['width']/2)<1
  capture('responsive-'+str(width))
 assert not errors, errors
 browser.close()
 print('AUDIT_CAPTURED')
