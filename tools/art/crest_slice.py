# Режет лист 3x3 на клетки для герба. Серые фигуры приводятся к одной яркости (медиана 178) — их красит фильтр в crest.js.
# python3 crest_slice.py лист.png имя1,...,имя9 [gray|color] [клетка=160]   («-» вместо имени — пропустить клетку)
import sys
from PIL import Image
import numpy as np
src, names, mode = sys.argv[1], sys.argv[2].split(','), (sys.argv[3] if len(sys.argv) > 3 else 'gray')
CELL = int(sys.argv[4]) if len(sys.argv) > 4 else 160
im = Image.open(src).convert('RGBA'); W, H = im.size
a = np.array(im)
for i, n in enumerate(names):
    if n == '-': continue
    r, c = divmod(i, 3)
    cell = a[r * H // 3:(r + 1) * H // 3, c * W // 3:(c + 1) * W // 3]
    ys, xs = np.where(cell[..., 3] > 24)
    crop = Image.fromarray(cell[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
    pad = 8 if mode == 'gray' else 4
    k = (CELL - 2 * pad) / max(crop.size)
    crop = crop.resize((max(1, round(crop.width * k)), max(1, round(crop.height * k))), Image.LANCZOS)
    out = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    out.paste(crop, ((CELL - crop.width) // 2, (CELL - crop.height) // 2))
    if mode == 'gray':
        o = np.array(out).astype(float)
        L = o[..., 0] * .299 + o[..., 1] * .587 + o[..., 2] * .114
        L = np.clip(L * (178.0 / np.median(L[o[..., 3] > 200])), 0, 255)
        o[..., 0] = o[..., 1] = o[..., 2] = L
        out = Image.fromarray(o.astype('uint8'))
    out.save(f'parts/{n}.png')
    print(n, crop.size)
