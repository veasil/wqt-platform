"""One real story call proves environment defaults work without writing DB defaults."""
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
 assert session
 response=client.post(BASE+'/api/llm/story',headers=headers,data={'sessionId':session['id'],'prompt':'请用一句适合青少年的温暖中文说明：先放下手机，与家人交流。','max_tokens':200},timeout=45000)
 assert response.ok,response.status
 data=response.json();assert data.get('story')
 print('REAL_STORY_DEPLOYMENT_DEFAULTS_PASS',{'status':response.status,'textLength':len(data['story'])})
 browser.close()
