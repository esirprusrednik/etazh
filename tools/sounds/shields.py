import numpy as np, lib
from lib import hit, note, Mix, SR, ROOT
R = ROOT + '/'
V1 = 'VSCO 1 Percussion/drums/'
def shift(a, semis):
    r = 2 ** (semis / 12); idx = np.arange(0, len(a) - 1, r)
    return np.stack([np.interp(idx, np.arange(len(a)), a[:, c]) for c in (0, 1)], 1)
def cut(a, dur, fade=.3):
    a = a[:int(dur * SR)].copy(); fl = min(int(fade * SR), len(a)); a[-fl:] *= np.linspace(1, 0, fl)[:, None]; return a
def timp(midi, dur=1.4):
    a = lib.load(R + 'Percussion/Timpani/Timpani3_Hit_v3_rr1_Sum.wav'); r = 440 * 2 ** ((midi - 69) / 12) / 70.7
    idx = np.arange(0, len(a) - 1, r); a = np.stack([np.interp(idx, np.arange(len(a)), a[:, c]) for c in (0, 1)], 1); return cut(a, dur)
# Удар щитов: глухой удар большого барабана + металл щита (наковальня и тормозной барабан, опущенные вниз — тяжёлая пластина)
def shield_hit(m, at, k=1.0, var=0):
    m.add(hit(V1 + 'other/ethnic/giant/mallet/EthnicLargeMallet_hit_ff_%d.wav' % (1 + var % 2)), at, 0.95 * k)
    m.add(cut(hit(V1 + 'bass/bdrum_fff_%d.wav' % (1 + var % 2)), 1.2), at, 0.7 * k)
    # «стена щитов»: несколько металлических ударов вразнобой на пару миллисекунд, слева и справа
    for j, (dt, pan, semi) in enumerate([(0, -0.5, -9), (0.011, 0.5, -10), (0.022, -0.15, -8), (0.031, 0.25, -11)]):
        m.add(cut(shift(hit('Percussion/Anvil_Hit1_v%d_Sum.wav' % (1 + (j + var) % 3)), semi), .5, .35), at + dt, 0.22 * k, pan)
        m.add(cut(shift(hit('Percussion/BrakeDrum1_Hammer_v%d_Sum.wav' % (1 + (j + var + 1) % 3)), semi + 3), .45, .3), at + dt + .004, 0.18 * k, -pan)
    m.add(cut(hit(V1 + 'other/ethnic/giant/hand/EthnicLargeHand_hit_ff_%d.wav' % (1 + var % 2)), .5), at + .006, 0.5 * k, 0.2)

m = Mix(4.4)
for i, at in enumerate([0.0, 0.62, 1.24]): shield_hit(m, at, 0.85 + i * 0.07, i)
# разгон: палки по большому барабану и маршевый малый
for i, at in enumerate([1.62, 1.79, 1.96]):
    m.add(hit(V1 + 'other/ethnic/giant/sticks/EthnicLargeSticks_hit_f_%d.wav' % (1 + i % 2)), at, 1.1 + i * .15, -0.2 + i * .2)
    m.add(cut(hit(V1 + 'snare/drum3_marching/snare3_f_%d.wav' % (1 + i % 2)), .35), at, 0.35 + i * .08, 0.3)
# Финальный удар: щиты, гонг, тарелки, литавры и низкая медь
F = 2.18
shield_hit(m, F, 1.15, 3)
m.add(hit(V1 + 'bass/bdrum3_fff_1.wav'), F, 0.8)
m.add(cut(hit('Percussion/gongHit_fff.wav'), 2.6, 1.4), F + .01, 0.6)
m.add(cut(hit(V1 + '../varMetal/Cymbals/clash/crash_hit_fff_loose.wav'), 2.0, 1.0), F, 0.45, 0.35)
m.add(timp(38), F, 1.0); m.add(timp(38), F + .005, 0.5)
m.add(note('Brass/Tuba/sus/*', 38, 1.4, fade=.6), F, 0.9)
for n in (50, 57): m.add(note('Brass/Tenor Trombone/sus/*', n, 1.4, fade=.6), F, 0.55, -0.25 if n == 50 else 0.25)
print(m.render('battle2.mp3', wet=0.3))
