"""Run against the isolated player UAT only; never use the user's identity."""
from pathlib import Path
from uuid import uuid4
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8188'
OUT = Path('C:/ArdenDev/tmp/wqt-player-account-completion')
OUT.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE + '/player/')
    page.locator('#enter').click()
    page.locator('[name=phone]').fill('16600000889')
    page.locator('[name=password]').fill('PlayerUat2026!')
    page.locator('#auth-form .primary').click()
    page.locator('.account-add').wait_for()
    page.locator('[data-account]').first.click()
    page.locator('#player-content[data-view=game],#player-content[data-view=activities]').wait_for()
    page.locator('#nav-me').click()
    page.locator('#switch-account').click()
    page.locator('.account-switcher').wait_for()

    def api(path, body=None, token=None):
        token = token or page.evaluate("() => localStorage.getItem('WQT_AUTH_TOKEN')")
        headers = {'Authorization': 'Bearer ' + token}
        response = page.request.post(BASE + path, data=body, headers=headers) if body is not None else page.request.get(BASE + path, headers=headers)
        assert response.ok, (path, response.status, response.text())
        return response.json()

    original = api('/api/auth/session')
    accounts = api('/api/auth/accounts')['accounts']
    boss = next(a for a in accounts if a['role'] == 'boss')
    boss_token = api('/api/auth/select-account', {'accountId': boss['id']})['token']
    invite = api('/api/admin/invite-codes', {'organizationId': 0, 'maxUses': 1, 'expiresInDays': 1, 'requestId': str(uuid4())}, boss_token)
    page.locator('.account-add').click()
    page.locator('#invite-back').click()
    page.locator('.account-switcher').wait_for()
    assert len(api('/api/auth/accounts')['accounts']) == len(accounts)
    page.locator('.account-add').click()
    page.locator('[name=inviteCode]').fill(invite['code'])
    page.locator('[name=password]').fill('IncorrectPassword!')
    page.locator('#account-invite-form [type=submit]').click()
    page.locator('#dialog-error:not(:empty)').wait_for()
    assert len(api('/api/auth/accounts')['accounts']) == len(accounts)
    page.locator('[name=password]').fill('PlayerUat2026!')
    page.locator('#account-invite-form [type=submit]').click()
    page.locator('.account-added').wait_for()
    assert page.locator('.account-switcher [data-account]').count() == len(accounts) + 1
    after = api('/api/auth/session')
    assert after['session'] == original['session']
    assert after['user']['accountId'] == original['user']['accountId']
    page.locator('.account-switcher').screenshot(path=str(OUT / 'switcher-add-account.png'))
    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('() => document.documentElement.scrollWidth <= innerWidth')
    page.locator('.account-add').scroll_into_view_if_needed()
    page.screenshot(path=str(OUT / 'switcher-add-mobile.png'))
    assert not errors, errors
    browser.close()
    print('ACCOUNT_INVITATION_BROWSER_PASS')
