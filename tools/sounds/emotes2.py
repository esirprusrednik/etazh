# Звуки второго набора реакций морского боя (ситуации): оркестровые сэмплы VSCO 2 CE, пушка и всплеск из Free-SFX (CC0),
# пузыри, свисток и чайка синтезированы. Запуск из tools/sounds: python3 emotes2.py — пишет в public/sounds
import numpy as np, sys, subprocess, os
sys.path.insert(0, '.')
import lib
from lib import Mix, SR, note, hit
rng = np.random.default_rng(11)
OUT = '../../public/sounds/'
SFX = os.path.join(os.path.dirname(lib.ROOT), 'EternityForest_Free-SFX')
TRM = 'Brass/Trumpet/harmonM-sus/*'; TST = 'Brass/Trumpet/stac/*'; TSV = 'Brass/Trumpet/susvib/*'
TBS = 'Brass/OldTrombone/Sustain/*'; TBF = 'Brass/OldTrombone/Fall/*'; TBV = 'Brass/OldTrombone/Vibrato/*'
TUB = 'Brass/Tuba/stac/*'; HRN = 'Brass/F Horn/*/*'; CL = 'Woodwinds/Clarinet/stac/*'; BSN = 'Woodwinds/Bassoon/stac/*'
HARP = 'Strings/Harp/*'; GL = 'Percussion/Glock/*'
st = lambda x: np.stack([x, x], 1).astype(np.float32)
def bend(a, c0, c1, curve=1.0):
    n = len(a); t = np.linspace(0, 1, n) ** curve
    idx = np.cumsum(2 ** ((c0 + (c1 - c0) * t) / 1200)); idx = idx[idx < n - 1]
    return np.stack([np.interp(idx, np.arange(n), a[:, c]) for c in (0, 1)], 1).astype(np.float32)
def env(a, att=0.01, rel=0.06, dur=None):
    a = a.copy()
    if dur: a = a[:int(dur * SR)]
    na, nr = min(int(att * SR), len(a)), min(int(rel * SR), len(a))
    if na: a[:na] *= np.linspace(0, 1, na)[:, None]
    if nr: a[-nr:] *= np.linspace(1, 0, nr)[:, None]
    return a
def filt(a, lo=None, hi=None):
    from scipy.signal import butter, sosfilt
    if lo and hi: sos = butter(2, [lo / (SR / 2), hi / (SR / 2)], 'band', output='sos')
    elif hi: sos = butter(2, hi / (SR / 2), 'low', output='sos')
    else: sos = butter(2, lo / (SR / 2), 'high', output='sos')
    return np.stack([sosfilt(sos, a[:, c]) for c in (0, 1)], 1).astype(np.float32)
def glide(f0, f1, dur, vib=0.0, vibhz=6, curve=1.0, harm=(1.0,)):
    """Тон со скользящей высотой: свисток, чайка, пузырь"""
    n = int(dur * SR); t = np.linspace(0, 1, n)
    f = f0 * (f1 / f0) ** (t ** curve) * (1 + vib * np.sin(2 * np.pi * vibhz * t * dur))
    ph = 2 * np.pi * np.cumsum(f) / SR
    return st(sum(a * np.sin(ph * (k + 1)) for k, a in enumerate(harm)))
def bubble(f=420, dur=0.07):
    return env(glide(f, f * 2.3, dur, curve=1.6), 0.004, dur * 0.5)
def gullcry(f=1150, dur=0.26):
    """Крик чайки: резкий гнусавый тон, взлетает и падает, с дрожью"""
    n = int(dur * SR); up = glide(f * 0.8, f * 1.25, dur * 0.3, harm=(1, .7, .5, .3, .2)); dn = glide(f * 1.25, f * 0.7, dur * 0.7, vib=0.03, vibhz=28, harm=(1, .7, .5, .3, .2))
    return env(filt(np.vstack([up, dn]), 900, 5200), 0.008, 0.06)
out = {}
def done(key, m, **kw): out[key] = OUT + f'emo_{key}.mp3'; m.render(out[key], **kw)

# «Буль-буль» — туба уходит под воду: нота съезжает вниз на квинту, поверх лопаются пузыри, в конце последний «бульк»
m = Mix(1.5)
m.add(env(filt(bend(note(TBS, 46, 1.0), 0, -700, 1.4), hi=900), .03, .3), 0, 0.9)
for at in (0.05, 0.16, 0.24, 0.37, 0.46, 0.6, 0.71, 0.85):
    m.add(bubble(rng.uniform(330, 620), rng.uniform(.05, .09)), at, rng.uniform(.12, .22), rng.uniform(-.6, .6))
m.add(bubble(250, 0.14), 1.05, 0.3)
done('sink', m, wet=0.3, rt=1.5, tail=0.2)

# «Мимо!» — свисток падает вниз, всплеск, труба с сурдиной дразнится «ня-ня»
m = Mix(1.55)
m.add(env(glide(1900, 520, 0.42, vib=0.012, vibhz=9, curve=1.3, harm=(1, .15)), .01, .05), 0, 0.2, -0.3)
m.add(hit(SFX + '/rubberduck/SFX100/splash_01.opus', dur=0.5, fade=0.3), 0.4, 0.5, 0.2)
for n, at, d in [(74, 0.62, .12), (71, 0.76, .12), (74, 0.9, .12), (71, 1.04, .3)]:
    m.add(env(bend(note(TRM, n, .3), 0, -40), .005, .06, d), at, 0.9, 0.1)
done('miss', m, wet=0.18, rt=1.1, tail=0.15)

# «Моё!» — чайка кричит трижды и улетает вправо, кубок звенит колокольчиками
m = Mix(1.5)
for i, (at, f, d) in enumerate([(0, 1180, .24), (0.27, 1260, .22), (0.52, 1100, .34)]):
    m.add(gullcry(f, d), at, 0.3, -0.5 + i * 0.5)
for i, n in enumerate([88, 91, 96]): m.add(note(GL, n, .8, off=0), 0.62 + i * 0.07, 0.3, 0.3)
m.add(note(TUB, 38, .2), 0.0, 0.3)
done('gull', m, wet=0.26, rt=1.4, tail=0.2)

# «Попал!» — пушка, литавра и победная труба «та-да-а!» с тарелкой
m = Mix(1.7)
m.add(hit(SFX + '/rubberduck/Bang/cannon_02.opus', dur=0.9, fade=0.5), 0, 0.75)
m.add(hit('Percussion/Timpani/Timpani4_Hit_v4_rr1_Sum.wav', dur=0.7), 0.02, 0.7)
m.add(note(TST, 67, .12), 0.34, 0.7, -0.15); m.add(note(TST, 72, .12), 0.46, 0.7, 0.0)
m.add(env(note(TSV, 76, .8), .01, .3), 0.58, 0.85, 0.15); m.add(env(note(TSV, 72, .8), .01, .3), 0.58, 0.4, -0.2)
m.add(hit('Percussion/susCymb1-hit_fff_rr2.wav', dur=0.8, fade=0.5), 0.58, 0.3, 0.3)
done('boom', m, wet=0.2, rt=1.3, tail=0.25)

# «Хм…» — фагот задумчиво «хм-хм», кларнет задаёт вопрос вверх, арфа оставляет его висеть
m = Mix(1.5)
m.add(note(BSN, 43, .2), 0, 0.6, -0.2); m.add(env(bend(note(BSN, 46, .45), 0, 180, 0.7), .01, .15), 0.26, 0.6, -0.1)
m.add(note(CL, 70, .12), 0.72, 0.4, 0.2); m.add(env(bend(note(CL, 74, .4), 0, 90), .01, .2), 0.86, 0.45, 0.25)
for i, n in enumerate([62, 65, 68]): m.add(note(HARP, n, .8), 0.9 + i * 0.05, 0.22, -0.3 + i * 0.3)
done('hmm', m, wet=0.26, rt=1.5, tail=0.2)

# «Пока-пока» — труба с сурдиной машет ручкой: «та-та, та-та-а» вниз, арфа сбегает следом
m = Mix(1.6)
for n, at, d in [(79, 0, .13), (76, 0.16, .2), (79, 0.46, .13), (76, 0.62, .5)]:
    m.add(env(bend(note(TRM, n, .6), 20, -30), .008, .1, d), at, 0.95, (-.15, .15)[int(at > .3)])
for i, n in enumerate([88, 84, 79, 76, 72, 67]): m.add(note(HARP, n, .5), 0.72 + i * 0.045, 0.28, 0.5 - i * 0.2)
done('bye', m, wet=0.2, rt=1.3, tail=0.2)

# «Псих» — тромбоны рычат кластером с дрожью, дробь литавр, удар по железу и тарелка
m = Mix(1.6)
n_ = int(0.9 * SR); trem = (0.6 + 0.4 * np.sin(2 * np.pi * 26 * np.arange(n_) / SR))[:, None]
for k in (34, 35, 40, 41):
    a = env(bend(note(TBS, k, 0.9), -30, 60, 0.8), .02, .12); a = a * trem[:len(a)]
    m.add(a, 0, 0.5, rng.uniform(-.4, .4))
for i in range(11):
    m.add(hit(f'Percussion/Timpani/Timpani{2 + i % 2}_Hit_v3_rr{1 + i % 2}_Sum.wav', dur=0.3), 0.04 + i * 0.075, 0.25 + i * 0.03, (-.3, .3)[i % 2])
m.add(hit('Percussion/BrakeDrum1_Hammer_v3_Sum.wav', dur=0.5), 0.9, 0.5, -0.2)
m.add(hit('Percussion/susCymb1-hit_fff_rr1.wav', dur=0.6, fade=0.4), 0.9, 0.35, 0.3)
m.add(note(TUB, 29, .35), 0.9, 0.9)
done('rage', m, wet=0.2, rt=1.3, tail=0.2)

# «Ходи уже» — часы тикают, кости стучат деревяшками, валторна зевает
m = Mix(1.7)
W = SFX + '/Superpowers/prehistoric-platformer/wood-%d.opus'
for i in range(5):
    m.add(filt(hit(W % (1 + i % 2), dur=0.08, fade=0.05), lo=1200), i * 0.22, 0.5, (-.25, .25)[i % 2])
for i, at in enumerate([0.5, 0.57, 0.63, 0.72, 0.78, 0.83]):
    m.add(hit(W % (3 + i % 3), dur=0.12, fade=0.08), at + 0.55, rng.uniform(.3, .5), rng.uniform(-.6, .6))
m.add(env(bend(note(HRN, 58, .9), 0, -400, 1.5), .12, .3), 0.3, 0.55)
m.add(note(BSN, 36, .3), 1.32, 0.4)
done('wait', m, wet=0.22, rt=1.4, tail=0.2)

def rms(f):
    raw = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', f, '-ac', '1', '-f', 'f32le', '-'], capture_output=True).stdout
    a = np.frombuffer(raw, np.float32); idx = np.where(np.abs(a) > 10 ** (-45 / 20))[0]; a = a[:idx[-1]]
    return 20 * np.log10(np.sqrt((a ** 2).mean())), len(a) / SR
for k in ('lol', 'angry', 'easy'): print('ref', k, [round(x, 2) for x in rms(OUT + f'emo_{k}.mp3')])
for n, f in out.items():
    r, d = rms(f); print(n, 'rms', round(r, 1), 'dur', round(d, 2), 'kb', os.path.getsize(f) // 1024)
    os.remove(f.replace('.mp3', '.wav'))
