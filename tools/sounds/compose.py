import numpy as np, lib
from lib import note, hit, Mix, SR, ROOT
R = ROOT + '/'
H = 'Brass/F Horn/sus/*'; TS = 'Brass/Trumpet/stac/*'; TV = 'Brass/Trumpet/susvib/*'; TB = 'Brass/Tenor Trombone/sus/*'
TU = 'Brass/Tuba/sus/*'; TUS = 'Brass/Tuba/stac/*'; VT = 'Strings/Violin Section/Trem/*'; CT = 'Strings/Cello Section/trem/*'
def timp(drum, midi, vel=1.0, dur=1.6, v='v3'):
    f0 = {1: 45.7, 2: 59.6, 3: 70.7, 4: 82.7, 5: 94.0}[drum]
    a = lib.load(R + f'Percussion/Timpani/Timpani{drum}_Hit_{v}_rr1_Sum.wav'); r = 440 * 2 ** ((midi - 69) / 12) / f0
    idx = np.arange(0, len(a) - 1, r); a = np.stack([np.interp(idx, np.arange(len(a)), a[:, c]) for c in (0, 1)], 1)[:int(dur * SR)]
    fl = int(.2 * SR); a[-fl:] *= np.linspace(1, 0, fl)[:, None]; return a * vel
def env(a, pts):  # огибающая по точкам (сек, уровень)
    t = np.arange(len(a)) / SR; xs, ys = zip(*pts); return a * np.interp(t, xs, ys)[:, None]

# ===== Вступление в бой =====
D2, A1, A2, D3, Fs3, A3, D4, Fs4, A4, D5, Fs5, A5 = 38, 33, 45, 50, 54, 57, 62, 66, 69, 74, 78, 81
m = Mix(4.2)
roll = lib.load(R + 'Percussion/Timpani/Rolls/Timpani3_Roll_v5_rr1_Sum.wav')
r = 73.42 / 70.7; idx = np.arange(0, int(1.0 * SR * r), r); roll = np.stack([np.interp(idx, np.arange(len(roll)), roll[:, c]) for c in (0, 1)], 1)
m.add(env(roll, [(0, .08), (.85, 1.0), (.95, 1.0), (1.0, 0)]), 0, 0.9)
cr = lib.load(R + 'Percussion/susCymb1-cresc-Short_v1.wav'); pk = int(1.2856 * SR)
m.add(env(cr[pk - int(.95 * SR):pk + int(.04 * SR)], [(0, .2), (.9, 1), (.99, 0)]), 0, 0.55)
T = 0.95
m.add(hit('Percussion/BDrumNewhit_v7_rr1_Sum.wav'), T, 1.0)
m.add(hit('Percussion/susCymb1-hit_fff_rr1.wav', dur=2.6, fade=1.2), T, 0.55, 0.3)
m.add(timp(3, D2, dur=1.4), T, 1.0)
m.add(note(TU, D2, .55, fade=.15), T, 0.9)
for n in (D3, A3): m.add(note(TB, n, .55, fade=.15), T, 0.55, -0.2)
for n in (D4, Fs4): m.add(note(H, n, .55, fade=.15), T, 0.6, 0.2)
m.add(note(TS, D5), T, 0.5)
m.add(env(note(VT, A4, 2.6, fade=.8), [(0, 1), (2.6, .6)]), T, 0.35, 0.35)
m.add(env(note(VT, D5, 2.6, fade=.8), [(0, 1), (2.6, .6)]), T, 0.35, 0.4)
m.add(env(note(CT, D3, 2.6, fade=.8), [(0, 1), (2.6, .6)]), T, 0.45, -0.35)
# Призыв трубы: ля-ре-фа# и долгое ЛЯ, валторны вторят октавой ниже
call = [(A4, 1.45), (D5, 1.58), (Fs5, 1.71)]
for n, at in call: m.add(note(TS, n), at, 0.75, 0.1); m.add(note('Brass/F Horn/sus/*', n - 12, .16, fade=.05), at, 0.4, -0.1)
HOLD = 1.86
m.add(note(TV, A5, 1.5, fade=.5), HOLD, 0.7, 0.1)
m.add(note(TV, D5, 1.5, fade=.5), HOLD, 0.45, -0.05)
for n in (D4, Fs4, A4): m.add(note(H, n, 1.5, fade=.5), HOLD, 0.45, 0.25)
for n in (D3, A3): m.add(note(TB, n, 1.5, fade=.5), HOLD, 0.5, -0.25)
m.add(note(TU, D2, 1.5, fade=.5), HOLD, 0.8)
m.add(timp(3, D2, dur=1.6), HOLD, 0.95); m.add(timp(2, A1, .8, dur=1.2), HOLD + .2, 1.0); m.add(timp(3, D2, dur=1.6), HOLD + .34, 1.0)
m.add(hit('Percussion/BDrumNewhit_v7_rr2_Sum.wav'), HOLD, 0.7)
m.add(hit('Percussion/susCymb1-hit_fff_rr2.wav', dur=2.2, fade=1.2), HOLD, 0.4, -0.3)
print(m.render('battle.mp3', wet=0.28))

# ===== Проигрыш =====
m = Mix(3.8)
OS = 'Brass/OldTrombone/Sustain/*'; HM = 'Brass/Trumpet/harmonM-sus/*'; BS = 'Woodwinds/Bassoon/stac/*'
steps = [(50, 0.0), (49, 0.38), (48, 0.76)]
for n, at in steps:
    m.add(note(OS, n, .34, fade=.06), at, 3.2, -0.1)
    m.add(note(HM, n + 12, .34, fade=.06), at, 0.9, 0.2)
    m.add(note(TUS, n - 12), at, 0.7)
# последняя — с дрожью и падением
m.add(note('Brass/OldTrombone/Vibrato/*', 47, .55, fade=.1), 1.14, 2.8, -0.1)
m.add(note('Brass/OldTrombone/Fall/*', 47), 1.62, 2.0, -0.1)
m.add(note(HM, 59, .9, fade=.4), 1.14, 0.4, 0.2)
m.add(note(TU, 35, .9, fade=.4), 1.14, 0.6)
# фагот хихикает «хо-хо-хо-хо» хроматически вниз
for i, n in enumerate([57, 56, 55, 54]): m.add(note(BS, n), 2.25 + i * .11, 0.3, 0.3)
# ба-дум-тсс
m.add(hit('Percussion/timpsnaretenor_ff.wav', dur=.4, fade=.2), 2.82, 0.3, -0.2)
m.add(hit('Percussion/BDrumNewhit_v7_rr1_Sum.wav', dur=.6), 2.98, 0.3)
m.add(hit('Percussion/susCymb1-hitstick_f_rr1.wav', dur=.7, fade=.5), 3.14, 0.45, 0.3)
print(m.render('lose.mp3', wet=0.2))

# ===== Победа =====
m = Mix(4.0)
D6, Fs6, A6, D7 = 86, 90, 93, 98
GL = 'Percussion/Glock/*'; HP = 'Strings/Harp/*'
# «та-та-та» трубы и валторн, под ними малый барабан
for at in (0.0, 0.11, 0.22):
    m.add(note(TS, D5), at, 1.5, 0.1); m.add(note(H, D4, .12, fade=.04), at, 0.6, -0.1)
    m.add(hit('Percussion/timpsnaretenor_f.wav', dur=.25, fade=.15), at, 0.25, -0.3)
# «ТА» — фа-диез, весь медный хор и литавра
F1 = 0.36
m.add(note(TV, Fs5, .32, fade=.08), F1, 1.3, 0.1)
for n in (D4, Fs4, A4): m.add(note(H, n, .32, fade=.08), F1, 0.45, 0.2)
for n in (D3, A3): m.add(note(TB, n, .32, fade=.08), F1, 0.5, -0.2)
m.add(note(TU, D2, .32, fade=.08), F1, 0.7)
m.add(timp(3, D2, dur=.6), F1, 0.8)
# «ТААААМ» — ля, тутти с тарелкой, арфа взлетает, колокольчики сверкают
T2 = 0.7
m.add(note(TV, A5, 1.9, fade=.7), T2, 0.8, 0.1)
m.add(note(TV, D5, 1.9, fade=.7), T2, 0.5, -0.05)
for n in (D4, Fs4, A4): m.add(note(H, n, 1.9, fade=.7), T2, 0.45, 0.25)
for n in (D3, Fs3, A3): m.add(note(TB, n, 1.9, fade=.7), T2, 0.45, -0.25)
m.add(note(TU, D2, 1.9, fade=.7), T2, 0.75)
m.add(env(note(VT, D5, 2.3, fade=.9), [(0, 1), (2.3, .6)]), T2, 0.35, 0.35)
m.add(env(note(VT, A4, 2.3, fade=.9), [(0, 1), (2.3, .6)]), T2, 0.3, 0.4)
m.add(env(note(CT, D3, 2.3, fade=.9), [(0, 1), (2.3, .6)]), T2, 0.4, -0.35)
m.add(hit('Percussion/BDrumNewhit_v7_rr1_Sum.wav'), T2, 0.9)
m.add(hit('Percussion/susCymb1-hit_fff_rr1.wav', dur=2.6, fade=1.4), T2, 0.5, 0.3)
m.add(timp(3, D2, dur=1.4), T2, 1.0); m.add(timp(2, A1, .8, dur=1.0), T2 + .22, 1.0); m.add(timp(3, D2, dur=1.4), T2 + .36, 1.0)
for i, n in enumerate([D4, Fs4, A4, D5, Fs5, A5, D6]): m.add(note(HP, n, 1.4, fade=.6), T2 + .02 + i * .045, 0.5, -0.4 + i * .12)
for i, n in enumerate([D6, Fs6, A6, D7]): m.add(note(GL, n, 1.6, fade=.8, off=0), T2 + .35 + i * .09, 0.35, 0.3)
print(m.render('win.mp3', wet=0.28))
