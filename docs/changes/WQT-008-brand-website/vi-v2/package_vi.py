"""Package only proposal materials, excluding raw business research documents."""
from pathlib import Path
import json
import shutil
import zipfile
import importlib.util

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
OUT=ROOT/'output'/'wqt-vi-v2'
spec=importlib.util.spec_from_file_location('vi_builder',HERE/'build_vi.py')
builder=importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
kit=OUT/'asset-kit'
kit.mkdir(exist_ok=True)
for folder in ('originals','graphics','tokens','boards'):
    (kit/folder).mkdir(exist_ok=True)
for filename in ('company-mark.png','company-combined.png','xiaowu.png'):
    shutil.copy2(HERE/'assets'/filename,kit/'originals'/filename)
for variant in ('blue','white'):
    svg=builder.portal('standalone-'+variant,variant)
    svg=svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="620" height="620" ')
    (kit/'graphics'/('support-window-'+variant+'.svg')).write_text(svg,encoding='utf-8')
for key,color,shape in (
    ('education','#1D55C9','<path d="M38 15H110L90 110H18Z"/><path d="M51 28H123L103 123H31Z"/><path d="M64 41H136L116 136H44Z"/>'),
    ('growth','#7250CB','<circle cx="60" cy="60" r="42"/><circle cx="78" cy="77" r="42"/><circle cx="96" cy="94" r="42"/>'),
    ('governance','#B94A1A','<path d="M60 12 108 60 60 108 12 60Z"/><path d="M80 27 128 75 80 123 32 75Z"/><path d="M100 42 148 90 100 138 52 90Z"/>')
):
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160" fill="none"><g stroke="{color}" stroke-width="2">{shape}</g></svg>'
    (kit/'graphics'/(key+'-motif.svg')).write_text(svg,encoding='utf-8')
tokens={
    'status':'proposal-not-approved',
    'identity':{'blue-sampled':'#337CFF','navy':'#0C1938','orange-proposed':'#F47B42','pale':'#F2F6FF','paper':'#FFFFFF'},
    'action':{'primary':'#1D55C9','on-primary':'#FFFFFF','focus':'#F47B42','disabled-bg':'#DFE5EF','disabled-text':'#68768B'},
    'text':{'primary':'#0C1938','secondary':'#56627A'},
    'series':{'education':'#1D55C9','growth':'#6443BA','governance':'#F47B42'},
    'feedback':{'success':'#1D6B4F','warning':'#835419','error':'#B23932'},
    'motion-ms':{'feedback':180,'structure':500,'layer-delay':120},
    'spacing-px':[4,8,12,16,24,32,48,64],
    'font':{'chinese':['Microsoft YaHei','PingFang SC','Noto Sans CJK SC','sans-serif'],'latin':['Bahnschrift','Segoe UI','sans-serif']}
}
(kit/'tokens'/'tokens.json').write_text(json.dumps(tokens,ensure_ascii=False,indent=2),encoding='utf-8')
css='/* WQT VI V2 proposal. Source identity blue sampled from an existing logo. */\n:root {\n'
for group,values in tokens.items():
    if isinstance(values,dict):
        for key,value in values.items():
            if isinstance(value,str) and value.startswith('#'):
                css+=f'  --wqt-{group}-{key}: {value};\n'
css+='  --wqt-motion-feedback: 180ms;\n  --wqt-motion-structure: 500ms;\n}\n'
(kit/'tokens'/'tokens.css').write_text(css,encoding='utf-8')
for i in range(1,11):
    shutil.copy2(OUT/f'board-{i:02d}.png',kit/'boards'/f'board-{i:02d}.png')
shutil.copy2(OUT/'WQT-VI-Proposal-V2.pdf',kit/'WQT-VI-Proposal-V2.pdf')
readme='''# 伍仟天 VI V2 · 可评审资产包

本轮基于四份实际读取的企业材料，交付 10 张展板、合并 PDF、原样复用的企业/IP 资产、辅助图形 SVG 和色彩/动效 tokens。

## 使用范围

这是设计提案，不是已验收品牌规范。企业简洁蓝色标识来自用户提供的项目介绍 PDF 第 1 页内嵌 PNG；组合版与小伍来自项目既有资产。未重新绘制、换色、拉伸或生成这些身份资产。其他图形、辅助色、版式和组合为本轮提案。

graphics 中 support-window 为辅助视觉母题；education/growth/governance 为系列图案，均不作为新的企业或产品 Logo。白色版本适配深背景，蓝色版本适配浅背景。

tokens 同时区分识别蓝和行动蓝。小号白字置于 #1D55C9，正文使用深靛蓝；不要直接在亮蓝或橙底上使用小白字。状态配合文字，不只依靠色彩。

## 已检查的文字对比

- 白 / 行动蓝：6.57:1。
- 深靛蓝 / 品牌蓝：4.51:1。
- 深靛蓝 / 共益橙：6.40:1。

## 版本与事实

产品分级和成熟度暂依《产品官方介绍》revision 86：教育支持市场化中，成长支持与技术治理开发测试中。未填造案例、经营数据或真实测评分数。3594/3459/3495 暂不进入图形与命名系统。

展板使用本机字体预览，资产包不分发字体。PDF 为矢量/位图混合的审阅稿，不是印刷出血稿；正式生产仍需品牌原始矢量文件、字体授权、CMYK/专色、出血与最小尺寸校准。

## 来源

- 产品官方介绍：https://sm41ixlt49.feishu.cn/docx/Xaeld0SewoSUEZxtnImcmFc8n3f
- 公司宣传折页：https://sm41ixlt49.feishu.cn/file/BikibZhrpovlfexr1iGcv8tEnPc
- 单页：https://sm41ixlt49.feishu.cn/file/QacobU4o3ob71Rxax3ac2H0xnvU
- 项目介绍：https://sm41ixlt49.feishu.cn/file/DAtZbBEEvoFZqDxY1OUcFZrLnJA

未打包原始资方 PDF、人员履历或企业登录信息。
'''
(kit/'README.md').write_text(readme,encoding='utf-8')
zip_path=OUT/'WQT-VI-V2-Asset-Kit.zip'
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED) as archive:
    for f in sorted(kit.rglob('*')):
        if f.is_file():archive.write(f,f.relative_to(kit))
print(json.dumps({'asset_files':len([p for p in kit.rglob('*') if p.is_file()]),'zip':str(zip_path),'bytes':zip_path.stat().st_size},ensure_ascii=True))
