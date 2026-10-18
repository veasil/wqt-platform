"""Exact-origin login handoff and editable organization rights. Synthetic HTTP only."""
import json,os,time
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2]
ADMIN='https://admin.ai5000days.com'
SCORING='https://scoring.ai5000days.com'

def main():
 with sync_playwright() as p:
  browser=p.chromium.launch(channel=os.environ.get('WQT_BROWSER_CHANNEL') or None,headless=True)
  try:
   for mode in ['handoff','missing','no-role','invalid','rights']:
    c=browser.new_context();page=c.new_page();calls=[];errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    user={'identityId':1,'accountId':11,'role':'boss','guardianName':'示例管理员'}
    accounts=[{'id':11,'role':'watcher' if mode=='no-role' else 'boss','name':'平台账号','status':'active','valid_until':2000000000000}]
    org={'id':77,'name':'示例组织','plan':'group','subscription_id':77,'account_count':5,'current_members':5,'bound_accounts':3,'subscription_until':2000000000000,'rebind_count':1,'status':'active'}
    if mode=='invalid':c.add_init_script("if(location.origin==='"+ADMIN+"')localStorage.setItem('aw_token','existing-admin-session')")
    if mode!='missing':c.add_init_script("if(location.origin==='"+SCORING+"')localStorage.setItem('WQT_AUTH_TOKEN','synthetic-session')")
    if mode=='rights':c.add_init_script("if(location.origin==='"+ADMIN+"'){localStorage.setItem('aw_token','synthetic-session');localStorage.setItem('aw_user',"+json.dumps(json.dumps(user))+" )}")
    def route(route):
     url=urlsplit(route.request.url)
     if url.hostname not in ['admin.ai5000days.com','scoring.ai5000days.com']:return route.abort()
     if url.path.startswith('/api/'):
      if mode=='invalid' and url.path=='/api/auth/session' and route.request.headers.get('authorization')=='Bearer synthetic-session':return route.fulfill(status=401,content_type='application/json',body=json.dumps({'error':'桌游登录已失效'}))
      calls.append({'path':url.path,'headers':route.request.headers,'body':route.request.post_data_json if route.request.post_data else None})
      data={'/api/settings':{'accountModel':'accounts','settings':[]},'/api/auth/verification-options':{'captchaEnabled':False},'/api/auth/session':{'user':user,'accounts':accounts,'session':{'expiresAt':2000000000000}},'/api/me':{'user':user},'/api/auth/accounts':{'accounts':accounts},'/api/admin/organizations/77':{'organization':org,'accounts':[],'users':[]}}.get(url.path,{})
      if url.path=='/api/admin/organizations/update-entitlements':
       body=route.request.post_data_json;org.update({'plan':body['plan'],'account_count':body['capacity'],'subscription_until':body['validUntil']});data={'ok':True}
      return route.fulfill(content_type='application/json',body=json.dumps(data))
     if url.path=='/player/admin-session.html':return route.fulfill(content_type='text/html',headers={'Content-Security-Policy':'frame-ancestors '+ADMIN},body=(ROOT/'public/player/admin-session.html').read_bytes())
     target=ROOT/'admin-web/dist'/url.path.removeprefix('/admin/')
     if not target.is_file():target=ROOT/'admin-web/dist/index.html'
     return route.fulfill(content_type={'.js':'text/javascript','.css':'text/css'}.get(target.suffix,'text/html'),body=target.read_bytes())
    c.route('**/*',route)
    if mode=='rights':
     page.goto(ADMIN+'/admin/organizations/77')
     page.get_by_role('button',name='调整组织权益',exact=True).click()
     dialog=page.get_by_role('dialog',name='调整组织权益',exact=True)
     dialog.locator('.el-select__wrapper').click();page.get_by_role('option',name='城市级',exact=True).click()
     dialog.get_by_role('spinbutton').fill('3')
     dialog.locator('textarea').fill('合成测试：保留账号并调整权益')
     dialog.get_by_role('button',name='保存权益',exact=True).click()
     expect(dialog).not_to_be_visible()
     updates=[x for x in calls if x['path']=='/api/admin/organizations/update-entitlements']
     assert len(updates)==1 and updates[0]['body']['capacity']==3 and updates[0]['body']['plan']=='city' and updates[0]['body']['requestId']
     expect(page.get_by_text('容量 3 · 已有账号 5',exact=False)).to_be_visible()
    else:
     page.goto(ADMIN+'/admin/login')
     page.get_by_role('button',name='沿用桌游端登录身份',exact=True).click()
     if mode=='handoff':
      expect(page.get_by_role('dialog',name='选择本次使用的账号')).to_be_visible()
      assert page.evaluate("localStorage.getItem('aw_token')")=='synthetic-session'
      assert any(x['path']=='/api/auth/session' and x['headers'].get('authorization')=='Bearer synthetic-session' for x in calls)
     elif mode=='missing':expect(page.get_by_text('桌游端尚未登录，请先在桌游端登录',exact=True)).to_be_visible()
     elif mode=='invalid':
      expect(page.get_by_text('桌游登录已失效',exact=True)).to_be_visible()
      assert page.evaluate("localStorage.getItem('aw_token')")=='existing-admin-session'
     else:expect(page.get_by_text('当前桌游身份没有可用的平台管理账号',exact=True)).to_be_visible()
     assert not any(x['path']=='/api/auth/login' for x in calls)
     if mode not in ['handoff','invalid']:assert not page.evaluate("localStorage.getItem('aw_token')")
    assert not errors,errors
    print(json.dumps({'mode':mode,'passed':True,'noNewLogin':True,'pageErrors':errors}));c.close()
  finally:browser.close()
if __name__=='__main__':main()
