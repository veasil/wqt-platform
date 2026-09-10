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
    page.locator('#activity-code').fill('WQTAY')
    click('check-code')
    click('activity:0')
    shot('02-activity')
    click('next')
    shot('03-config')
    click('start')
    shot('04-game')
    click('picker')
    shot('05-picker')
    page.locator('[data-action^="pick:"]').first.click()
    click('choice:2')
    shot('06-feedback')
    click('pause')
    click('pause')
    click('stop')
    click('end')
    result={'flow':'login → activity → config → game → picker → choice → pause/resume → end', 'pageErrors':errors, 'externalRequests':remote, 'viewport':'1440x900', 'visualAcceptance':'pending; see README known issues'}
    (out/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    browser.close()
    assert not errors, errors
    assert not remote, remote
    print(json.dumps(result,ensure_ascii=False))
