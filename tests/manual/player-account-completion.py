from pathlib import Path
from uuid import uuid4
from playwright.sync_api import sync_playwright
OUT=Path('C:/ArdenDev/tmp/wqt-player-account-completion');OUT.mkdir(parents=True,exist_ok=True)
BASE='http://127.0.0.1:8188'
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=browser.new_page(viewport={'width':1440,'height':1000})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(BASE+'/player/');page.locator('#enter').click();page.locator('[name=phone]').fill('16600000889');page.locator('[name=password]').fill('PlayerUat2026!');page.locator('#auth-form .primary').click();page.locator('.account-choice').first.wait_for();page.locator('.account-choice').first.click();page.locator('#player-content[data-view=game],#player-content[data-view=activities]').wait_for()
 def api(path,body=None,token=None):
  token=token or page.evaluate("() => localStorage.getItem('WQT_AUTH_TOKEN')")
  headers={'Authorization':'Bearer '+token};r=page.request.post(BASE+path,data=body,headers=headers) if body is not None else page.request.get(BASE+path,headers=headers)
  assert r.ok,(path,r.status,r.text())
  return r.json()
 before=api('/api/auth/session')['session']
 if page.locator('[name=code]').count():
  page.locator('[name=code]').fill('WQTUAT');page.locator('#code-form .primary').click();page.locator('#select-activity').click();page.locator('#config-form .primary').click()
 page.locator('#pick').wait_for()
 original=api('/api/game/last-session')['session']['id']
 page.reload();page.locator('#pick').wait_for();assert api('/api/auth/session')['session']==before
 page.goto('about:blank');page.go_back();page.locator('#pick').wait_for();assert api('/api/auth/session')['session']==before
 page.locator('#nav-me').click();page.locator('#switch-account').wait_for();page.locator('#switch-account').click();page.locator('.account-switcher').wait_for();assert page.locator('.current-account-badge').count()==1
 options=page.locator('.account-switcher [data-account]');ids=[int(options.nth(i).get_attribute('data-account')) for i in range(options.count())]
 page.mouse.move(0,0);page.locator('.account-switcher').screenshot(path=str(OUT/'completed-switcher.png'));page.screenshot(path=str(OUT/'switcher-dark.png'));options.nth(1).click();page.wait_for_function('(id)=>JSON.parse(localStorage.getItem("WQT_USER_CACHE")||"{}").accountId===id',arg=ids[1]);page.locator('.profile-grid').wait_for();assert api('/api/auth/session')['user']['accountId']==ids[1]
 assert api('/api/auth/session')['session']==before
 boss_token=page.evaluate("() => localStorage.getItem('WQT_AUTH_TOKEN')")
 free_auth=api('/api/auth/select-account',{'accountId':ids[2]},boss_token)['token']
 free_rights=api('/api/me/entitlements',token=free_auth)
 if not free_rights['experience']['active']:
  grant=api('/api/admin/trials/activate',{'requestId':str(uuid4()),'accountId':ids[2],'reason':'合成验收：平台开通待激活权益'},boss_token);assert grant['trialStatus']=='pending_activation'
 page.locator('#switch-account').click();page.locator('.account-switcher [data-account]').nth(2).click();page.wait_for_function('(id)=>JSON.parse(localStorage.getItem("WQT_USER_CACHE")||"{}").accountId===id',arg=ids[2]);page.locator('.profile-grid').wait_for();page.locator('#entitlements').click()
 if not free_rights['experience']['active']:
  page.locator('#activate-trial').wait_for();assert api('/api/me/entitlements')['capabilities']['startGame']==False;page.screenshot(path=str(OUT/'entitlements-pending.png'));page.locator('#activate-trial').click()
 page.get_by_role('heading',name='体验中',exact=True).wait_for();rights=api('/api/me/entitlements');assert rights['experience']['until']-rights['experience']['startedAt']==30*86400000;assert rights['capabilities']['startGame'];assert not page.locator('#activate-trial').count();page.screenshot(path=str(OUT/'entitlements-active.png'))
 page.reload();page.locator('[name=code]').wait_for();assert api('/api/auth/session')['user']['accountId']==ids[2];assert api('/api/auth/session')['session']==before
 page.locator('#nav-me').click();page.locator('#switch-account').click();page.locator('.account-switcher [data-account]').first.click();page.wait_for_function('(id)=>JSON.parse(localStorage.getItem("WQT_USER_CACHE")||"{}").accountId===id',arg=ids[0]);page.locator('.profile-grid').wait_for();assert api('/api/game/last-session')['session']['id']==original
 for tab in ['profile','study','activities','history','files','feedback']:
  page.locator('[data-tab='+tab+']').click();page.locator('#account-content[data-ready="true"]').wait_for();assert page.locator('a[href*="my.html"]').count()==0
 page.locator('[data-tab=profile]').click();page.locator('#login-session').click();page.get_by_role('heading',name='当前登录会话',exact=True).wait_for();page.screenshot(path=str(OUT/'login-session.png'));page.locator('#dialog-close').click()
 page.locator('#theme-toggle').click();page.locator('#switch-account').click();page.screenshot(path=str(OUT/'switcher-light.png'));page.set_viewport_size({'width':390,'height':844});assert page.evaluate('() => document.documentElement.scrollWidth <= innerWidth');page.screenshot(path=str(OUT/'switcher-mobile.png'),full_page=True)
 assert not errors,errors;browser.close();print('ACCOUNT_RESTORE_SWITCH_TRIAL_BROWSER_PASS')
