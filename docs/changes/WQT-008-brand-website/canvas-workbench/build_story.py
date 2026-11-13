"""Build source-led brand story, illustration catalog and native Canvas sections."""
import argparse
import html
import json
import shutil
import zipfile
from datetime import datetime
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[4]
HERE=Path(__file__).resolve().parent
OUT=ROOT/'output/wqt-brand-story'
ASSETS=OUT/'assets'
PAGES=OUT/'pages'
for folder in [ASSETS,PAGES]:
    folder.mkdir(parents=True,exist_ok=True)
parser=argparse.ArgumentParser()
parser.add_argument('--vault',required=True)
parser.add_argument('--prepare',action='store_true')
args=parser.parse_args()
vault=Path(args.vault).resolve()
target=vault/'06-Apps/伍仟天品牌素材工作台'
stamp=datetime.now().strftime('%Y%m%d-%H%M%S-%f')
chapters=json.loads((HERE/'story-chapters.json').read_text(encoding='utf-8'))
shutil.copy2(ROOT/'output/wqt-brand-library/assets/company-mark.png',ASSETS/'company-mark.png')
for c in chapters:
    if not args.prepare:
        assert (ASSETS/(c['id']+'.png')).is_file(),c['id']

CSS='''
*{box-sizing:border-box}body{margin:0;color:#163151;background:#F5F8FF;font-family:"Microsoft YaHei","PingFang SC",sans-serif}a{color:#354AAD}a:focus-visible{outline:3px solid #DEB657;outline-offset:4px}h1,h2,h3,p{margin:0}.board{width:1440px;height:1040px;padding:40px;display:flex;flex-direction:column;gap:28px;background:#F5F8FF}.header{display:flex;gap:24px;align-items:center;justify-content:space-between;min-height:76px}.header img{width:155px;max-height:62px;object-fit:contain}.header h1{font-size:34px;line-height:1.4}.chapter{color:#354AAD;font-size:14px;font-weight:700;letter-spacing:2px;margin-bottom:8px}.content{display:grid;grid-template-columns:800px 1fr;gap:32px;flex:1;min-height:0}.picture{background:#EDF4FD;border-radius:18px;overflow:hidden;border:1px solid #C7D8EF;display:flex;align-items:center;justify-content:center}.picture img{width:100%;height:100%;object-fit:contain}.copy{display:flex;flex-direction:column;justify-content:center;gap:24px;padding:12px 0}.lead{font-size:28px;line-height:1.6;color:#354AAD}.body{font-size:19px;line-height:1.95}.bridge{padding:20px 0;border-top:2px solid #DEB657;font-size:17px;line-height:1.8}.source{font-size:13px;color:#516B87;line-height:1.75}.footer{display:flex;justify-content:space-between;border-top:1px solid #C7D8EF;padding-top:12px;font-size:13px;color:#516B87}.intro{display:grid;grid-template-columns:1.2fr 1fr;gap:48px;align-items:center;flex:1}.intro h2{font-size:52px;line-height:1.5}.intro p{font-size:21px;line-height:1.9;margin:24px 0}.mini-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.mini{background:white;border:1px solid #C7D8EF;border-radius:14px;padding:20px;min-height:140px}.mini span{color:#337CFF;font-size:14px}.mini h3{font-size:20px;margin:10px 0;line-height:1.6}.mini p{font-size:14px;margin:0}.timeline{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin-top:30px}.event{background:white;border:1px solid #C7D8EF;border-top:3px solid #354AAD;padding:24px;border-radius:12px;min-height:240px}.event b{font-size:32px;color:#354AAD}.event h3{font-size:21px;margin:18px 0;line-height:1.7}.event p{font-size:16px;line-height:1.85}.history-notes{font-size:16px;line-height:1.9;margin:25px 0;color:#516B87}.history-images{display:grid;grid-template-columns:1fr 1fr;gap:20px;max-height:350px}.history-images img{width:100%;height:100%;max-height:350px;object-fit:contain;border:1px solid #C7D8EF;border-radius:12px;background:white}.style-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}.style-card{background:white;padding:24px;border:1px solid #C7D8EF;border-radius:16px}.style-card h3{font-size:23px;margin-bottom:15px}.style-card p{font-size:17px;line-height:1.8}.swatches{display:flex;gap:12px;flex-wrap:wrap;margin-top:24px}.swatches span{width:72px;height:72px;border-radius:12px}.style-image{height:380px;object-fit:contain;width:100%;border-radius:14px;background:#EDF4FD}.gallery{max-width:1500px;margin:auto;padding:40px}.gallery header{margin-bottom:36px}.gallery h1{font-size:34px}.gallery p{font-size:17px;line-height:1.9;margin-top:16px}.gallery-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}.gallery-card{background:white;border:1px solid #C7D8EF;border-radius:16px;overflow:hidden;text-decoration:none;color:#163151}.gallery-card img{width:100%;aspect-ratio:3/2;object-fit:contain;background:#EDF4FD}.gallery-card div{padding:22px}.gallery-card h2{font-size:22px;line-height:1.6}.gallery-card p{font-size:16px}.wide{grid-column:1/-1}.links{display:flex;gap:24px;flex-wrap:wrap;margin-top:24px;font-size:16px}.source strong{color:#354AAD}@media(max-width:760px){.board{width:100%;height:auto;min-height:100vh;padding:22px}.header h1{font-size:25px}.header img{width:95px}.content,.intro{grid-template-columns:1fr}.picture{min-height:0;min-width:0;aspect-ratio:3/2}.copy{padding:0}.mini-grid,.style-grid,.timeline{grid-template-columns:1fr}.gallery{padding:22px}.gallery-grid{grid-template-columns:1fr}.history-images{grid-template-columns:1fr;max-height:none}.timeline{grid-template-columns:1fr!important}.intro h2{font-size:36px}}
'''
(OUT/'story.css').write_text(CSS,encoding='utf-8')
def wrapper(title,body):
    return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+html.escape(title)+'</title><link rel="stylesheet" href="story.css"><body>'+body+'</body></html>'
def board(title,content,sub='品牌故事与插画系统'):
    return '<section class="board"><header class="header"><div><p class="chapter">'+sub+'</p><h1>'+title+'</h1></div><img src="assets/company-mark.png" alt="伍仟天科技"></header>'+content+'<footer class="footer"><span>伍仟天 · AI5000天数智免疫力计划</span><span>品牌表达候选 · 插画场景不作为真实活动照片</span></footer></section>'

for i,c in enumerate(chapters):
    body='<div class="content"><div class="picture"><img src="assets/'+c['id']+'.png" alt="'+c['title']+'主题插画"></div><div class="copy"><h2 class="lead">'+c['lead']+'</h2><p class="body">'+c['body']+'</p><p class="bridge">'+c['bridge']+'</p><p class="source"><strong>依据</strong> '+c['source']+'<br>'+c['status']+'</p></div></div>'
    (OUT/(c['id']+'.html')).write_text(wrapper(c['title'],board(c['title'],body,f'品牌故事 / {i+1:02}')),encoding='utf-8')

mini=''.join('<div class="mini"><span>'+str(i+1).zfill(2)+'</span><h3>'+c['title'].replace('品牌行动 · ','')+'</h3></div>' for i,c in enumerate(chapters))
overview='<div class="intro"><div><p class="chapter">沿用原有品牌主张</p><h2>让儿童友好<br>成为 AI 产品的<br><span style="color:#354AAD">真“芯”</span></h2><p>以儿童真实成长为中心，连接教育实践、家庭陪伴与技术治理。</p><p class="source">主张与三大系列来源：公司三折页及官方介绍。</p></div><div class="mini-grid">'+mini+'</div></div>'
(OUT/'00-story-map.html').write_text(wrapper('品牌故事总图',board('从时代问题，到成长支持的未来生态',overview)),encoding='utf-8')

events=[('2022','从研究出发','计划全文记载《中国儿童数字媒介素养报告》，开始持续研究与倡导。'),('2023','项目与公共交流','历史材料记载 ICC 项目启动、教育蓝图论坛与专家研讨。'),('2024','实践与持续倡导','历史材料记录郑州交流、中国儿童幼教展；欧盟报告仅为外部参照。'),('2025','测评与本地实践','计划记载数智素养测评报告，并自2025年起在上海、宁夏等地实践。'),('2026','风险研究与WAIC','计划记载数字风险白皮书；新版通稿记载WAIC五块行动与儿童友好倡导。')]
timeline='<div><div class="timeline" style="grid-template-columns:repeat(5,1fr)">'+''.join('<article class="event"><b>'+year+'</b><h3>'+title+'</h3><p>'+body+'</p></article>' for year,title,body in events)+'</div><p class="history-notes">来源：S4历史材料第7、25页；S5计划全文rev142；S6新版媒体通稿rev406。按官方材料记载，报告正文未逐篇复核。公司成立年份不在此推定，外部研究不列为自有成果；框架编号差异保留来源，不由设计裁定。</p><div class="history-images"><img src="assets/history-research.png" alt="项目材料研究历程原页"><img src="assets/history-activities.png" alt="项目材料社会倡导原页"></div></div>'
shutil.copy2(ROOT/'output/brand-research/renders/project-introduction-07.png',ASSETS/'history-research.png')
shutil.copy2(ROOT/'output/brand-research/renders/project-introduction-25.png',ASSETS/'history-activities.png')
(OUT/'13-history.html').write_text(wrapper('品牌历程与来源',board('研究、实践与倡导的历程',timeline,'品牌历程 / 项目材料记载')),encoding='utf-8')

style='<div class="style-grid">'+''.join('<section class="style-card"><h3>'+title+'</h3><p>'+body+'</p></section>' for title,body in [
 ('人物与关系','延续原倡导图的柔和立体人物，明确学龄儿童、成人与青少年的年龄关系。孩子表达、选择和创造，成人倾听；机器人提供辅助。'),
 ('配色与材质','标识蓝、电蓝、冰白、淡紫与少量金色。日常材料、柔和立体质感与适量蓝色玻璃结合，延续原有光流。'),
 ('光线与构图','柔和方向光、相近镜头高度、清楚的单一叙事焦点。图像不生成文字和 Logo，中文与原有标识在排版层保留。')])+'</div><div class="swatches">'+''.join('<span style="background:'+color+'"></span>' for color in ['#354AAD','#337CFF','#111D42','#DEB657','#EDF4FD'])+'</div><div style="margin-top:24px" class="style-grid">'+''.join('<img class="style-image" src="assets/'+id_+'.png" alt="统一插画样张">' for id_ in ['style-reference-original','04-family','09-industry'])+'</div>'
(OUT/'14-style.html').write_text(wrapper('统一插画与设计语言',board('同一品牌，同一套成熟的叙事语言',style,'视觉系统 / 左为原倡导图，右为本轮延展')),encoding='utf-8')

gallery='<main class="gallery"><header><p class="chapter">伍仟天 · 品牌故事与插画</p><h1>从时代问题，到成长支持的未来生态</h1><p>十二个章节，六类品牌行动。故事内容、独立插画、历程来源与统一设计语言放在一起审阅。</p><div class="links"><a href="00-story-map.html">故事总图</a><a href="13-history.html">品牌历程</a><a href="14-style.html">统一设计语言</a><a href="source-review.md">飞书来源与版本</a></div></header><div class="gallery-grid">'
for c in chapters:
    gallery+='<a class="gallery-card" href="'+c['id']+'.html"><img src="assets/'+c['id']+'.png" alt="'+c['title']+'"><div><h2>'+c['title']+'</h2><p>'+c['lead']+'</p></div></a>'
gallery+='</div></main>'
(OUT/'index.html').write_text(wrapper('品牌故事与插画总览',gallery),encoding='utf-8')

errors=[]
checks=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1040},reduced_motion='reduce')
    page.on('pageerror',lambda e:errors.append(str(e)))
    for f in sorted(OUT.glob('*.html')):
        if f.name in ['index.html','canvas-preview.html']:
            continue
        if args.prepare and f.stem not in ['00-story-map','13-history']:
            continue
        page.goto(f.as_uri())
        page.evaluate('document.fonts.ready')
        assert page.evaluate('[...document.images].every(i=>i.complete&&i.naturalWidth>0)'),f.name
        overflow=page.locator('.board').evaluate('(e)=>e.scrollHeight>e.clientHeight+1||e.scrollWidth>e.clientWidth+1')
        assert not overflow,f.name
        page.locator('.board').screenshot(path=str(PAGES/(f.stem+'.png')))
        checks.append(f.stem)
    page.set_viewport_size({'width':390,'height':844})
    for name in (['13-history.html'] if args.prepare else ['index.html','00-story-map.html','13-history.html','14-style.html']+[c['id']+'.html' for c in chapters]):
        page.goto((OUT/name).as_uri())
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),name
    browser.close()
assert not errors,errors
if args.prepare:
    print(json.dumps({'prepared_boards':checks,'overflow':False},ensure_ascii=False))
    raise SystemExit(0)

# Add story nodes without deleting the earlier library or changing user-owned structure.
canvas_path=target/'伍仟天品牌素材总白板.canvas'
canvas=json.loads(canvas_path.read_text(encoding='utf-8'))
old=[n for n in canvas['nodes'] if not n['id'].startswith('S-')]
# Position the new story above every existing node. Existing coordinates stay intact.
story_offset=min((n['y'] for n in old),default=0)-5600
new=[]
def text(id_,body,x,y,w,h):
    new.append(dict(id='S-'+id_,type='text',text=body,x=x,y=y,width=w,height=h))
def file(id_,f,x,y,w,h):
    dest=target/'品牌故事'/f.relative_to(OUT)
    dest.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(f,dest)
    new.append(dict(id='S-'+id_,type='file',file=dest.relative_to(vault).as_posix(),x=x,y=y,width=w,height=h))
text('title','# 伍仟天 · 品牌故事与插画系统\n时代与社会 → 风险命题 → 素养提升 → 家庭陪伴 → 多方共建 → 品牌行动 → 未来生态',0,0,5700,160)
for i,c in enumerate(chapters):
    gx=(i%4)*1440;gy=220+(i//4)*1180
    new.append(dict(id='S-group-'+c['id'],type='group',label=f'{i+1:02} · '+c['title'],x=gx,y=gy,width=1400,height=1120,color='5'))
    file('art-'+c['id'],ASSETS/(c['id']+'.png'),gx+20,gy+30,1360,890)
    text('copy-'+c['id'],'## '+c['lead']+'\n'+c['body']+'\n\n→ '+c['bridge'],gx+20,gy+940,1360,160)
for i,(id_,label) in enumerate([('00-story-map','故事总图'),('13-history','品牌历程与来源'),('14-style','统一设计语言')]):
    x=i*1920;y=3850
    new.append(dict(id='S-extra-group-'+id_,type='group',label=label,x=x,y=y,width=1860,height=1430,color='5'))
    file('board-'+id_,PAGES/(id_+'.png'),x+30,y+30,1800,1300)
    text('board-label-'+id_,label+' · 独立 HTML 与源文件随素材保存',x+30,y+1340,1800,60)

backup=target/'历史备份'/stamp
backup.mkdir(parents=True,exist_ok=True)
shutil.copy2(canvas_path,backup/canvas_path.name)
canvas['nodes']=[dict(n,y=n['y']+story_offset) for n in new]+old
assert len({n['id'] for n in canvas['nodes']})==len(canvas['nodes'])
for n in canvas['nodes']:
    if n['type']=='file':
        assert (vault/n['file']).is_file(),n['file']

manifest=[]
for c in chapters:
    f=ASSETS/(c['id']+'.png')
    with Image.open(f) as im:
        manifest.append(dict(id=c['id'],file=f.relative_to(OUT).as_posix(),size=list(im.size),title=c['title'],source=c['source'],status=c['status'],illustration='新生图候选；不是活动照片'))
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
shutil.copy2(HERE/'story-chapters.json',OUT/'story-chapters.json')
shutil.copy2(HERE/'story-design.md',OUT/'story-design.md')
(OUT/'README.md').write_text('# 品牌故事与插画系统\n\n打开 index.html 查看十二个章节；点击进入图文故事板。独立插画在 assets/，源文案和来源在 story-chapters.json，统一设计语言在 story-design.md。\n\n品牌历程依项目材料记载，外部研究参照不作为公司成果。新插画为叙事候选，不作为真实活动或客户照片。公司三折页为用户确认的业务事实。\n\n本轮延续蓝金与技术/成长的视觉识别，统一人物比例、材质、光线与构图；等待用户视觉验收。\n',encoding='utf-8')

parts=['<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#F5F8FF;color:#163151;font-family:"Microsoft YaHei",sans-serif}.b{position:relative;width:5760px;height:5330px;transform:scale(.5);transform-origin:top left}.n{position:absolute;box-sizing:border-box;overflow:hidden}.group{border:1px solid #B9CCE5;border-radius:12px;background:white}.group span{position:absolute;left:20px;top:5px;font-size:18px;font-weight:700;color:#354AAD}.file img{width:100%;height:100%;object-fit:contain}.text{padding:4px 8px;white-space:pre-wrap;font-size:19px;line-height:28px}.title{font-size:34px;line-height:46px;padding:20px}</style><div class="b">']
for n in sorted(new,key=lambda n:n['type']!='group'):
    styles=f'left:{n["x"]}px;top:{n["y"]}px;width:{n["width"]}px;height:{n["height"]}px'
    cls='n '+('group' if n['type']=='group' else 'file' if n['type']=='file' else 'text')+(' title' if n['id']=='S-title' else '')
    if n['type']=='file':
        content='<img src="'+(vault/n['file']).as_uri()+'">'
    elif n['type']=='group':
        content='<span>'+html.escape(n['label'])+'</span>'
    else:
        content=html.escape(n['text'].replace('## ','').replace('# ',''))
    parts.append('<div class="'+cls+'" style="'+styles+'">'+content+'</div>')
parts.append('</div>')
(OUT/'canvas-preview.html').write_text(''.join(parts),encoding='utf-8')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':2880,'height':2665})
    page.goto((OUT/'canvas-preview.html').as_uri())
    page.evaluate('document.fonts.ready')
    assert page.evaluate('[...document.images].every(i=>i.complete&&i.naturalWidth>0)')
    assert not page.locator('.text').evaluate_all('(els)=>els.some(e=>e.scrollHeight>e.clientHeight+1)')
    page.screenshot(path=str(OUT/'story-canvas-overview.png'))
    browser.close()
canvas_path.write_text(json.dumps(canvas,ensure_ascii=False,indent=2),encoding='utf-8')
result=dict(illustrations=len(chapters),storyboards=len(checks),all_images_loaded=True,board_overflow=False,mobile_horizontal_overflow=False,javascript_errors=errors,canvas_nodes=len(canvas['nodes']),visual_acceptance='pending',history='attributed to source material; external research distinguished')
(OUT/'checks.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
with zipfile.ZipFile(OUT/'WQT-Brand-Story.zip','w',zipfile.ZIP_DEFLATED) as z:
    for f in OUT.rglob('*'):
        if f.is_file() and f.suffix!='.zip':
            z.write(f,f.relative_to(OUT).as_posix())
for f in OUT.rglob('*'):
    if f.is_file():
        dest=target/'品牌故事'/f.relative_to(OUT)
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(f,dest)
print(json.dumps(result,ensure_ascii=False))
