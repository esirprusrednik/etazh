# Фоновая петля для заставки с лестницей: лёгкий «шагающий» мотивчик, 96 уд/мин, 8 долей = ровно 5 секунд — как видео.
# Туба шагает по басу, арфа отвечает на слабую долю, колокольчики поднимаются «по ступенькам», деревяшка отбивает шаги.
# Сэмплы — VSCO 2 CE и Free-SFX (CC0). Запуск из tools/sounds: python3 climb_loop.py → public/sounds/climb_loop.mp3
# В файле 5,3 с: петля — с 0,05 по 5,05 с (хвосты реверберации заходят с прошлого круга, шва нет).
import numpy as np, sys, subprocess, os, wave
sys.path.insert(0, '.')
import lib
from lib import Mix, SR, note, hit
OUT = '../../public/sounds/climb_loop.mp3'
SFX = os.path.join(os.path.dirname(lib.ROOT), 'EternityForest_Free-SFX')
TUB = 'Brass/Tuba/stac/*'; HARP = 'Strings/Harp/*'; GL = 'Percussion/Glock/*'; CL = 'Woodwinds/Clarinet/stac/*'
W = SFX + '/Superpowers/prehistoric-platformer/wood-%d.opus'
B = 60 / 96; BAR = 8 * B
BASS = [(48, 55), (45, 52), (41, 48), (43, 50)]
CH = [(60, 64, 67), (60, 64, 69), (60, 65, 69), (59, 62, 67)]
MEL = [(0, 76), (1, 79), (2, 81), (3, 84), (4, 81), (5, 77), (6, 79), (7, 83), (7.5, 86)]
def bar(m, t0):
    for k in range(4):
        r, f = BASS[k]
        m.add(note(TUB, r, .34), t0 + (2 * k) * B, 0.62, -0.1); m.add(note(TUB, f, .26), t0 + (2 * k + 1) * B, 0.42, -0.1)
        for off in (0.5, 1.5):
            for i, n in enumerate(CH[k]): m.add(note(HARP, n, .7), t0 + (2 * k + off) * B + i * 0.012, 0.2, 0.25)
    for bt, n in MEL: m.add(note(GL, n, 1.0, off=0), t0 + bt * B, 0.17 if bt != 7.5 else 0.11, -0.3 + 0.07 * bt)
    for k, (bt, n) in enumerate([(1.5, 72), (3.5, 76), (5.5, 72), (6.5, 74)]): m.add(note(CL, n, .16), t0 + bt * B, 0.2, 0.4)
    for k in range(8):
        m.add(hit(W % (1 + k % 2), dur=0.09, fade=0.06), t0 + k * B, 0.34 if k % 2 == 0 else 0.24, (-0.2, 0.2)[k % 2])
        m.add(hit(W % 4, dur=0.05, fade=0.04), t0 + (k + 0.5) * B, 0.09, 0.35)
    for k in (0, 4): m.add(hit('Percussion/BDrumNewhit_v7_rr1_Sum.wav', dur=0.5, fade=0.3), t0 + k * B, 0.22)
m = Mix(3 * BAR + 0.5)
for i in range(3): bar(m, i * BAR)
m.render(OUT, wet=0.2, rt=1.3, tail=0.0)
wav = OUT.replace('.mp3', '.wav')
with wave.open(wav) as w: a = np.frombuffer(w.readframes(w.getnframes()), '<i2').reshape(-1, 2).copy()
s = int((BAR - 0.05) * SR); e = s + int(5.3 * SR); seg = a[s:e].astype(np.float32)
fl = int(0.02 * SR); seg[:fl] *= np.linspace(0, 1, fl)[:, None]; seg[-fl:] *= np.linspace(1, 0, fl)[:, None]
with wave.open(wav, 'wb') as w: w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(seg.astype('<i2').tobytes())
subprocess.run(['ffmpeg', '-v', 'quiet', '-y', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '112k', OUT], check=True); os.remove(wav)
x = seg.mean(1) / 32768; print('dur', round(len(x) / SR, 3), 'rms', round(20 * np.log10(np.sqrt((x ** 2).mean())), 1), 'kb', os.path.getsize(OUT) // 1024)
# шов: насколько конец петли похож на её начало
A = x[int(0.05 * SR):int(0.05 * SR) + 2000]; Bz = x[int(5.05 * SR):int(5.05 * SR) + 2000]; print('seam corr', round(float(np.corrcoef(A, Bz)[0, 1]), 3))
