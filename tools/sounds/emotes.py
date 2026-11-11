# Звуки реакций в играх: 8 коротких «мультяшных» реплик из настоящих оркестровых сэмплов (VSCO 2 CE, CC0)
# Человеческих голосов нет нарочно: телефон в офисе не должен хохотать чужим голосом
import numpy as np, sys, subprocess
sys.path.insert(0, '.')
import lib
from lib import Mix, SR, note, hit
rng = np.random.default_rng(7)
TRM = 'Brass/Trumpet/harmonM-sus/*'      # труба с сурдиной «вау-вау»
TST = 'Brass/Trumpet/stac/*'
TSV = 'Brass/Trumpet/susvib/*'
TBV = 'Brass/OldTrombone/Vibrato/*'
TBS = 'Brass/OldTrombone/Sustain/*'
TBF = 'Brass/OldTrombone/Fall/*'
TUB = 'Brass/Tuba/stac/*'
HRN = 'Brass/F Horn/*/*'
CL = 'Woodwinds/Clarinet/stac/*'
BSN = 'Woodwinds/Bassoon/stac/*'
HARP = 'Strings/Harp/*'
GL = 'Percussion/Glock/*'

def bend(a, cents_from, cents_to, curve=1.0):
    """Плавный сдвиг высоты по ходу звука (глиссандо): от cents_from к cents_to"""
    n = len(a); t = np.linspace(0, 1, n) ** curve
    ratio = 2 ** ((cents_from + (cents_to - cents_from) * t) / 1200)
    idx = np.cumsum(ratio); idx = idx[idx < n - 1]
    return np.stack([np.interp(idx, np.arange(n), a[:, c]) for c in (0, 1)], 1).astype(np.float32)
def env(a, att=0.01, rel=0.06, dur=None):
    a = a.copy()
    if dur: a = a[:int(dur * SR)]
    na, nr = min(int(att * SR), len(a)), min(int(rel * SR), len(a))
    if na: a[:na] *= np.linspace(0, 1, na)[:, None]
    if nr: a[-nr:] *= np.linspace(1, 0, nr)[:, None]
    return a
def bp(a, lo, hi):
    from scipy.signal import butter, sosfilt
    sos = butter(2, [lo / (SR / 2), hi / (SR / 2)], 'band', output='sos')
    return np.stack([sosfilt(sos, a[:, c]) for c in (0, 1)], 1).astype(np.float32)
def clap1():
    """Один хлопок: три быстрых шумовых всплеска и короткий хвост, полоса 900–3500 Гц — так звучат ладони"""
    L = int(0.16 * SR); x = np.zeros(L, np.float32); t = np.arange(L) / SR
    for d in (0, 0.008, 0.016): s = int(d * SR); x[s:] += rng.standard_normal(L - s).astype(np.float32) * np.exp(-(t[:L - s]) / 0.0035)
    x += rng.standard_normal(L).astype(np.float32) * np.exp(-t / 0.035) * 0.5
    a = np.stack([x, x], 1); return bp(a, 900, 3500)
def claps(m, at, dur, hands=9, rate=7.5, gain=0.5):
    """Аплодисменты небольшой компании: у каждого свой темп и место в стерео"""
    for h in range(hands):
        p = rng.uniform(-0.8, 0.8); r = rate * rng.uniform(0.85, 1.15); t = at + rng.uniform(0, 0.08)
        while t < at + dur:
            fade = 1 - max(0, (t - at) / dur - 0.6) / 0.4
            m.add(clap1(), t, gain * rng.uniform(0.6, 1.0) * fade, p); t += 1 / r * rng.uniform(0.9, 1.1)
def snap():
    L = int(0.05 * SR); t = np.arange(L) / SR; x = rng.standard_normal(L).astype(np.float32) * np.exp(-t / 0.004)
    return bp(np.stack([x, x], 1), 1800, 6000)

out = {}
# 😂 «Ха-ха!» — труба с сурдиной хохочет: пять «ха» вниз, каждое чуть проседает, в конце туба «бум»
m = Mix(1.4)
for i, (n, at) in enumerate([(77, 0), (76, .12), (74, .24), (72, .36), (71, .50)]):
    m.add(env(bend(note(TRM, n, .2), 0, -70), .005, .05, .11 if i < 4 else .24), at, 1.0, (-0.2, 0.2)[i % 2])
m.add(note(TUB, 41, .25), 0.52, 0.55)
out['emo_lol'] = m.render('emo/emo_lol.mp3', wet=0.16, rt=1.0, tail=0.15)

# 😡 «Ну всё!» — два злых удара низкой меди с литаврой: «ДУМ… ДУМ!», второй с тарелкой
m = Mix(1.5)
for at, g in [(0, 0.75), (0.3, 1.0)]:
    for n in (38, 39, 45):
        m.add(env(note(TBS, n, .3), .004, .08), at, g * 0.55, rng.uniform(-.3, .3))
    m.add(note(TUB, 33, .3), at, g * 0.9)
    m.add(hit('Percussion/Timpani/Timpani4_Hit_v4_rr2_Sum.wav', dur=0.6), at, g * 0.9)
m.add(hit('Percussion/susCymb1-hit_fff_rr1.wav', dur=0.5, fade=0.3), 0.3, 0.35, 0.3)
out['emo_angry'] = m.render('emo/emo_angry.mp3', wet=0.2, rt=1.3, tail=0.2)

# 😴 «Скукота» — валторна зевает: долгая нота тихо съезжает вниз на кварту, фагот сонно «пум-пум»
m = Mix(1.45)
m.add(env(bend(note(HRN, 60, .85), 0, -500, 1.6), .1, .25), 0, 0.75)
m.add(note(BSN, 41, .16), 0.78, 0.45, -0.2)
m.add(note(BSN, 36, .28), 0.98, 0.4, 0.2)
out['emo_bored'] = m.render('emo/emo_bored.mp3', wet=0.22, rt=1.4, tail=0.2)

# 🧠 «Умный ход» — арфа быстро взбегает вверх, колокольчик ставит точку: «дзынь — идея»
m = Mix(1.3)
for i, n in enumerate([72, 76, 79, 84, 88]):
    m.add(note(HARP, n, .6), i * 0.045, 0.6, -0.4 + i * 0.2)
m.add(note(GL, 96, .9, off=0), 0.24, 0.55, 0.2)
m.add(note(GL, 91, .9, off=0), 0.24, 0.25, -0.2)
out['emo_smart'] = m.render('emo/emo_smart.mp3', wet=0.28, rt=1.5, tail=0.2)

# 😱 «Ой-ой» — кларнет испуганно взлетает, труба с сурдиной «у-оу» (малая терция вниз)
m = Mix(1.3)
for i, n in enumerate([67, 71, 74, 79]): m.add(note(CL, n, .07), i * 0.035, 0.45, 0.2)
m.add(env(note(TRM, 77, .2), .01, .05, .17), 0.2, 1.0)
m.add(env(bend(note(TRM, 74, .5), 0, -60), .01, .15, .42), 0.4, 1.0)
out['emo_oops'] = m.render('emo/emo_oops.mp3', wet=0.18, rt=1.2, tail=0.15)

# 👏 «Браво» — короткие аплодисменты и труба «та-да!»
m = Mix(1.6)
claps(m, 0.0, 1.2, hands=10, gain=0.42)
m.add(note(TST, 67, .14), 0.02, 0.6, -0.15)
m.add(env(note(TSV, 72, .7), .01, .25), 0.16, 0.75, 0.15)
m.add(note(GL, 84, .5, off=0), 0.16, 0.18)
out['emo_clap'] = m.render('emo/emo_clap.mp3', wet=0.2, rt=1.2, tail=0.2)

# 🙏 «Пощади» — тромбон с вибрато жалобно просит: два вздоха вниз на полтона, под ними тихая арфа в миноре
m = Mix(1.5)
m.add(env(note(TBV, 62, .45), .05, .12), 0, 0.8)
m.add(env(bend(note(TBV, 61, .72), 0, -40), .05, .3), 0.42, 0.8)
for i, n in enumerate([50, 53, 57]): m.add(note(HARP, n, .9), 0.42 + i * 0.06, 0.32, -0.3 + i * 0.3)
out['emo_mercy'] = m.render('emo/emo_mercy.mp3', wet=0.26, rt=1.6, tail=0.2)

# 😎 «Изи» — щелчок пальцами, туба и вальяжная труба с сурдиной: «ду-ва-а», блюзовая терция
m = Mix(1.4)
m.add(snap(), 0, 0.14, 0.35)
m.add(note(TUB, 36, .2), 0.0, 0.4)
m.add(env(note(TRM, 72, .2), .01, .05, .13), 0.14, 0.9, -0.1)
m.add(env(bend(note(TRM, 75, .6), -60, 0, 0.5), .02, .2, .5), 0.3, 1.0, 0.1)
m.add(snap(), 0.42, 0.11, -0.35)
m.add(note(TUB, 31, .3), 0.42, 0.35)
out['emo_easy'] = m.render('emo/emo_easy.mp3', wet=0.18, rt=1.1, tail=0.15)

for n, f in out.items():
    raw = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', f, '-ac', '1', '-f', 'f32le', '-'], capture_output=True).stdout
    a = np.frombuffer(raw, np.float32); idx = np.where(np.abs(a) > 10 ** (-45 / 20))[0]; a = a[:idx[-1]]
    print(n, 'rms', round(20 * np.log10(np.sqrt((a ** 2).mean())), 1), 'dur', round(len(a) / SR, 2), 'kb', len(open(f, 'rb').read()) // 1024)
