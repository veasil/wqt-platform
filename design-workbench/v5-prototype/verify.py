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
    assert page.get_by_text('守望者工作台', exact=True).is_visible()
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
    click('picker')
    shot('05-picker')
    page.locator('[data-action^="pick:"]').first.click()
    click('choice:2')
    shot('06-feedback')
    click('finish')
    assert page.evaluate('state.history.length') == 1
    click('pause')
    click('pause')
    click('stop')
    click('end')
    assert page.evaluate('state.ended')
    assert page.locator('[data-action="pause"]').count() == 0
    assert page.get_by_text('既有复盘链路', exact=True).is_visible()
    first_id = page.evaluate('state.sessionId')
    click('home')
    click('new-game')
    click('activity:1')
    click('next')
    assert page.evaluate('state.counts') == [5,5,5]
    click('start')
    assert page.evaluate('state.history.length') == 0
    assert page.evaluate('state.remaining') > 4900
    assert page.evaluate('state.sessionId') != first_id
    assert '守望师' not in page.locator('body').inner_text()
    result={'flow':'login → activity → config → game → picker → choice → pause/resume → end', 'pageErrors':errors, 'externalRequests':remote, 'viewport':'1440x900', 'visualAcceptance':'pending; see README known issues'}
    (out/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8',newline='\n')
    browser.close()
    assert not errors, errors
    assert not remote, remote
    print(json.dumps(result,ensure_ascii=False))
