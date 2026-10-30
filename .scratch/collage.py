# -*- coding: utf-8 -*-
from PIL import Image
import os, sys
base = r"D:\dsh-plugin\dsh-mattpocock-skills-deck\assets\readme"
names = ["中文-深色-右侧面板-列表-列表.png", "中文-深色-右侧面板-列表-ISSUE详情.png", "中文-深色-右侧面板-技能页面-列表.png"]
ims = [Image.open(os.path.join(base, n)).convert("RGB") for n in names]
for im, n in zip(ims, names):
    print(n, im.size)
H = max(im.height for im in ims)
GAP = 24
# 取左上角像素作背景色（深色主题）
bg = ims[0].getpixel((2, 2))
scaled = []
for im in ims:
    if im.height != H:
        w = round(im.width * H / im.height)
        im = im.resize((w, H), Image.LANCZOS)
    scaled.append(im)
W = sum(im.width for im in scaled) + GAP * (len(scaled) - 1)
out = Image.new("RGB", (W, H), bg)
x = 0
for im in scaled:
    out.paste(im, (x, 0))
    x += im.width + GAP
dst = r"D:\dsh-plugin\featherhunter-plugin-manage\.scratch\collage-sample.png"
os.makedirs(os.path.dirname(dst), exist_ok=True)
out.save(dst, "PNG", optimize=True)
size = os.path.getsize(dst)
print("OUT", out.size, "ratio", round(out.width / out.height, 3), "bytes", size)
