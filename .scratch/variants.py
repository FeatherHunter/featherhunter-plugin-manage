# -*- coding: utf-8 -*-
from PIL import Image
import os
src = r"D:\dsh-plugin\featherhunter-plugin-manage\.scratch\collage-sample.png"
im = Image.open(src).convert("RGB")
outdir = r"D:\dsh-plugin\featherhunter-plugin-manage\.scratch"
def rep(tag, img, ext, **kw):
    p = os.path.join(outdir, "collage-" + tag + "." + ext)
    img.save(p, **kw)
    n = os.path.getsize(p)
    print(f"{tag:14s} {img.width}x{img.height} ratio {img.width/img.height:.3f}  {n/1024/1024:.2f} MB  ({n} B)")
    return n
rep("native-png", im, "PNG", optimize=True)
for w in (2400, 2000):
    h = round(im.height * w / im.width)
    r = im.resize((w, h), Image.LANCZOS)
    rep(f"w{w}-png", r, "PNG", optimize=True)
    rep(f"w{w}-jpg88", r, "JPEG", quality=88, optimize=True, progressive=True)
rep("native-jpg88", im, "JPEG", quality=88, optimize=True, progressive=True)
