# -*- coding: utf-8 -*-
"""把印刷版 PDF 每张卡所在页渲染成图片，输出到 public/cards-pdf/<card_code>.webp"""
import pypdfium2 as pdfium
import os

PDF = r"D:/Documents/xwechat_files/wxid_ybn0uh3qmz1i22_fcb9/msg/file/2026-06/2026卡牌更新521印刷版.pdf"
OUT = r"C:/ArdenDev/wqt-auth-backend/public/cards-pdf"
os.makedirs(OUT, exist_ok=True)

# card_code -> PDF 页码（1-based），与 cards-pdf-map.js 一致
PAGE = {
    '2026B01':17,'2026B02':19,'2026B03':21,'2026B04':47,'2026B05':49,'2026B06':51,'2026B07':77,'2026B08':79,'2026B09':81,
    '2026P01':23,'2026P02':25,'2026P03':27,'2026P04':53,'2026P05':55,'2026P06':57,'2026P07':83,'2026P08':85,'2026P09':87,
    '2026S01':29,'2026S02':31,'2026S03':33,'2026S04':59,'2026S05':61,'2026S06':63,'2026S07':89,'2026S08':91,'2026S09':93,
    '2026E01':35,'2026E02':37,'2026E03':39,'2026E04':65,'2026E05':67,'2026E06':69,'2026E07':95,'2026E08':97,'2026E09':99,
    '2026D01':41,'2026D02':43,'2026D03':45,'2026D04':71,'2026D05':73,'2026D06':75,'2026D07':101,'2026D08':103,'2026D09':105,
}

pdf = pdfium.PdfDocument(PDF)
n = 0
for code, pg in PAGE.items():
    page = pdf[pg - 1]
    bmp = page.render(scale=2.4)
    pil = bmp.to_pil().convert("RGB")
    fn = os.path.join(OUT, f"{code}.webp")
    pil.save(fn, "WEBP", quality=82, method=6)
    n += 1
    print(code, "p%d" % pg, "->", os.path.getsize(fn) // 1024, "KB")
print("done", n, "images ->", OUT)
