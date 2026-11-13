"""Verify deployed HTML/JS with synthetic API responses; never write production data."""
import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

SCORING = 'https://scoring.ai5000days.com'
ADMIN = 'https://admin.ai5000days.com'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    user = {'identityId': 1, 'accountId': 11, 'role': 'boss', 'guardianName': '合成发布验证', 'validityValid': True}
    account = {'id': 11, 'name': '合成账号', 'role': 'boss', 'organization_name': '合成组织', 'status': 'active', 'valid_until': 2000000000000}
    configuration = {'cardGroupId': 1, 'mode': 'standard', 'duration': 300, 'counts': [1, 0, 0], 'ageRange': {'min': 8, 'max': 12}}
    errors, calls = [], []
    with sync_playwright() as p:
        proxy = os.getenv('WQT_BROWSER_PROXY')
        browser = p.chromium.launch(headless=True, **({'proxy': {'server': proxy}} if proxy else {}))
        try:
            context = browser.new_context(viewport={'width': 1365, 'height': 1000})
            context.add_init_script("localStorage.setItem('WQT_AUTH_TOKEN','synthetic-release');localStorage.setItem('aw_token','synthetic-release');localStorage.setItem('aw_user'," + json.dumps(json.dumps(user)) + ")")
            def route(request):
                url = urlsplit(request.request.url)
                if url.hostname not in ['scoring.ai5000days.com', 'admin.ai5000days.com']:
                    return request.abort()
                if not url.path.startswith('/api/'):
                    return request.continue_()
                calls.append({'host': url.hostname, 'path': url.path, 'method': request.request.method})
                data = {
                    '/api/auth/session': {'user': user, 'accounts': [account], 'session': {}, 'requiresAccountSelection': False},
                    '/api/auth/accounts': {'accounts': [account]},
                    '/api/me': {'user': user},
                    '/api/settings': {'accountModel': 'accounts', 'settings': []},
                    '/api/card-groups': {'groups': [{'id': 1, 'name': '合成卡组', 'is_default': 1}]},
                    '/api/admin/card-groups': {'groups': [{'id': 1, 'name': '合成卡组'}]},
                    '/api/game/last-session': {'session': None},
                    '/api/player/feedback': {'pending': []},
                    '/api/me/activities/created': {'activities': []},
                    '/api/me/sessions': {'sessions': [{'id': 9, 'activity_name': '合成发布验证活动', 'location': '合成场地', 'started_at': 1792537200000, 'ended_at': 1792537500000, 'player_state_json': '{}', 'has_feedback': True}]},
                    '/api/admin/activities': {'activities': [{'id': 9, 'name': '合成发布验证活动', 'organizer': '合成场地', 'activity_code': 'SYNTHETIC', 'status': 'active', 'game_config_json': json.dumps(configuration)}]},
                    '/api/admin/activities/notifications': {'notifications': [{'activity_id': 9, 'name': '合成发布验证活动', 'organizer': '合成场地', 'created_at': 1792537200000}]},
                }.get(url.path, {})
                return request.fulfill(content_type='application/json', body=json.dumps(data))
            context.route('**/*', route)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(SCORING + '/player/', wait_until='domcontentloaded')
            expect(page.locator('#code-form')).to_be_visible()
            expect(page.locator('#skip-activity')).to_have_text('跳过活动码，自行配置')
            page.screenshot(path=str(output / 'live-activity-entry.png'), full_page=True)
            page.locator('#nav-me').click()
            page.locator('[data-tab=activities]').click()
            page.locator('#create-activity').click()
            expect(page.locator('#activity-apply-form .game-configuration-fields')).to_be_visible()
            expect(page.locator('#activity-apply-form [name=ageMin]')).to_be_visible()
            page.locator('#dialog-close').click()
            page.locator('[data-tab=feedback]').click()
            expect(page.locator('[data-session-row="9"]')).to_contain_text('合成发布验证活动')
            expect(page.locator('[data-session-row="9"] button')).to_have_count(3)
            assert page.locator('[data-review-tab]').count() == 0
            page.screenshot(path=str(output / 'live-review-rows.png'), full_page=True)
            page.goto(ADMIN + '/admin/activities', wait_until='domcontentloaded')
            expect(page.get_by_role('button', name='新活动通知', exact=True)).to_be_visible()
            expect(page.get_by_role('button', name='已知悉', exact=True)).to_be_visible()
            expect(page.get_by_role('button', name='终止', exact=True)).to_be_visible()
            page.get_by_role('button', name='编辑', exact=True).click()
            expect(page.get_by_role('dialog', name='编辑活动', exact=True)).to_contain_text('卡牌组')
            page.screenshot(path=str(output / 'live-admin-activity.png'), full_page=True)
            assert not errors, errors
            result = {'passed': True, 'actualDeployedAssets': True, 'syntheticApiOnly': True, 'pageErrors': errors, 'apiCalls': calls}
            (output / 'evidence.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps({'passed': True, 'pageErrors': errors, 'apiCalls': len(calls)}))
        finally:
            browser.close()

if __name__ == '__main__':
    main()
