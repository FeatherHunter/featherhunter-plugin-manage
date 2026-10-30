# normalize-contact.py — 三群二维码源头图统一画布（解决三图高宽比不一导致的阶梯）
# 做法：等宽缩放 + 各自取边色 + 居中补齐到同一画布；不裁剪任何像素。
# 用法：换微信图后先跑 python scripts/normalize-contact.py，再跑 node scripts/sync-contact.cjs
import os, statistics
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = ['contact-qq-permanent.jpg', 'contact-wechat-weekly.png', 'contact-feishu-permanent.png']
WIDTH = 900

def edge_color(im):
    w, h = im.size
    px = im.load()
    ys = range(int(h * 0.2), int(h * 0.8), max(1, h // 200))
    rs, gs, bs = [], [], []
    for x in (5, w - 6):
        for y in ys:
            r, g, b = px[x, y][:3]
            rs.append(r); gs.append(g); bs.append(b)
    return (int(statistics.median(rs)), int(statistics.median(gs)), int(statistics.median(bs)))

scaled = []
for f in SOURCES:
    im = Image.open(os.path.join(ROOT, f)).convert('RGB')
    h = round(im.size[1] * WIDTH / im.size[0])
    im = im.resize((WIDTH, h), Image.LANCZOS)
    scaled.append((f, im, edge_color(im)))

H = max(im.size[1] for _, im, _ in scaled)
print('canvas:', WIDTH, 'x', H)
for f, im, bg in scaled:
    canvas = Image.new('RGB', (WIDTH, H), bg)
    canvas.paste(im, (0, (H - im.size[1]) // 2))
    dst = os.path.join(ROOT, f)
    if f.endswith('.jpg'):
        canvas.save(dst, quality=92)
    else:
        canvas.save(dst, optimize=True)
    print(f, im.size, 'bg=', bg, '->', (WIDTH, H))
