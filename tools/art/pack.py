# Запекание слоёв для сервера: всё, что не зависит от выбора пользователя (нормировка тени, сдвиги, растушёвка), считается здесь.
# На выходе pack/ : атласы PNG (la_N.png — тень+альфа, rgba_N.png — готовый цвет) и index.json с координатами.
import numpy as np, os, json, io, sys, glob
from PIL import Image
from scipy import ndimage as ndi
from av import *
C2 = int(sys.argv[1]) if len(sys.argv) > 1 else 400
LIMIT = int(sys.argv[2]) if len(sys.argv) > 2 else 470000
K = C2 / C; P80 = np.percentile(BASE[..., 2][BASE_BLUE > 0.9], 80); INB = (BASE_BLUE > 0.5).astype(np.float32)
def rs(a):  # один канал float → C2
    return np.asarray(Image.fromarray(a.astype(np.float32), 'F').resize((C2, C2), Image.LANCZOS))
def small_rgba(L):
    a = np.clip(rs(L[..., 3]), 0, 1); out = np.zeros((C2, C2, 4), np.float32); out[..., 3] = a
    for c in range(3): out[..., c] = np.clip(rs(L[..., c] * L[..., 3]) / np.maximum(a, 1e-3), 0, 1)
    return (out * 255 + 0.5).astype(np.uint8)
def small_la(shade, alpha):
    a = np.clip(rs(alpha), 0, 1); s = np.clip(rs(shade * alpha) / np.maximum(a, 1e-3), 0, 1.5)
    return np.dstack([np.clip(s * 170 + 0.5, 0, 255), a * 255 + 0.5]).astype(np.uint8)
def shade_grey(L, pct):
    lum = L[..., :3] @ LUM; a = L[..., 3]; ref = np.percentile(lum[a > 0.9], pct) if (a > 0.9).sum() > 50 else 0.7
    return lum / ref
def green(L, pct):
    rgb = L[..., :3]; mx, mn = rgb.max(-1), rgb.min(-1); sat = np.where(mx > 1e-3, (mx - mn) / np.maximum(mx, 1e-3), 0)
    g = np.clip((sat - 0.3) / 0.25, 0, 1) * (rgb[..., 1] >= mx - 1e-3)
    ref = np.percentile(rgb[..., 1][g > 0.8], pct) if (g > 0.8).sum() > 50 else 0.6
    return rgb[..., 1] / ref, g
def shift(L, dy, dx): return ndi.shift(L, (dy, dx, 0), order=1, mode='constant') if (dy or dx) else L
def scale(L, ky, kx, cy_, cx_): return np.dstack([ndi.affine_transform(L[..., c], [1 / ky, 1 / kx], offset=[cy_ - cy_ / ky, cx_ - cx_ / kx], order=1) for c in range(L.shape[2])])
S = lambda blur, dy, dx, k: [round(blur * K, 2), round(dy * K, 2), round(dx * K, 2), k]
def clean(L, n):
    """Мусор разбора: тёмно-синие складки манекена (шея, уши), попавшие в слой, строка по краю клетки и «туман» с почти нулевой альфой."""
    if n.startswith('f_'): return L
    L = L.copy(); a = np.where(L[..., 3] < 0.04, 0, L[..., 3])
    lab, k = ndi.label(a > 0.15)
    if k:
        idx = range(1, k + 1); area = ndi.sum(np.ones_like(a), lab, idx); sl = ndi.find_objects(lab)
        mr, mg, mb = (ndi.mean(L[..., c], lab, idx) for c in range(3)); kill = []
        for i in range(k):
            h = sl[i][0].stop - sl[i][0].start; w = sl[i][1].stop - sl[i][1].start
            blue = mb[i] > mr[i] + 0.05 and mb[i] > mg[i] + 0.03
            if (area[i] < 500 and blue) or (h <= 4 and w > 30) or area[i] < 6: kill.append(i + 1)
        a = np.where(ndi.binary_dilation(np.isin(lab, kill), iterations=2), 0, a)
    a = np.where(ndi.binary_dilation(a > 0.15, iterations=6), a, 0)
    if n.split('_')[0] in ('pet', 'p') and n != 'pet_aquarium':
        # синяя кромка там, где питомец или предмет перекрывал манекен (то же правило продублировано в server/ava.js)
        a = np.where((L[..., 0] < 0.43) & (L[..., 2] > L[..., 0] + 0.16) & (L[..., 2] > L[..., 1] + 0.1) & (L[..., 1] >= L[..., 0] - 0.03), 0, a)
    L[..., 3] = a; return L
parts = {}
def add(name, raw=None, tint=None, mod=None, **meta): parts[name] = dict(raw=raw, tint=tint, mod=mod, meta=meta)
add('body', tint=small_la(SHADE_B, BASE_BLUE), src='skin', hi=0.5)
names = sorted(os.path.basename(p)[:-4] for p in glob.glob('parts/*.png'))
for n in names:
    if n.endswith('_skin') or n.endswith('_hand') or n == 'bald': continue
    L = clean(part(n), n); pre = n.split('_')[0]
    if pre == 'h': add(n, tint=small_la(shade_grey(L, 75), L[..., 3]), src='hair', hi=0.5, sh=S(6, 8, 3, 0.3))
    elif pre in ('b', 'bd'):
        if n in BROW_SY: L = scale(L, BROW_SY[n], 1, np.where(L[..., 3] > 0.5)[0].mean(), 0)
        add(n, tint=small_la(shade_grey(L, 75), L[..., 3]), src='brow' if pre == 'b' else 'beard', hi=0.5, sh=S(4, 5, 2, 0.22))
    elif pre == 'n':
        L = shift(L, NOSE_DY.get(n, 18), 0); sh = shade_grey(L, 45); a = L[..., 3]
        if n in NOSE_SCALE:
            ay, ax = np.where(a > 0.5); T = scale(np.dstack([sh, a]), NOSE_SCALE[n], NOSE_SCALE[n], ay.mean(), ax.mean()); sh, a = T[..., 0], T[..., 1]
        a = np.clip(ndi.gaussian_filter(ndi.minimum_filter(a, 5), 1.5) * 1.1, 0, 1)
        add(n, tint=small_la(sh, a), src='nose', hi=0.4, sh=S(4, 5, 2, 0.1))
    elif pre == 'e':
        s, g = green(L, 70); sk = part(n + '_skin'); mod = None
        if sk is not None:
            r = np.clip(ndi.gaussian_filter(sk[..., 2] / np.maximum(BASE[..., 2], 0.05), 1.0), 0.55, 1.2) - 1
            mod = np.clip(rs(r * sk[..., 3] * INB) * 250 + 128.5, 0, 255).astype(np.uint8)
        add(n, raw=small_rgba(L), tint=small_la(s, g * L[..., 3]), mod=mod, src='iris', hi=0.6)
    elif pre == 'o':
        L = L.copy(); L[..., 3] = np.clip((L[..., 3] - 0.25) / 0.6, 0, 1); s, g = green(L, 75)
        add(n, raw=small_rgba(L), tint=small_la(s, g * L[..., 3]), src='shirt', hi=0.35, sh=S(5, -6, 0, 0.25))
    elif pre in ('g', 'hat') and n not in RAW:
        meta = dict(src='glasses' if pre == 'g' else 'hat', hi=0.5, sh=S(4, 5, 2, 0.22))
        add(n, tint=small_la(shade_grey(L, 60), L[..., 3]), **meta)
    elif pre == 'nk':
        v = np.clip((L[..., 2] - np.maximum(L[..., 0], L[..., 1]) - 0.03) / 0.08, 0, 1); L = L.copy(); L[..., 3] *= 1 - v; add(n, raw=small_rgba(L))
    elif pre == 'p':
        dx, dy = (-44, 30) if 'sign' in n else (PROP_DX, PROP_DY)
        add(n, raw=small_rgba(shift(L, dy, dx)), sh=S(5, 4, -3, 0.2))
        H = part(n + '_hand')
        if H is not None: H = shift(H, dy, dx); add(n + '_hand', tint=small_la(H[..., 2] / P80, H[..., 3]), src='skin', hi=0.5, sh=S(5, 4, -3, 0.25))
    elif pre == 'pet': add(n, raw=small_rgba(shift(L, 0, PET_DX.get(n, 30))), sh=S(5, 4, 3, 0.2))
    elif n == 'f_blush': add(n, raw=small_rgba(np.dstack([np.broadcast_to(np.array([0.96, 0.42, 0.52], np.float32), (C, C, 3)), ndi.gaussian_filter(L[..., 3], 3) * INB * 0.5])))
    elif n == 'f_moles': add(n, raw=small_rgba(np.dstack([np.broadcast_to(np.array([0.27, 0.16, 0.11], np.float32), (C, C, 3)), L[..., 3] * INB])))
    elif n in ('f_freckles', 'f_wrinkles'):
        sv, k = (0.6, 0.8) if n == 'f_freckles' else (0.68, 0.75)
        add(n, tint=small_la(np.full((C, C), sv, np.float32), L[..., 3] * INB * k), src='skin', hi=0.5)
    else: add(n, raw=small_rgba(L))   # рот, маски, серьги, шапки и очки в своих цветах
    if pre == 'hat' and n not in NOCLIP:
        # нижний край шапки по колонкам — по нему подрезаются волосы
        ha = part(n)[..., 3] > 0.5; cols = ha.any(0); bottom = np.where(cols, C - 1 - np.argmax(ha[::-1], axis=0), 0).astype(np.float32)
        xs_ = np.where(cols)[0]; x0, x1 = xs_.min(), xs_.max()
        bottom[:x0] = bottom[x0:x0 + 12].max(); bottom[x1 + 1:] = bottom[x1 - 11:x1 + 1].max()
        bottom = ndi.gaussian_filter1d(bottom, 4)
        parts[n]['meta']['clip'] = [int(round(float(bottom[min(C - 1, int((x + 0.5) / K))]) * K)) for x in range(C2)]
# кадрирование и раскладка по атласам
items = []
for n, p in parts.items():
    for kind in ('raw', 'tint', 'mod'):
        a = p[kind]
        if a is None: continue
        m = (a[..., -1] > 0) if kind != 'mod' else (np.abs(a.astype(np.int16) - 128) > 1)
        if not m.any(): p[kind] = None; continue
        ys_, xs_ = np.where(m); y0, y1, x0, x1 = ys_.min(), ys_.max() + 1, xs_.min(), xs_.max() + 1
        crop = a[y0:y1, x0:x1]
        if kind == 'mod': crop = np.dstack([crop, np.full_like(crop, 255)])
        items.append(dict(name=n, kind=kind, arr=crop, ox=int(x0), oy=int(y0), fam='rgba' if kind == 'raw' else 'la'))
os.makedirs('pack', exist_ok=True)
for f in glob.glob('pack/*'): os.remove(f)
AW = 1024; index = {n: dict(p['meta']) for n, p in parts.items()}; files = []
def enc(arr): b = io.BytesIO(); Image.fromarray(arr, 'RGBA' if arr.shape[2] == 4 else 'LA').save(b, 'PNG', optimize=True); return b.getvalue()
for fam, ch in (('la', 2), ('rgba', 4)):
    its = sorted([i for i in items if i['fam'] == fam], key=lambda i: -i['arr'].shape[0]); shelves = []; cur = []; x = 0
    for it in its:
        w = it['arr'].shape[1]
        if x + w + 1 > AW and cur: shelves.append(cur); cur = []; x = 0
        it['x'] = x; cur.append(it); x += w + 1
    if cur: shelves.append(cur)
    def build(sh):
        H = sum(max(i['arr'].shape[0] for i in s) + 1 for s in sh); A = np.zeros((H, AW, ch), np.uint8); y = 0
        for s in sh:
            for i in s: h, w = i['arr'].shape[:2]; A[y:y + h, i['x']:i['x'] + w] = i['arr']; i['y'] = y
            y += max(i['arr'].shape[0] for i in s) + 1
        return A
    group = []; k = 0
    def flush(g):
        global k
        A = build(g); fn = f'{fam}_{len([f for f in files if f.startswith(fam)])}.png'; open('pack/' + fn, 'wb').write(enc(A)); files.append(fn)
        for s in g:
            for i in s: index[i['name']][i['kind']] = [fn, i['x'], i['y'], i['arr'].shape[1], i['arr'].shape[0], i['ox'], i['oy']]
    for s in shelves:
        if group and len(enc(build(group + [s]))) > LIMIT: flush(group); group = []
        group.append(s)
    if group: flush(group)
R = int(HEADW * 0.80 * K); cyc = int((TOP + int(HEADH * 0.595)) * K)   # кадр чуть выше центра: низ бюста уходит за край, сверху остаётся место под шапки; cxc = int(CX * K)
meta = dict(size=C2, crop=[cxc - R, cyc - R, 2 * R], files=files, parts=index)
json.dump(meta, open('pack/index.json', 'w'), separators=(',', ':'))
print(len(parts), 'parts', len(items), 'layers'); os.system('ls -la pack; du -sh pack')
