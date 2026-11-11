# Сборка аватара из слоёв: окраска по «тени», слои в общей системе координат эталонного манекена
import numpy as np, os
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from layers import C, BASE, BASE_BLUE
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)
def hexc(h): return np.array([int(h[i:i+2], 16) for i in (1, 3, 5)], np.float32) / 255
def tint(shade, col, hi=0.5):
    s = shade[..., None]; out = col * np.clip(s, 0, 1) ** 0.9
    return np.clip(out + (1 - out) * np.clip(s - 1, 0, 1) * hi, 0, 1)
def part(name):
    p = f'parts/{name}.png'
    return np.asarray(Image.open(p).convert('RGBA')).astype(np.float32) / 255 if os.path.exists(p) else None
def over(dst, src, k=1.0):
    a = src[..., 3:4] * k; dst[..., :3] = src[..., :3] * a + dst[..., :3] * (1 - a); dst[..., 3:4] = a + dst[..., 3:4] * (1 - a); return dst
def contact(dst, layer, blur=5, off=(6, 2), k=0.25):
    sh = ndi.shift(ndi.gaussian_filter(layer[..., 3], blur), off, order=1) * k * (dst[..., 3] > 0.5)
    dst[..., :3] *= (1 - sh[..., None] * (1 - layer[..., 3:4])); return dst
SHADE_B = BASE[..., 2] / np.percentile(BASE[..., 2][BASE_BLUE > 0.9], 80)
def grey_tinted(layer, col, hi=0.5, pct=75):
    lum = layer[..., :3] @ LUM; a = layer[..., 3]
    ref = np.percentile(lum[a > 0.9], pct) if (a > 0.9).sum() > 50 else 0.7
    return np.dstack([tint(lum / ref, col, hi), a])
def skin_tinted(layer, col):
    return np.dstack([tint(layer[..., 2] / np.percentile(BASE[..., 2][BASE_BLUE > 0.9], 80), col), layer[..., 3]])
def eyes_colored(layer, iris):
    rgb = layer[..., :3]; mx, mn = rgb.max(-1), rgb.min(-1); sat = np.where(mx > 1e-3, (mx - mn) / np.maximum(mx, 1e-3), 0)
    g = np.clip((sat - 0.3) / 0.25, 0, 1) * (rgb[..., 1] >= mx - 1e-3)
    ref = np.percentile(rgb[..., 1][g > 0.8], 70) if (g > 0.8).sum() > 20 else 0.6
    col = tint(rgb[..., 1] / ref, iris, 0.6)
    return np.dstack([col * g[..., None] + rgb * (1 - g[..., None]), layer[..., 3]])
# геометрия эталона
ys, xs = np.where(BASE_BLUE > 0.5); TOP = ys.min()
W = np.array([(BASE_BLUE[y] > 0.5).sum() for y in range(TOP, ys.max())]); HEADW = W[: len(W)//2].max()
YMAX = int(np.argmax(W[: len(W)//2])) + TOP; NECK = YMAX + int(np.argmin(W[YMAX-TOP: YMAX-TOP + int(HEADW*0.9)]))
CX = int(xs[(ys > TOP) & (ys < YMAX)].mean()); HEADH = NECK - TOP
yy, xx = np.mgrid[0:C, 0:C]
SHIRT = ndi.gaussian_filter((yy > NECK + int(HEADW*0.10) - 18 * np.cos(np.clip((xx - CX) / (HEADW * 0.34), -1.57, 1.57))).astype(np.float32), 1.2)
OFFSET = {'nose': (0, 18)}
NOCLIP = {'hat_headset', 'hat_crown'}
RAW = {'hat_crown'}
def avatar(look):
    skin, hairc, shirtc = hexc(look['skin']), hexc(look['hair']), hexc(look['shirt'])
    out = np.zeros((C, C, 4), np.float32)
    body = tint(SHADE_B, skin) * (1 - SHIRT[..., None]) + tint(SHADE_B, shirtc, 0.35) * SHIRT[..., None]
    out = over(out, np.dstack([body, BASE_BLUE]))
    hat = part(look['hat']) if look.get('hat') else None
    for key, kind in [('mouth', 'raw'), ('beard', 'hair'), ('nose', 'skin'), ('eyes', 'eyes'), ('brows', 'hair'), ('hairstyle', 'hair'), ('glasses', 'hair'), ('hat', 'hat')]:
        n = look.get(key)
        if not n: continue
        L = part(n)
        if L is None: continue
        if key == 'hairstyle' and hat is not None and look['hat'] not in NOCLIP:
            # волосы под шапкой: в колонках шапки видно только то, что ниже её края; по бокам — только ниже среднего края
            ha = hat[..., 3] > 0.5; cols = ha.any(0); bottom = np.where(cols, C - 1 - np.argmax(ha[::-1], axis=0), 0)
            lvl = int(np.median(bottom[cols])) if cols.any() else 0
            lim = np.where(cols, bottom, lvl)[None, :]
            L = L.copy(); L[..., 3] *= ndi.gaussian_filter((yy > lim - 2).astype(np.float32), 1.0)
        if kind == 'hat': kind = 'raw' if n in RAW else 'hair'
        if key in OFFSET: L = ndi.shift(L, (OFFSET[key][1], OFFSET[key][0], 0), order=1, mode='constant')
        sk = part(n + '_skin')
        if sk is not None: out = over(out, skin_tinted(sk, skin))
        if kind == 'hair': L = grey_tinted(L, hexc(look.get(key + 'Color', look['hair'])), 0.5, 75 if key not in ('hat', 'glasses') else 60)
        elif kind == 'skin': L = grey_tinted(L, skin * 0.97, 0.4, 60)
        elif kind == 'eyes': L = eyes_colored(L, hexc(look.get('iris', '#6B4226')))
        if kind in ('hair', 'skin'): out = contact(out, L, 4 if key != 'hairstyle' else 6, (5, 2) if key != 'hairstyle' else (8, 3), 0.22 if key != 'hairstyle' else 0.3)
        out = over(out, L)
    return out
def framed(av, size, ring, bg):
    R = int(HEADW * 0.80); cy = TOP + int(HEADH * 0.66)
    big = np.zeros((C + 2*R, C + 2*R, 4), np.float32); big[R:R+C, R:R+C] = av
    pad = big[cy: cy + 2*R, CX: CX + 2*R]; k = 3; S = size * k
    img = Image.fromarray((np.clip(pad, 0, 1) * 255).astype(np.uint8)).resize((S, S), Image.LANCZOS)
    disc = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(disc)
    d.ellipse([0, 0, S - 1, S - 1], fill=ring); d.ellipse([S*0.045, S*0.045, S*0.955, S*0.955], fill=bg)
    m = Image.new('L', (S, S), 0); ImageDraw.Draw(m).ellipse([S*0.045, S*0.045, S*0.955, S*0.955], fill=255)
    inner = Image.new('RGBA', (S, S), (0, 0, 0, 0)); inner.alpha_composite(img)
    disc.alpha_composite(Image.composite(inner, Image.new('RGBA', (S, S), (0, 0, 0, 0)), m))
    return disc.resize((size, size), Image.LANCZOS)
def sheet(looks, out, big=230, sm=56, cols=5):
    rows = (len(looks) + cols - 1) // cols
    Wd = 40 + cols * (big + 24); H = 40 + rows * (big + 24) + sm + 50
    im = Image.new('RGB', (Wd * 2, H), (242, 244, 248))
    avs = [avatar(l) for l in looks]
    for t, (page, tile) in enumerate([((242, 244, 248), (220, 230, 250, 255)), ((14, 21, 48), (38, 52, 96, 255))]):
        ImageDraw.Draw(im).rectangle([t * Wd, 0, t * Wd + Wd, H], fill=page)
        for n, (l, av) in enumerate(zip(looks, avs)):
            r, k = divmod(n, cols); f = framed(av, big, l.get('ring', '#F5B82E'), tile); im.paste(f, (t * Wd + 30 + k * (big + 24), 30 + r * (big + 24)), f)
            s = framed(av, sm, l.get('ring', '#F5B82E'), tile); im.paste(s, (t * Wd + 30 + n * (sm + 14), H - sm - 28), s)
    im.save(out, quality=85); print(im.size)
