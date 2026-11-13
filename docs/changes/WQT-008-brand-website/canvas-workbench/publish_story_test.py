"""Publish only real, available test deliverables; preserve the existing Canvas."""
import json
import shutil
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[4]
OUT=ROOT/'output/wqt-brand-story'
VAULT=Path('D:/BibbTwigs/BIBB-OS-v1.0')
TARGET=VAULT/'06-Apps/伍仟天品牌素材工作台'
DEST=TARGET/'品牌故事'
stamp=datetime.now().strftime('%Y%m%d-%H%M%S-%f')
with sync_playwright() as p:
    b=p.chromium.launch(headless=True)
    page=b.new_page(viewport={'width':1440,'height':1040})
    page.goto((OUT/'01-era.html').as_uri())
    page.evaluate('document.fonts.ready')
    assert page.evaluate('[...document.images].every(i=>i.complete&&i.naturalWidth>0)')
    assert not page.locator('.board').evaluate('(e)=>e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1')
    page.locator('.board').screenshot(path=str(OUT/'pages/01-era.png'))
    b.close()

files=['story.css','00-story-map.html','01-era.html','13-history.html','image-test-2026-10-16.json',
       'assets/company-mark.png','assets/01-era.png','assets/history-research.png','assets/history-activities.png',
       'pages/00-story-map.png','pages/01-era.png','pages/13-history.png']
for name in files:
    dest=DEST/name
    dest.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(OUT/name,dest)
for name in ['story-design.md','story-chapters.json']:
    shutil.copy2(Path(__file__).parent/name,DEST/name)
canvas_path=TARGET/'伍仟天品牌素材总白板.canvas'
data=json.loads(canvas_path.read_text(encoding='utf-8'))
nodes=[n for n in data['nodes'] if not n['id'].startswith('S-probe-')]
nodes.append(dict(id='S-probe-title',type='text',text='# 品牌故事 · 生图恢复测试\n2026-10-16：首张插画已实际生成；十二章叙事和历程来源板已准备。整组插画尚未完成，风格待结合新增飞书材料校准。',x=0,y=-3600,width=5700,height=180))
for i,(id_,label,name) in enumerate([
    ('era','01 · AI 时代与儿童成长 · 本次实际生成','assets/01-era.png'),
    ('map','十二章故事总图 · 文案与逻辑','pages/00-story-map.png'),
    ('history','品牌历程 · 原始项目材料记载','pages/13-history.png'),
]):
    x=i*1920;y=-3300
    nodes.append(dict(id='S-probe-group-'+id_,type='group',label=label,x=x,y=y,width=1860,height=1500,color='5'))
    nodes.append(dict(id='S-probe-file-'+id_,type='file',file=(DEST/name).relative_to(VAULT).as_posix(),x=x+30,y=y+40,width=1800,height=1300))
    nodes.append(dict(id='S-probe-label-'+id_,type='text',text=label+'\n独立源文件：[['+(DEST/name).relative_to(VAULT).as_posix()+']]',x=x+30,y=y+1360,width=1800,height=100))
backup=TARGET/'历史备份'/stamp
backup.mkdir(parents=True,exist_ok=True)
shutil.copy2(canvas_path,backup/canvas_path.name)
data['nodes']=nodes
assert len({n['id'] for n in nodes})==len(nodes)
for n in nodes:
    if n['type']=='file':
        assert (VAULT/n['file']).is_file()
canvas_path.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'published':'one generated image plus actual story/history boards','canvas_nodes':len(nodes),'file_references':'all exist'},ensure_ascii=False))
