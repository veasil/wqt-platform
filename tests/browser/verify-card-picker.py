"""Real player view, synthetic cards/HTTP; Chromium and WebKit scroll contracts."""
import argparse
import json
import mimetypes
import re
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
STATE = dict(values=[3]*5, ended=False, paused=False, revision=0, phase=0,
             done=[0]*3, counts=[3]*3, used=[], d={}, duration=1800,
             startedAt=9999999999999, pausedMs=0, choices=[])
FIXTURE = """
user={identityId:1,accountId:11,guardianName:'测试守望者',validityValid:true};
account={id:11,name:'测试账号',role:'watcher'};session={id:101};
state=FIXTURE_STATE;
cards=Array.from({length:45},(_,i)=>({id:i+1,card_code:'CARD'+String(i+1).padStart(2,'0'),
 title:'测试卡牌 '+(i+1),phase:phases[Math.floor(i/15)],safetyType:['身体','心理','社交','经济','数字权益'][i%5],
 event:'现场正在进行的卡牌',options:{A:{text:'认真观察后行动',consequence:'测试反馈',attributeEffects:{安全力:1}}}}));
window.pickerFixture={pick,game,openStudy:()=>studyMaterials(),getState:()=>state};
game();pick();window.pickerReady=true;
""".replace('FIXTURE_STATE', json.dumps(STATE))


def main():
    args = argparse.ArgumentParser()
    args.add_argument('--engine', choices=['chromium', 'webkit', 'all'], default='all')
    args.add_argument('--screenshots', type=Path)
    opts = args.parse_args()
    engines = ['chromium', 'webkit'] if opts.engine == 'all' else [opts.engine]
    with sync_playwright() as p:
        for name in engines:
            browser = getattr(p, name).launch(headless=True)
            try:
                context = browser.new_context(viewport={'width':393,'height':740}, has_touch=True, reduced_motion='reduce')
                page = context.new_page()
                errors, actions = [], []
                page.on('pageerror', lambda e: errors.append(str(e)))
                server_state = json.loads(json.dumps(STATE))

                def intercept(route):
                    url = urlsplit(route.request.url)
                    if url.hostname != 'localhost':
                        return route.abort()
                    if url.path.startswith('/api/'):
                        data = {}
                        if url.path == '/api/player/action':
                            body = json.loads(route.request.post_data)
                            actions.append(body)
                            server_state['revision'] += 1
                            server_state['done'][0] += 1
                            data = {'state':server_state,'payload':{'consequence':'测试反馈'}}
                        elif url.path == '/api/player/session/101':
                            data = {'state':server_state,'session':{'id':101},'events':[]}
                        elif url.path == '/api/cards/study':
                            data = {'cards':[{'id':1,'card_code':'CARD01','title':'测试资料'}]}
                        return route.fulfill(content_type='application/json', body=json.dumps(data))
                    target = ROOT/url.path.lstrip('/') if url.path.startswith('/shared/') else ROOT/'public'/url.path.lstrip('/')
                    if not target.is_file():
                        return route.fulfill(status=404, body='')
                    body = target.read_bytes()
                    if url.path == '/player/player.js':
                        body = re.sub(r'safe\(resumeLogin\);\s*$', lambda _:FIXTURE, body.decode()).encode()
                    return route.fulfill(content_type=mimetypes.guess_type(target)[0] or 'application/octet-stream', body=body)

                context.route('**/*', intercept)
                page.goto('http://localhost/player/index.html', wait_until='domcontentloaded')
                page.wait_for_function('window.pickerReady===true')
                for width, height in [(393,740),(393,852),(390,600),(740,360),(1365,1000),(393,300)]:
                    page.set_viewport_size({'width':width,'height':height})
                    for theme in ['dark','light']:
                        page.evaluate('(theme)=>{document.documentElement.dataset.theme=theme;pickerFixture.pick()}', theme)
                        expect(page.locator('[data-card]')).to_have_count(45)
                        expect(page.locator('#picker-count')).to_have_text('找到 45 张卡牌')
                        grid = page.locator('#card-list')
                        size = grid.evaluate('(e)=>({client:e.clientHeight,scroll:e.scrollHeight})')
                        assert size['client'] >= 150, (name,width,height,size)
                        assert size['scroll'] > size['client'], (name,width,height,size)
                        risk, phase = [page.locator(s).bounding_box() for s in ['#card-risk','#card-phase']]
                        assert abs(risk['y']-phase['y']) < 2, 'phase and risk filters share a row'
                        assert phase['x'] >= risk['x']+risk['width'], 'filters do not overlap'
                        last_card = page.locator('[data-card="45"]')
                        last_card.scroll_into_view_if_needed()
                        assert grid.evaluate('(e)=>e.scrollTop') > 0
                        last_card.click()
                        expect(page.locator('.card-number')).to_have_text('CARD45')
                        assert page.locator('dialog[open]').count() == 0
                        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                        print(json.dumps({'engine':name,'viewport':[width,height],'theme':theme,'listHeight':size['client'],'lastCardSelectable':True}), flush=True)
                page.set_viewport_size({'width':393,'height':740})
                page.evaluate('pickerFixture.pick()')
                for stage in ['启蒙期','成长期','青春期']:
                    page.locator('#card-phase').select_option(label=stage)
                    expect(page.locator('[data-card]')).to_have_count(15)
                page.locator('#card-risk').select_option(label='身体')
                expect(page.locator('[data-card]')).to_have_count(3)
                page.locator('#card-search').fill('CARD31')
                expect(page.locator('[data-card]')).to_have_count(1)
                page.locator('#card-search').fill('does-not-exist')
                expect(page.locator('[data-card]')).to_have_count(0)
                expect(page.locator('#picker-count')).to_have_text('找到 0 张卡牌')
                page.locator('#reset-card-filters').click()
                expect(page.locator('[data-card]')).to_have_count(45)
                assert page.locator('#card-search').input_value() == ''
                assert page.locator('#card-phase').input_value() == ''
                assert page.locator('#card-risk').input_value() == ''
                if opts.screenshots:
                    opts.screenshots.mkdir(parents=True,exist_ok=True)
                    # Some Windows WebKit builds expose DOM but return empty screenshots.
                    raw = page.screenshot()
                    if raw:
                        (opts.screenshots/f'picker-{name}.png').write_bytes(raw)
                page.locator('[data-card="45"]').click()
                page.locator('[data-choice="A"]').click()
                page.locator('#confirm').click()
                expect(page.locator('#feedback-title')).to_be_visible()
                assert actions[-1]['cardId'] == 45 and actions[-1]['action'] == 'choice'
                page.evaluate('pickerFixture.pick()')
                page.locator('#dialog-close').focus()
                page.keyboard.press('Enter')
                assert page.locator('dialog[open]').count() == 0
                # The shared study-dialog class must not acquire the selection-specific fixed height.
                page.evaluate('pickerFixture.openStudy()');page.wait_for_selector('[data-material]')
                study_height = page.locator('dialog[open]').bounding_box()['height']
                assert not page.locator("dialog[open]").evaluate("e=>e.classList.contains('card-selection-picker')")
                assert study_height < 500, study_height
                assert not errors, errors
                print(json.dumps({'engine':name,'filters':True,'crossPhaseRequest':True,'studyDialogHeight':study_height,'pageErrors':errors}), flush=True)
            finally:
                browser.close()


if __name__ == '__main__':
    main()
