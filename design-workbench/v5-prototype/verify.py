from pathlib import Path
import json
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent
out = root / 'validation'
out.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width':1440,'height':900}, device_scale_factor=1)
    errors, remote = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('request', lambda r: remote.append(r.url) if r.url.startswith(('http:', 'https:')) else None)
    page.goto((root / 'standalone-prototype.html').as_uri(), wait_until='networkidle')
    def shot(name):
        page.screenshot(path=str(out / (name+'.png')))
    def click(action):
        page.locator('[data-action="'+action+'"]').first.click()
    shot('01-login')
    page.locator('#phone').fill('13800000000')
    page.locator('#password').fill('demo123')
    click('verify')
    page.locator('#agree').check()
    click('login')
    assert page.locator('.sidebar').count() == 1
    assert page.get_by_text('守望者工作台', exact=True).count() == 0
    assert page.locator('[data-clock]').inner_text() == '— —'
    shot('00-game-unstarted')
    click('nav:1')
    assert page.locator('.sidebar').count() == 0
    shot('07-watch-unstarted')
    click('nav:0')
    click('new-game')
    click('wizard-close')
    assert page.locator('.sidebar').count() == 1
    click('new-game')
    assert page.locator('#activity-code').count() == 0
    assert page.locator('[data-action^="activity:"]').count() == 2
    click('activity:0')
    shot('02-activity')
    click('next')
    assert page.locator('#mode').count() == 0
    assert page.locator('[data-action="picker"]').count() == 0
    click('count:0:-1')
    assert page.locator('[data-action="start"]').is_disabled()
    click('count:1:1')
    assert page.locator('[data-action="start"]').is_enabled()
    shot('03-config')
    click('start')
    shot('04-game')
    session_id = page.evaluate('state.sessionId')
    width = page.locator('.main-area').bounding_box()['width']
    for i in range(3):
        click('side:'+str(i))
        assert page.locator('.rail-flyout').count() == 1
        assert page.locator('.main-area').bounding_box()['width'] == width
        shot('rail-'+str(i))
    click('record-demo')
    click('record-deny')
    assert '权限被拒绝' in page.locator('.rail-flyout').inner_text()
    click('record-demo')
    click('record-allow')
    click('record-demo')
    assert '已停止' in page.locator('.rail-flyout').inner_text()
    page.keyboard.press('Escape')
    assert page.locator('.rail-flyout').count() == 0
    click('picker')
    shot('05-picker')
    page.locator('[data-action^="pick:"]').first.click()
    click('choice:2')
    shot('06-feedback')
    click('nav:1')
    assert page.locator('.sidebar,.reader').count() == 0
    click('attribute:0:1')
    assert page.evaluate('state.attributes[0]') == 4
    page.locator('[data-attribute="1"]').fill('99')
    page.locator('[data-attribute="1"]').press('Tab')
    assert page.evaluate('state.attributes[1]') == 10
    shot('08-watch-active')
    control = page.locator('[data-action="export-session"]').bounding_box()
    assert control['y'] + control['height'] <= 900
    click('reset-attributes')
    click('confirm-reset')
    assert page.evaluate('state.attributes') == [3,3,3,3,3]
    with page.expect_download() as download:
        click('export-session')
    exported = json.loads(Path(download.value.path()).read_text(encoding='utf-8'))
    assert exported['sessionId'] == session_id
    click('nav:2')
    assert page.locator('.sidebar,.reader').count() == 0
    assert page.locator('.account-nav button').count() == 6
    click('edit-profile')
    page.locator('#display-name').fill('测试守望者')
    page.locator('[data-form="profile"] button').click()
    for i in range(6):
        click('account:'+str(i))
        shot('account-'+str(i))
    click('account:2')
    page.locator('#old-password').fill('demo123')
    page.locator('#new-password').fill('abcdef')
    page.locator('#confirm-password').fill('abcdefg')
    page.locator('[data-form="password"] button').click()
    assert '不一致' in page.locator('#password-message').inner_text()
    click('account:3')
    click('learn')
    click('learn-done')
    assert page.evaluate('state.learning')
    click('account:4')
    page.locator('#request-name').fill('测试活动')
    page.locator('#request-place').fill('测试地点')
    page.locator('[data-form="activity"] button').click()
    assert page.evaluate('state.applications.length') == 1
    page.locator('#lookup-code').fill('WQTAY')
    page.locator('[data-form="lookup"] button').click()
    assert '城市站' in page.locator('#lookup-result').inner_text()
    click('account:5')
    page.locator('#feedback-text').fill('原型验收反馈')
    page.locator('[data-form="feedback"] button').click()
    assert page.evaluate('state.feedbacks.length') == 1
    click('nav:0')
    assert page.evaluate('state.sessionId') == session_id
    assert page.evaluate('state.choice') == 2
    assert page.evaluate('state.card.code') == 'B01'
    click('finish')
    assert page.evaluate('state.history.length') == 1
    click('pause')
    click('pause')
    click('stop')
    click('end')
    assert page.evaluate('state.ended')
    assert page.locator('[data-action="pause"]').is_disabled()
    assert page.get_by_text('既有复盘链路', exact=True).is_visible()
    first_id = page.evaluate('state.sessionId')
    click('new-game')
    click('activity:1')
    click('next')
    assert page.evaluate('state.counts') == [5,5,5]
    click('start')
    assert page.evaluate('state.history.length') == 0
    assert page.evaluate('state.remaining') > 4900
    assert page.evaluate('state.sessionId') != first_id
    # Boundary fixture: final required card must retain its feedback after completion.
    page.evaluate("state.history = Array.from({length:14},(_,i)=>({code:'T'+i,choice:0,phase:0})); loadCard('B01')")
    click('choice:2')
    click('finish')
    assert page.evaluate('state.ended')
    assert page.locator('.feedback').count() == 1
    assert page.evaluate('state.history.length') == 15
    shot('09-final-feedback')
    assert '守望师' not in page.locator('body').inner_text()
    for tab in [0,1,2]:
        click('nav:'+str(tab))
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.set_viewport_size({'width':390,'height':844})
    click('account:0')
    shot('mobile-account')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    result={'flow':'login → direct game → setup → three rail panels → card → watch edits/export → six account tabs → same session → end → new session', 'pageErrors':errors, 'externalRequests':remote, 'viewport':'1440x900 and 390x844', 'visualAcceptance':'spec layout evidence captured; real services remain unconnected'}
    (out/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8',newline='\n')
    browser.close()
    assert not errors, errors
    assert not remote, remote
    print(json.dumps(result,ensure_ascii=False))
