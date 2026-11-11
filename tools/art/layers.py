# Общий разбор листов: манекен (синий) — опора, всё несинее — слой детали. Совмещаем каждую клетку с эталоном.
import numpy as np, sys, json
from PIL import Image
from scipy import ndimage as ndi
C = 682
def load(path):
    im = np.asarray(Image.open(path).convert('RGBA')).astype(np.float32) / 255
    n = im.shape[0] // 3
    cells = [im[r*n:(r+1)*n, k*n:(k+1)*n] for r in range(3) for k in range(3)]
    if n != C: cells = [np.asarray(Image.fromarray((c*255).astype(np.uint8)).resize((C, C), Image.LANCZOS)).astype(np.float32)/255 for c in cells]
    return cells
def masks(c):
    rgb, a = c[..., :3], c[..., 3]
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = np.where(mx > 1e-3, (mx - mn) / np.maximum(mx, 1e-3), 0)
    blue = np.clip((sat - 0.25) / 0.25, 0, 1) * (rgb[..., 2] >= mx - 1e-3)
    return a * blue, a * (1 - blue)
def down(m, f): return np.asarray(Image.fromarray((np.clip(m, 0, 1)*255).astype(np.uint8)).resize((C//f, C//f), Image.BILINEAR)).astype(np.float32)/255 > 0.5
BASE = load('hair1.png')[0]; BASE_BLUE = masks(BASE)[0]
def place(m, s, dx, dy, n):
    z = ndi.zoom(m.astype(np.float32), s, order=1) > 0.5; out = np.zeros((n, n), bool); k = z.shape[0]
    y0 = (n - k)//2 + dy; x0 = (n - k)//2 + dx
    ys, xs = max(0, y0), max(0, x0); ye, xe = min(n, y0 + k), min(n, x0 + k)
    if ye > ys and xe > xs: out[ys:ye, xs:xe] = z[ys - y0: ye - y0, xs - x0: xe - x0]
    return out
def fit(c):
    blue, other = masks(c)
    best = None
    for f, scales, rng, step in [(8, np.arange(0.84, 1.17, 0.02), 12, 1), (2, None, 6, 1)]:
        B0 = down(BASE_BLUE, f); b = down(blue, f); h = down(other, f); n = C // f
        if scales is None:
            s0, dx0, dy0 = best[1], best[2] * 4, best[3] * 4; scales = [s0 - 0.01, s0, s0 + 0.01]; cand = [(s, dx0 + i, dy0 + j) for s in scales for i in range(-rng, rng + 1, step) for j in range(-rng, rng + 1, step)]
        else: cand = [(s, i, j) for s in scales for i in range(-rng, rng + 1) for j in range(-rng, rng + 1)]
        best = None
        for s, dx, dy in cand:
            cb = place(b, s, dx, dy, n); ch = place(h, s, dx, dy, n)
            sc = (cb & B0).sum() - 3.0 * (cb & ~B0).sum() - 1.0 * (B0 & ~cb & ~ch).sum()
            if best is None or sc > best[0]: best = (sc, float(s), dx, dy, f)
    sc, s, dx, dy, f = best
    return s, dx * f, dy * f, sc / max(1, down(BASE_BLUE, 2).sum())
def warp(img, s, dx, dy):
    # перенести клетку в систему эталона: масштаб вокруг центра и сдвиг
    out = np.zeros_like(img)
    for ch in range(img.shape[2]):
        z = ndi.zoom(img[..., ch], s, order=1); k = z.shape[0]; y0 = (C - k)//2 + dy; x0 = (C - k)//2 + dx
        ys, xs = max(0, y0), max(0, x0); ye, xe = min(C, y0 + k), min(C, x0 + k)
        out[ys:ye, xs:xe, ch] = z[ys - y0: ye - y0, xs - x0: xe - x0]
    return out
def extract(path, names, outdir='parts', skin=0):
    import os; os.makedirs(outdir, exist_ok=True); rep = {}
    for c, name in zip(load(path), names):
        if not name: continue
        s, dx, dy, q = fit(c); blue, other = masks(c)
        layer = np.dstack([c[..., :3], other]); layer = warp(layer, s, dx, dy)
        Image.fromarray((np.clip(layer, 0, 1)*255).astype(np.uint8)).save(f'{outdir}/{name}.png')
        if skin:
            # «лепка» кожи вокруг детали (веки, складки): где синий манекен отличается от эталона рядом с деталью
            cw = warp(c, s, dx, dy); bw = warp(blue[..., None], s, dx, dy)[..., 0]
            diff = np.abs(cw[..., 2] - BASE[..., 2]) * (bw > 0.9) * (BASE_BLUE > 0.9)
            near = ndi.binary_dilation(layer[..., 3] > 0.3, iterations=skin) ; inside = ndi.binary_erosion(BASE_BLUE > 0.9, iterations=10)
            al = ndi.gaussian_filter(np.clip((diff - 0.03) / 0.05, 0, 1) * near * inside, 1.5)
            Image.fromarray((np.clip(np.dstack([cw[..., :3], al]), 0, 1)*255).astype(np.uint8)).save(f'{outdir}/{name}_skin.png')
        rep[name] = dict(scale=round(s, 3), dx=int(dx), dy=int(dy), fit=round(float(q), 3)); print(name, rep[name])
    return rep
if __name__ == '__main__':
    extract(sys.argv[1], sys.argv[2].split(','), sys.argv[3] if len(sys.argv) > 3 else 'parts', int(sys.argv[4]) if len(sys.argv) > 4 else 0)
