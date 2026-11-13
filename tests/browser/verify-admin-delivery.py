"""Platform delivery contracts using synthetic HTTP only; no DB, SMS or external traffic."""
import json
import os
import re
import subprocess
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[2]
env = {k: v for k, v in os.environ.items() if k.lower() in {'path','systemroot','windir','temp','tmp','pathext'}}
env['NODE_ENV'] = 'test'
if os.getenv('WQT_BROWSER_ADMIN_DIST'): env['WQT_BROWSER_ADMIN_DIST']=os.environ['WQT_BROWSER_ADMIN_DIST']
server = subprocess.Popen(['node','tests/browser/static-server.mjs'], cwd=root, env=env,
    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
try:
    line = server.stdout.readline()
    if not line:
        raise RuntimeError(server.stderr.read())
    base = f"http://127.0.0.1:{json.loads(line)['port']}"
    # The Windows pipe buffer is small; drain static-server request logs so a
    # second browser context cannot stall the server while loading its assets.
    def drain(stream):
        for _ in stream:
            pass
    for stream in (server.stdout,server.stderr):
        threading.Thread(target=drain,args=(stream,),daemon=True).start()
    until = 1924992000000
    identities = [{'id':1,'phone':'13800000001','guardian_name':'平台测试','real_name':'测试甲','status':'active','watcher_level':'initial'},
                  {'id':2,'phone':'13800000002','guardian_name':'新使用者','real_name':'测试乙','status':'active','watcher_level':'initial'}]
    choices = [{'id':11,'name':'平台管理A','organization_id':1,'organization_name':'测试公司','role':'boss'},
               {'id':12,'name':'平台管理B','organization_id':2,'organization_name':'另一公司','role':'boss'},
               {'id':13,'name':'普通账号','organization_id':0,'organization_name':'免费组织','role':'watcher'}]
    orgs = [{'id':0,'name':'免费组织','status':'active','current_members':1},
            {'id':1,'name':'测试公司','status':'active','current_members':1},
            {'id':3,'name':'次数已用完组织','status':'active','plan':'group','subscription_id':3,'account_count':5,'current_members':1,'subscription_until':until,'rebind_count':2}]
    accounts = [{'id':11,'name':'平台管理A','organization_id':1,'role':'boss','status':'active','identity_id':1,'guardian_name':'平台测试','phone':'13800000001'},
                {'id':22,'name':'免费守望者','organization_id':0,'role':'watcher','status':'active','identity_id':2,'guardian_name':'新使用者','phone':'13800000002'},
                {'id':30,'name':'已用完账号','organization_id':3,'role':'watcher','status':'active','identity_id':1,'subscription_id':3}]
    requests, committed = [], {}
    state = {'lost':True,'meStatus':200,'role':'boss'}
    def user(account_id=11):
        return {'id':1,'identityId':1,'accountId':account_id,'role':state['role'],'guardianName':'平台测试','phone':'13800000001','enterpriseId':1}
    def snapshot():
        fixture_accounts=[]
        for a in accounts:
            org=next(o for o in orgs if o['id']==a['organization_id'])
            paid=a['id']>=30
            trial=a['identity_id']==2 and bool(state.get('trialUntil'))
            fixture_accounts.append({**a,'organization_name':org['name'],'organization_status':'active','identity_status':'active','available':True,'paid_valid':paid,'trial_valid':trial,'trial_pending':a['identity_id']==2 and bool(state.get('trialGrantedAt')) and not trial,
                'entitlement':'有权益' if paid else '体验中' if trial else '免费','entitlement_until':until if paid else state.get('trialUntil') if trial else None})
        users=[{**identities[0],'accounts':[a for a in fixture_accounts if a['identity_id']==1],'categories':['entitled','platform_admin'],'online':True},
               {**identities[1],'accounts':[a for a in fixture_accounts if a['identity_id']==2],'categories':['trial'] if state.get('trialUntil') else ['free'],'trial_until':state.get('trialUntil'),'trial_granted_at':state.get('trialGrantedAt'),'trial_grant_consumed_at':state.get('trialGrantedAt') if state.get('trialUntil') else None,'online':False}]
        fixture_orgs=[{**o,'bound_accounts':len([a for a in accounts if a['organization_id']==o['id'] and a.get('identity_id')]),'user_count':1,'online_users':0,'entitled':bool(o.get('subscription_id')),'location':o.get('location'),'total_sessions':0,'active_sessions':0,'avg_score':None} for o in orgs]
        users.append({'id':3,'phone':'13800000003','guardian_name':'未绑定用户','real_name':'测试丙','status':'active','accounts':[],'categories':['free'],'online':False})
        return {'accounts':fixture_accounts,'users':users,'organizations':fixture_orgs,'stats':{'entitledOrganizations':2,'totalUsers':2,'onlineUsers':1}}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        def intercept(route):
            req = route.request
            if not req.url.startswith(base):
                route.abort(); return
            path = req.url[len(base):].split('?')[0]
            if not path.startswith('/api/'):
                route.continue_(); return
            status, data = 200, {}
            if path == '/api/settings': data={'settings':[], 'accountModel':'legacy' if state.get('legacy') else 'accounts'}
            elif path == '/api/auth/login':
                data = {'token':'legacy-fixture','user':{'id':1,'role':'operator','guardianName':'旧模型运营'}} if state.get('legacy') else {'token':'identity-fixture','user':user(None),'accounts':choices,'requiresAccountSelection':True}
            elif path == '/api/auth/accounts': data = {'accounts':[] if state.get('emptyAccounts') else choices}
            elif path == '/api/auth/select-account':
                body = req.post_data_json; data = {'token':f"account-{body['accountId']}",'user':user(body['accountId'])}
            elif path == '/api/me':
                status = state['meStatus']
                account_id = 12 if req.headers.get('authorization') == 'Bearer account-12' else 11
                data = {'user':user(account_id)} if status == 200 else {'error':'会话服务暂不可用'}
                if state.get('legacy'): data={'user':{'id':1,'role':'operator','guardianName':'旧模型运营'}}
            elif path == '/api/admin/operations-snapshot': data=snapshot()
            elif path.startswith('/api/admin/organizations/') and req.method=='GET':
                oid=int(path.rsplit('/',1)[1]);snap=snapshot();data={'organization':next(o for o in snap['organizations'] if o['id']==oid),'accounts':[a for a in snap['accounts'] if a['organization_id']==oid],'users':snap['users']}
            elif path == '/api/admin/trials/activate':
                requests.append((path,req.post_data_json));state['trialGrantedAt']=1800000000000;data={'ok':True,'identityId':2,'trialGrantedAt':state['trialGrantedAt']}
            elif path == '/api/admin/invite-codes':
                if req.method=='POST':
                    requests.append((path,req.post_data_json));data={'ok':True,'code':'INVTEST1'};state['invited']=True
                else: data={'codes':[{'code':'INVTEST1','organization_id':4,'org_name':'合成小组','used_count':0,'max_uses':1,'expires_at':until,'status':'active'}] if state.get('invited') else []}
            elif path == '/api/admin/settings':
                if req.method=='PUT': requests.append((path,req.post_data_json));data={'ok':True}
                else: data={'settings':[{'key':'DEFAULT_GAME_TIME','value':'5000','description':'游戏时长','editable':True,'sensitive':False},{'key':'FIXTURE_SECRET','value':None,'configured':True,'editable':True,'sensitive':True}]}
            elif path == '/api/admin/operators': data={'operators':[]}
            elif path == '/api/admin/accounts': data = {'accounts':accounts}
            elif path == '/api/admin/identities': data = {'identities':identities}
            elif path == '/api/admin/organizations': data = {'organizations':orgs}
            elif path == '/api/admin/account-operations': data = {'operations':[]}
            elif path == '/api/admin/stats/overview': data = {'totalUsers':2,'totalAccounts':len(accounts),'totalOrgs':len(orgs),'totalSessions':0,'usersByRole':[],'sessionsByStatus':[],'dailySignups':[],'dailySessions':[]}
            elif path in ['/api/admin/subscriptions','/api/admin/subscriptions/renew','/api/admin/account-bindings']:
                body = req.post_data_json; requests.append((path,body))
                rid = body['requestId']
                if rid in committed: data = committed[rid]
                elif path == '/api/admin/subscriptions':
                    count = {'personal':1,'group':5,'city':20}[body['plan']]
                    data = {'ok':True,'organizationId':4,'subscriptionId':4,'accountIds':list(range(40,40+count)),'validUntil':until}
                    orgs.append({'id':4,'name':body['organizationName'],'status':'active','plan':body['plan'],'subscription_id':4,'account_count':count,'current_members':count,'subscription_until':until,'rebind_count':0})
                    accounts.extend([{'id':i,'name':f"交付账号{i}",'organization_id':4,'subscription_id':4,'role':'watcher','status':'active','identity_id':None} for i in data['accountIds']])
                    committed[rid] = data
                    if state['lost']: status=503;data={'error':'响应中断，结果未知'};state['lost']=False
                elif path == '/api/admin/subscriptions/renew':
                    data = {'ok':True,'validUntil':until+31536000000,'rebindCount':0};committed[rid]=data
                else:
                    target = next(a for a in accounts if a['id']==body['accountId'])
                    target.update({'identity_id':body['identityId'],'guardian_name':'新使用者','phone':'13800000002'})
                    data={'ok':True,'accountId':target['id'],'changed':True,'rebindCount':0};committed[rid]=data
            route.fulfill(status=status,content_type='application/json',body=json.dumps(data))
        context.route('**/*',intercept)
        page=context.new_page(); errors=[]
        page.on('pageerror',lambda e: errors.append(str(e)))
        page.goto(base+'/admin/login');page.wait_for_load_state('networkidle')
        page.get_by_placeholder('请输入手机号').fill('13800000001')
        page.get_by_placeholder('请输入密码').fill('fixture-password')
        page.get_by_role('button',name=re.compile(r'^登\s*录$')).click()
        expect(page.get_by_role('heading',name='选择本次使用的账号')).to_be_visible()
        expect(page.get_by_role('button',name=re.compile('普通账号'))).to_be_enabled()
        expect(page.get_by_role('button',name=re.compile('新增组织或账号'))).to_be_visible()
        picker=page.get_by_role('dialog',name='选择本次使用的账号')
        picker_height=picker.bounding_box()['height']
        page.get_by_role('button',name=re.compile('新增组织或账号')).click()
        expect(picker).not_to_be_visible()
        join=page.get_by_role('dialog',name='新增组织或账号',exact=True)
        expect(join).to_be_visible()
        join.get_by_role('button',name='返回账号列表').click()
        expect(picker).to_be_visible()
        assert abs(picker.bounding_box()['height']-picker_height)<2
        page.get_by_role('button',name=re.compile('平台管理A')).click()
        expect(page.get_by_role('heading',name='驾驶舱')).to_be_visible()
        page.goto(base+'/admin/users')
        expect(page.get_by_role('heading',name='组织与权益')).to_be_visible()
        expect(page).to_have_url(re.compile('/admin/accounts$'))
        expect(page.get_by_role('menuitem',name='游戏分析')).to_have_count(0)
        expect(page.get_by_role('menuitem',name='数据审计')).to_have_count(0)
        expect(page.get_by_role('menuitem',name='复盘测试')).to_have_count(0)
        page.wait_for_load_state('networkidle')
        page.get_by_role('tab',name='用户',exact=True).click()
        expect(page.locator('.el-table__expand-icon')).to_have_count(0)
        unbound=page.get_by_role('row').filter(has_text='未绑定用户')
        expect(unbound.get_by_text('暂无绑定账号',exact=True)).to_be_visible()
        expect(unbound.get_by_role('button',name=re.compile('查看.*个账号'))).to_have_count(0)
        page.get_by_role('row').filter(has_text='新使用者').get_by_role('button',name='查看 1 个账号').click()
        details=page.get_by_role('dialog',name='绑定的守望者账号')
        expect(details).to_be_visible()
        details.locator('.el-dialog__headerbtn').click()
        expect(details).not_to_be_visible()
        page.locator('.el-radio-group').get_by_text('免费用户',exact=True).click()
        row=page.get_by_role('row').filter(has_text='新使用者')
        row.get_by_role('button',name='开通体验权益').click()
        trial_dialog=page.get_by_role('dialog',name='开通体验权益')
        trial_dialog.locator('textarea').fill('合成测试：开通后由本人另行激活')
        trial_dialog.get_by_role('button',name='开通体验权益').click()
        expect(trial_dialog).not_to_be_visible()
        expect(row.get_by_role('button',name='体验待激活')).to_be_disabled()
        assert not state.get('trialUntil'), 'Platform grant must not start the user trial clock'
        assert requests[-1][1]['reason']=='合成测试：开通后由本人另行激活'
        # Simulate a later, separate user activation before testing the active filter.
        state['trialUntil']=1920000000000
        page.reload();page.get_by_role('tab',name='用户',exact=True).click()
        page.locator('.el-radio-group').get_by_text('体验中用户',exact=True).click()
        expect(page.get_by_role('row').filter(has_text='新使用者')).to_be_visible()
        page.get_by_role('tab',name='组织与权益',exact=True).click()
        page.get_by_role('button',name='新建组织权益').click()
        dialog=page.get_by_role('dialog',name='新建组织权益')
        dialog.locator('input').first.fill('合成小组')
        dialog.locator('.el-select').click()
        page.get_by_role('option',name='团队合伙人 · 5个账号').click()
        expect(dialog.get_by_text(re.compile('5个守望者账号'))).to_be_visible()
        dialog.get_by_role('button',name='交付组织与账号').click()
        expect(page.get_by_role('button',name='重试原操作')).to_be_visible()
        page.reload();page.wait_for_load_state('networkidle')
        page.get_by_role('button',name='重试原操作').click()
        receipt=page.get_by_role('dialog',name='交付已完成')
        expect(receipt.get_by_text(re.compile('已生成 5 个账号'))).to_be_visible()
        delivery_requests=[b for path,b in requests if path=='/api/admin/subscriptions']
        assert len(delivery_requests)==2 and delivery_requests[0]==delivery_requests[1]
        assert len([o for o in orgs if o['id']==4])==1
        receipt.get_by_role('button',name='继续绑定使用者').click()
        expect(page.get_by_role('tab',name='守望者账号')).to_have_attribute('aria-selected','true')
        page.get_by_role('button',name='首次绑定').first.click()
        binding=page.get_by_role('dialog',name='首次绑定')
        expect(binding.get_by_text('首次绑定不消耗权益换绑次数。')).to_be_visible()
        binding.locator('.el-select').click()
        page.get_by_role('option',name='新使用者 · 13800000002').click()
        binding.get_by_role('button',name='确认绑定').click()
        expect(binding).not_to_be_visible()
        page.get_by_role('tab',name='组织与权益').click()
        row=page.get_by_role('row').filter(has_text='合成小组')
        row.get_by_role('button',name='续费一年').click()
        renewal=page.get_by_role('dialog',name='续费一年')
        expect(renewal.get_by_text(re.compile('预计续费后'))).to_be_visible()
        expect(renewal.get_by_text(re.compile('不重置'))).to_be_visible()
        renewal.get_by_role('button',name='确认续费一年').click()
        expect(renewal).not_to_be_visible()
        page.get_by_role('row').filter(has_text='合成小组').get_by_role('button',name='组织详情').click()
        expect(page.get_by_role('heading',name='合成小组',exact=True)).to_be_visible()
        page.get_by_role('tab',name='邀请码',exact=True).click()
        page.get_by_role('button',name='生成邀请码',exact=True).click()
        invite_dialog=page.get_by_role('dialog',name='生成组织邀请码')
        invite_dialog.get_by_role('button',name='生成邀请码',exact=True).click()
        expect(invite_dialog).not_to_be_visible()
        expect(page.get_by_text('INVTEST1',exact=True)).to_be_visible()
        assert next(b for path,b in requests if path=='/api/admin/invite-codes')['organizationId']==4
        page.get_by_role('button',name='返回组织与权益').click()
        page.get_by_role('menuitem',name='系统设置',exact=True).click()
        page.get_by_role('row').filter(has_text='DEFAULT_GAME_TIME').get_by_role('button',name='编辑').click()
        setting_dialog=page.get_by_role('dialog',name='编辑 DEFAULT_GAME_TIME')
        setting_dialog.get_by_role('textbox').nth(1).fill('6000')
        setting_dialog.get_by_role('button',name='保存',exact=True).click()
        expect(setting_dialog).not_to_be_visible()
        assert next(b for path,b in requests if path=='/api/admin/settings')['requestId']
        page.get_by_role('menuitem',name='组织与权益',exact=True).click()
        page.get_by_role('tab',name='守望者账号').click()
        page.locator('.toolbar .el-select').filter(has_text='所有组织').click()
        page.get_by_role('option',name='次数已用完组织').click()
        expect(page.get_by_role('button',name='换绑',exact=True)).to_be_disabled()
        page.get_by_role('button',name='刷新数据').click()
        page.wait_for_load_state('networkidle')
        # Inspect at mobile width; the dialog remains inside the viewport.
        page.set_viewport_size({'width':390,'height':844})
        page.get_by_role('button',name='打开导航').click()
        page.get_by_role('menuitem',name='组织与权益',exact=True).click()
        expect(page.locator('.el-overlay:visible')).to_have_count(0)
        page.get_by_role('tab',name='组织与权益').click()
        page.get_by_role('button',name='新建组织权益').click()
        mobile_dialog=page.get_by_role('dialog',name='新建组织权益')
        box=mobile_dialog.bounding_box();assert box['x']>=0 and box['x']+box['width']<=391
        mobile_dialog.get_by_role('button',name='取消').click()
        expect(page.locator('.el-overlay:visible')).to_have_count(0)
        if os.getenv('WQT_UI_SCREENSHOT_DIR'):
            expect(page.locator('.el-message:visible')).to_have_count(0)
            out=Path(os.environ['WQT_UI_SCREENSHOT_DIR']);out.mkdir(parents=True,exist_ok=True)
            page.screenshot(path=str(out/'admin-mobile.png'),full_page=True)
            page.set_viewport_size({'width':1440,'height':1000});page.screenshot(path=str(out/'admin-delivery.png'),full_page=True)
        page.get_by_role('button',name='切换账号').click()
        expect(page.get_by_role('heading',name='选择本次使用的账号')).to_be_visible()
        page.get_by_role('button',name=re.compile('平台管理B')).click()
        expect(page.get_by_role('heading',name='驾驶舱')).to_be_visible()
        assert page.evaluate("JSON.parse(localStorage.getItem('aw_user')).accountId")==12
        state['meStatus']=503
        page.goto(base+'/admin/accounts')
        expect(page.get_by_role('heading',name='平台管理暂不可用')).to_be_visible()
        assert page.evaluate("localStorage.getItem('aw_token')")=='account-12'
        state['meStatus']=200;state['role']='operator'
        page.get_by_role('button',name='重新检查').click()
        expect(page.get_by_text(re.compile('运营角色仍保留'))).to_be_visible()
        state['emptyAccounts']=True
        page.get_by_role('button',name='选择其他账号').click()
        expect(page.get_by_role('button',name=re.compile('新增组织或账号'))).to_be_visible()
        # The accounts-model rollout must not silently change the legacy operator login.
        state['legacy']=True
        legacy=browser.new_context();legacy.route('**/*',intercept)
        legacy_page=legacy.new_page();legacy_page.on('pageerror',lambda e: errors.append(str(e)))
        legacy_page.goto(base+'/admin/login')
        legacy_page.get_by_placeholder('请输入手机号').fill('13800000001')
        legacy_page.get_by_placeholder('请输入密码').fill('fixture-password')
        legacy_page.get_by_placeholder('请输入短信验证码').fill('123456')
        legacy_page.get_by_role('button',name=re.compile(r'^登\s*录$')).click()
        expect(legacy_page.get_by_role('heading',name='驾驶舱')).to_be_visible()
        expect(legacy_page.get_by_text('近14天新增用户',exact=True)).to_be_visible()
        legacy.close()
        assert not errors,errors
        browser.close()
    print('ADMIN_DELIVERY_CONTRACTS_PASSED: login, account choice, legacy route guard, delivery retry after reload, first binding, annual renewal, mobile, 503 and operator denial')
finally:
    server.terminate()
    try: server.wait(timeout=10)
    except subprocess.TimeoutExpired: server.kill();server.wait(timeout=5)
