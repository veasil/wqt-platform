"""Build a source-led Obsidian Canvas. Original media bytes are preserved."""
import argparse
import hashlib
import html
import json
import shutil
from datetime import datetime
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
parser = argparse.ArgumentParser()
parser.add_argument('--vault', required=True)
parser.add_argument('--baseline', required=True)
args = parser.parse_args()
vault = Path(args.vault).resolve()
target = vault / '06-Apps' / '伍仟天品牌素材工作台'
media = target / '素材'
media.mkdir(parents=True, exist_ok=True)
stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')

def backup(path):
    if path.exists():
        dest = target / '历史备份' / stamp / path.relative_to(target)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dest)

nodes, records = [], []
def text_node(id_, text, x, y, w, h, color=None):
    node = dict(id=id_, type='text', text=text, x=x, y=y, width=w, height=h)
    if color:
        node['color'] = color
    nodes.append(node)

text_node('title', '# 伍仟天 · 品牌素材总白板\n原始视觉取材 → 独立素材 → UI 组件 → 应用验证｜本轮：取材与工作台建立，素材库待继续制作', 0, 0, 5700, 140)

groups = [
    ('references', '01 原始传播材料 · 构图与视觉取材', 0, 200),
    ('identity', '02 身份与角色 · 原有资产 / 版本并存', 1920, 200),
    ('graphics', '03 背景与图形 · 原有资产 / 分辨率待升级', 3840, 200),
    ('product', '04 产品基准与 UI 待制作清单', 0, 1800),
    ('applications', '05 原始应用 · 信息组织与场景表达', 1920, 1800),
    ('rejected', '06 V2 / V3 未通过 · 仅供诊断', 3840, 1800),
]
for id_, label, x, y in groups:
    nodes.append(dict(id=id_, type='group', label=label, x=x, y=y, width=1860, height=1500, color='1' if id_ == 'rejected' else '5'))

def asset(id_, source, label, group, index, columns=3, status='原始参考', provenance=''):
    source = Path(source)
    if not source.is_file():
        raise FileNotFoundError(source)
    name = id_ + source.suffix.lower()
    dest = media / name
    if dest.exists() and dest.read_bytes() != source.read_bytes():
        backup(dest)
    shutil.copy2(source, dest)
    gx, gy = next((x, y) for g, _, x, y in groups if g == group)
    width = (1780 - 20 * (columns - 1)) // columns
    height = 350
    x, y = gx + 40 + (index % columns) * (width + 20), gy + 40 + (index // columns) * height
    rel = dest.relative_to(vault).as_posix()
    nodes.append(dict(id=id_, type='file', file=rel, x=x, y=y, width=width, height=270))
    with Image.open(dest) as image:
        dimensions = image.size
    text_node(id_ + '-label', f'**{id_} · {label}**\n{status} · {dimensions[0]}×{dimensions[1]}', x, y + 278, width, 68)
    records.append(dict(id=id_, label=label, file=rel, source=str(source), provenance=provenance,
                        status=status, dimensions=list(dimensions), sha256=hashlib.sha256(dest.read_bytes()).hexdigest()))

renders = ROOT / 'output/brand-research/renders'
assets = ROOT / 'output/wqt-vi-v3/assets'
public = ROOT / 'public/brand'
for i, (name, label) in enumerate([
    ('company-brochure-1.png', '公司折页正面'), ('company-brochure-2.png', '公司折页背面'),
    ('one-page-1.png', '计划单页：框架与图标'), ('one-page-2.png', '计划单页：活动表达'),
    ('deck-sheet-1.png', '历史项目材料总览 1'), ('deck-sheet-2.png', '历史项目材料总览 2'),
    ('project-introduction-01.png', '历史企业介绍封面'),
    ('project-introduction-03.png', '5000 天原始叙事'),
]):
    asset(f'R{i+1:02}', renders/name, label, 'references', i, status='公司三折页；用户确认真实业务事实' if name.startswith('company-brochure') else '历史 / 单页取材；版本差异单独保留')
text_node('reference-reading', '## 取材重点\n徽章的多层轮廓与角色关系；蓝色光流的密度与方向；金色手写文字；蓝/紫/橙的信息分类；人物与科技背景的组合。\n历史材料中的体系编号、五力术语和经营数据有版本差异，设计不自行统一。', 40, 1330, 1780, 310)

identity = [
    (assets/'company-mark.png', '公司简洁标识', '公司身份；现有位图'),
    (assets/'program-badge-s2.png', '计划徽章：折页版本', '版本参考；完整保留原图'),
    (assets/'program-badge-s3.png', '计划徽章：单页版本', '版本参考；不合并成新标识'),
    (public/'logo.png', '伍力全开产品标识', '已确认产品身份'),
    (public/'wu-2-5.png', '小伍：2–5 岁版本', '仓库原有角色；场景待核对'),
    (public/'wu-6-11.png', '小伍：6–11 岁版本', '仓库原有角色；不重绘'),
    (public/'wu-12-15.png', '小伍：12–15 岁版本', '仓库原有角色；场景待核对'),
    (assets/'series-education.png', '教育支持原有图标', '低分辨率参考；不是生产矢量'),
    (assets/'series-growth.png', '成长支持原有图标', '低分辨率参考；不是生产矢量'),
    (assets/'series-governance.png', '技术治理原有图标', '低分辨率参考；不是生产矢量'),
]
manifest = {item['file']: item for item in json.loads((assets/'source-manifest.json').read_text(encoding='utf-8'))}
for i, (source, label, status) in enumerate(identity):
    asset(f'I{i+1:02}', source, label, 'identity', i, columns=4, status=status, provenance=manifest.get(source.name, {}).get('source', str(source.relative_to(ROOT))))
text_node('identity-gaps', '## 待制作 / 待判断\n公司、计划、产品的组合署名；深浅背景适配；角色与标识组合；正式矢量母版。原有标识版本并存，不能由执行者擅定唯一版本。', 1960, 1330, 1780, 310)

graphics = [
    (assets/'orbital-field.jpg', '轨道科技背景', '原嵌入图；保留像素'),
    (assets/'light-stream.jpg', '蓝色光流背景', '原嵌入图；小尺寸参考'),
    (public/'banner-bg.png', '产品横幅背景', '仓库原有资产'),
    (assets/'advocacy-original.png', '金色倡导语与人机组合', '完整源画面参考；不是独立透明素材'),
    (assets/'education-pack.png', '桌游包装', '源材料裁区；分辨率受限'),
    (assets/'family-scene.png', '家庭参与场景', '源材料图像；不作为真实客户证明'),
]
for i, (source, label, status) in enumerate(graphics):
    asset(f'G{i+1:02}', source, label, 'graphics', i, status=status, provenance=manifest.get(source.name, {}).get('source', str(source.relative_to(ROOT))))
text_node('graphics-gaps', '## 素材制作缺口\n01 背景：横 / 竖 / 窄幅，高分辨率，留出文字区。\n02 光流与纹理：完整层次和可独立使用的装饰资产。\n03 图形容器：不同密度和尺寸，检查边角、对齐与内容容纳。\n04 图标与标签：从原有语法扩展；风险分类与五力不能混用。\n05 标题与角色组合：对照原图检查品牌表达。\n这些是待制作项，不以现有低清参考冒充完成。', 3880, 1330, 1780, 310)

# Render the approved product sample, without changing its source or style.
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport=dict(width=1440, height=1000), reduced_motion='reduce')
    for i, theme in enumerate(['light', 'dark']):
        dest = media/f'P{i+1:02}.png'
        backup(dest)
        page.goto(Path(args.baseline).resolve().as_uri() + '?theme=' + theme)
        page.wait_for_load_state('networkidle')
        page.evaluate('document.fonts.ready')
        assert page.evaluate('[...document.images].every(i=>i.complete && i.naturalWidth>0)')
        page.screenshot(path=str(dest), full_page=True)
        # Copy through a temporary source to retain the same file handling contract.
        temp = target/f'baseline-{theme}.png'
        shutil.copy2(dest, temp)
        asset(f'P{i+1:02}', temp, '产品已认可样张 · '+('亮版' if theme=='light' else '暗版'), 'product', i, columns=2,
              status='产品局部视觉基准；不是公司整体 VI', provenance=str(Path(args.baseline).resolve()))
        records[-1]['source'] = str(Path(args.baseline).resolve()) + '?theme=' + theme
        temp.unlink()
    browser.close()

ui = [
    ('操作与选择', '按钮、图标按钮、分段选择、复选、标签。默认 / 焦点 / 选中 / 禁用 / 加载。'),
    ('输入与反馈', '输入、下拉、数量调整、校验。错误定位 / 请求失败 / 重试 / 空状态。'),
    ('容器与导航', '卡片、列表、表格、导航、分页、弹窗。长内容 / 窄屏 / 键盘焦点。'),
    ('业务组件', '卡牌选择→确认→独立反馈；活动配置、技能使用、监督统计、账号与学习。'),
]
for i, (label, content) in enumerate(ui):
    text_node('ui-'+str(i), '## 待制作 · '+label+'\n'+content, 40+(i%2)*900, 2230+(i//2)*240, 880, 210)
text_node('ui-boundary', '## 产品约束\n已认可的是游戏单屏的局部视觉。监督 / 我的不复制游戏左栏；列表与管理表格需要独立检验密度。\n品牌统一不能改变业务流程、权限或数据边界。', 40, 2750, 1780, 480)

for i, (name, label) in enumerate([
    ('company-brochure-1.png', '倡导与计划：原始组合'), ('company-brochure-2.png', '产品系列：原始组合'),
    ('one-page-1.png', '结构与图标：原始应用'), ('one-page-2.png', '活动与参与：原始应用'),
    ('deck-sheet-3.png', '历史研究材料总览 3'), ('deck-sheet-4.png', '历史研究材料总览 4'),
    ('deck-sheet-5.png', '历史研究材料总览 5'), ('deck-sheet-6.png', '历史研究材料总览 6'),
]):
    asset(f'A{i+1:02}', renders/name, label, 'applications', i, status='原始应用参考；新应用待制作')
text_node('application-gaps', '## 应用验证待制作\n活动海报 / 机构合作单页 / 研究报告封面与内页 / 官网区块 / 游戏界面 / 管理表格。\n用真实长短内容检验素材；应用图必须能追溯到独立素材。', 1960, 2930, 1780, 310)

rejected = [
    (ROOT/'output/wqt-vi-v2/board-01.png', 'V2 封面'),
    (ROOT/'output/wqt-vi-v2/board-05.png', 'V2 素材 / 规则页'),
    (ROOT/'output/wqt-vi-v3/pages/page-01.png', 'V3 封面'),
    (ROOT/'output/wqt-vi-v3/pages/page-06.png', 'V3 图形语法'),
    (ROOT/'output/wqt-vi-v3/pages/page-08.png', 'V3 应用'),
    (ROOT/'output/wqt-vi-v3/pages/page-12.png', 'V3 交付清单'),
]
for i, (source, label) in enumerate(rejected):
    asset(f'X{i+1:02}', source, label, 'rejected', i, status='用户未认可；禁止作为设计标准')
text_node('rejection-reasons', '## 用户反馈 · 当前执行约束\n品牌表达不够精准；新材料制作太少且不好看；代码图形存在对齐与细节问题；少量框线不能满足素材库需求；交付密度不足。\n本轮只建立取材与工作台。后续新增素材须在原尺寸下检查，并与原始画面并列比较。', 3880, 2930, 1780, 310, '1')

canvas = dict(nodes=nodes, edges=[])
canvas_path = target/'伍仟天品牌素材总白板.canvas'
backup(canvas_path)
canvas_path.write_text(json.dumps(canvas, ensure_ascii=False, indent=2), encoding='utf-8')
backup(target/'素材清单.json')
(target/'素材清单.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
notes = '# 伍仟天品牌素材工作台\n\n打开 [[伍仟天品牌素材总白板.canvas]]，缩放查看六个区域。\n\n本轮是原始材料取材与资产盘点，不是新 VI / 完整组件库。V2/V3 未通过；原始传播物料是取材依据，不自动成为定稿规范。\n\n用户于 2026-10-14 在 Codex 会话确认使用 Obsidian 白板并要求继续。\n\n## 素材来源与状态\n\n'
for r in records:
    notes += f'- **{r["id"]} {r["label"]}**：[[{r["file"]}]]；{r["status"]}；来源：`{r["provenance"] or r["source"]}`。\n'
backup(target/'工作台说明.md')
(target/'工作台说明.md').write_text(notes, encoding='utf-8')

# Validate native node references and avoid accidental overlaps between siblings.
ids = [n['id'] for n in nodes]
assert len(ids) == len(set(ids))
for n in nodes:
    if n['type'] == 'file':
        assert (vault/n['file']).is_file()
for i, a in enumerate(nodes):
    if a['type'] == 'group':
        continue
    for b in nodes[i+1:]:
        if b['type'] == 'group':
            continue
        assert not (a['x'] < b['x']+b['width'] and b['x'] < a['x']+a['width'] and
                    a['y'] < b['y']+b['height'] and b['y'] < a['y']+a['height']), (a['id'], b['id'])

parts = ['<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#101725;color:#e5edf8;font-family:"Microsoft YaHei",sans-serif}.board{position:relative;width:5700px;height:3340px}.node{position:absolute;box-sizing:border-box;border:1px solid #35445b;border-radius:12px;overflow:hidden;background:#172236}.group{background:#131d2e;border:2px solid #415675}.group span{position:absolute;top:8px;left:18px;font-size:20px;font-weight:700}.file{padding:8px;background:#f1f4f8}.file img{width:100%;height:100%;object-fit:contain}.text{padding:12px 16px;white-space:pre-wrap;font-size:18px;line-height:1.55}.title{font-size:32px}.red{border-color:#c36e7b}</style><div class="board">']
for n in sorted(nodes, key=lambda n: n['type'] != 'group'):
    styles = ';'.join(f'{k}:{n[k]}px' for k in ['width', 'height']) + f';left:{n["x"]}px;top:{n["y"]}px'
    cls = 'node '+('group' if n['type']=='group' else 'file' if n['type']=='file' else 'text')
    if n.get('color') == '1':
        cls += ' red'
    if n['id']=='title':
        cls += ' title'
    if n['id'].endswith('-label'):
        styles += ';padding:4px 8px;font-size:14px;line-height:20px'
    if n['type']=='file':
        uri = (vault/n['file']).resolve().as_uri()
        content = f'<img src="{html.escape(uri)}">'
    elif n['type']=='group':
        content = '<span>'+html.escape(n['label'])+'</span>'
    else:
        content = html.escape(n['text']).replace('**', '').replace('# ', '').replace('## ', '')
    parts.append(f'<div class="{cls}" style="{styles}">{content}</div>')
parts.append('</div>')
preview = target/'白板预览.html'
backup(preview)
preview.write_text(''.join(parts), encoding='utf-8')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport=dict(width=2850, height=1670), device_scale_factor=1)
    page.goto(preview.as_uri())
    page.evaluate('document.fonts.ready')
    assert page.evaluate('[...document.images].every(i=>i.complete && i.naturalWidth>0)')
    overflow = page.locator('.text').evaluate_all('(els)=>els.filter(e=>e.scrollHeight>e.clientHeight+1).map(e=>e.textContent.slice(0,60))')
    assert not overflow, overflow
    page.evaluate('document.querySelector(".board").style.transform="scale(.5)";document.querySelector(".board").style.transformOrigin="top left"')
    backup(target/'白板总览.png')
    page.screenshot(path=str(target/'白板总览.png'))
    browser.close()
evidence = dict(canvas=str(canvas_path), asset_count=len(records), node_count=len(nodes), file_references='all exist', duplicate_ids=0,
                sibling_overlaps=0, preview_images='all loaded', preview_text_overflow=overflow,
                native_obsidian_visual_check='not performed', status='取材与工作台已建立；新素材与完整 UI 待制作')
(target/'检查记录.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(evidence, ensure_ascii=False))
