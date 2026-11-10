import numpy as np, lib, subprocess, glob
from lib import Mix, SR, note, hit
S = '/tmp/claude-0/-home-claude/b86b93d9-dce3-5593-b874-f82fdce5a066/scratchpad/samples/'
FS = S + 'EternityForest_Free-SFX/'
def ld(path):
    return lib.load(path)
def k(name):  # Kenney sci-fi
    return ld(glob.glob(S + 'kenney/**/' + name + '.ogg', recursive=True)[0])
def lp(a, fc):  # простой ФНЧ для «подводного» удара
    from scipy.signal import butter, lfilter
    b, a2 = butter(2, fc / (SR / 2)); return np.stack([lfilter(b, a2, a[:, c]) for c in (0, 1)], 1).astype(np.float32)
cannon = lambda n: ld(FS + f'rubberduck/Bang/cannon_0{n}.opus')
splash = lambda n: ld(FS + f'rubberduck/SFX100/splash_0{n}.opus')
west = lambda n: ld(FS + f'Superpowers/western-fps-2d/explosion-{n}.opus')
top = lambda n: ld(FS + f'Superpowers/top-down-shooter/explosion-{n}.opus')
out = {}
# Промах: выстрел пушки, через четверть секунды снаряд входит в воду — всплеск и глухой удар под водой
for i, (c, s_) in enumerate([(1, 1), (4, 2)]):
    m = Mix(1.6)
    m.add(cannon(c), 0, 0.6, -0.35)
    m.add(splash(s_), 0.28, 1.0, 0.3)
    m.add(lp(k('low_frequency_explosion_001'), 300), 0.27, 0.35, 0.2)
    out[f'miss{i+1}'] = m.render(f'miss{i+1}.mp3', wet=0.12, tail=0.2)
# Попадание: выстрел, взрыв на корабле, удар металла и низкий гул
for i, (c, ex, imp, lo) in enumerate([(1, lambda: west(1), 'impact_metal_003', 'low_frequency_explosion_000'), (4, lambda: top(2), 'impact_metal_001', 'low_frequency_explosion_001')]):
    m = Mix(2.0)
    m.add(cannon(c), 0, 0.55, -0.35)
    m.add(ex(), 0.26, 1.0, 0.25)
    m.add(k(lo), 0.26, 0.6, 0.1)
    m.add(k(imp), 0.27, 0.45, 0.3)
    out[f'hit{i+1}'] = m.render(f'hit{i+1}.mp3', wet=0.14, tail=0.3)
# Потопил: выстрел, большой взрыв, детонация погреба, скрежет металла и корпус уходит в воду
m = Mix(3.2)
m.add(cannon(2), 0, 0.55, -0.35)
m.add(k('explosion_crunch_004'), 0.26, 1.0, 0.2)
m.add(k('low_frequency_explosion_000'), 0.26, 0.8, 0.1)
m.add(k('impact_metal_003'), 0.3, 0.5, 0.35)
m.add(west(2), 0.72, 0.75, 0.4)
m.add(k('low_frequency_explosion_001'), 0.72, 0.5, 0.3)
m.add(splash(1), 1.45, 0.55, 0.35)
m.add(lp(splash(2), 1500), 1.62, 0.5, 0.2)
out['sunk1'] = m.render('sunk1.mp3', wet=0.16, tail=0.3)
# Сдался: кларнет кудахчет «ко-ко-ко», труба с сурдиной «кудах?», тромбон съезжает вниз — «пфф»
m = Mix(2.2)
CL = 'Woodwinds/Clarinet/stac/*'
for i, at in enumerate([0, 0.12, 0.24]): m.add(note(CL, 76 + (i == 2)), at, 2.4, 0.3)
m.add(note('Brass/Trumpet/harmonM-sus/*', 79, .28, fade=.08), 0.42, 1.7, 0.1)
m.add(note('Brass/Trumpet/harmonM-sus/*', 81, .18, fade=.06), 0.66, 1.7, 0.1)
m.add(note('Brass/OldTrombone/Fall/*', 52), 0.95, 0.9, -0.15)
m.add(note('Brass/Tuba/stac/*', 38), 0.95, 0.6)
out['resign'] = m.render('resign.mp3', wet=0.2, tail=0.3)
for n, f in out.items():
    raw = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', f, '-ac', '1', '-f', 'f32le', '-'], capture_output=True).stdout
    a = np.frombuffer(raw, np.float32); idx = np.where(np.abs(a) > 10 ** (-45 / 20))[0]; a = a[:idx[-1]]
    print(n, 'rms', round(20 * np.log10(np.sqrt((a ** 2).mean())), 1), 'dur', round(len(a) / SR, 2), 'kb', len(open(f, 'rb').read()) // 1024)
