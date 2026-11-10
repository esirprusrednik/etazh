import numpy as np, lib
from lib import note, hit, Mix, SR, ROOT
R = ROOT + '/'
H = 'Brass/F Horn/sus/*'; TS = 'Brass/Trumpet/stac/*'; TV = 'Brass/Trumpet/susvib/*'; TB = 'Brass/Tenor Trombone/sus/*'; TU = 'Brass/Tuba/sus/*'
def cut(a, dur, fade=.3):
    a = a[:int(dur * SR)].copy(); fl = min(int(fade * SR), len(a)); a[-fl:] *= np.linspace(1, 0, fl)[:, None]; return a
def timp(midi, dur=1.0):
    a = lib.load(R + 'Percussion/Timpani/Timpani3_Hit_v3_rr1_Sum.wav'); r = 440 * 2 ** ((midi - 69) / 12) / 70.7
    idx = np.arange(0, len(a) - 1, r); a = np.stack([np.interp(idx, np.arange(len(a)), a[:, c]) for c in (0, 1)], 1); return cut(a, dur)
# Короткий клич «та-ДАМ»: вызов брошен, бой принят, запись на Кубок, «Держись!»
m = Mix(2.0)
m.add(note(TS, 69), 0.0, 1.3, 0.1); m.add(note(H, 57, .12, fade=.04), 0.0, .6, -0.15)
F = 0.14
m.add(note(TV, 74, .75, fade=.35), F, 1.1, 0.1)
for n in (62, 66, 69): m.add(note(H, n, .75, fade=.35), F, .5, 0.2)
for n in (50, 57): m.add(note(TB, n, .75, fade=.35), F, .5, -0.2)
m.add(note(TU, 38, .75, fade=.35), F, .7)
m.add(timp(38), F, 1.0)
m.add(cut(hit('Percussion/susCymb1-hit_f_rr1.wav') if False else hit('Percussion/susCymb1-hit_fff_rr2.wav'), 1.2, .8), F, .3, .3)
print(m.render('rally.mp3', wet=0.25, tail=0.3))
# Гудок банды: долгий зов валторн с тубой, как боевой рог
m = Mix(2.2)
m.add(note(TU, 38, 1.5, fade=.5), 0.0, 1.0)
m.add(note(TB, 50, 1.5, fade=.5), 0.0, .6, -0.2)
m.add(note(H, 50, .35, fade=.1), 0.0, .9, 0.1)
m.add(note(H, 57, 1.15, fade=.5), 0.32, .9, 0.15)
m.add(note(H, 62, 1.15, fade=.5), 0.32, .5, -0.1)
print(m.render('horn.mp3', wet=0.32, tail=0.4))
