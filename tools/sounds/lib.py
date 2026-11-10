import numpy as np, subprocess, re, os, glob, functools
SR = 44100
ROOT = '/tmp/claude-0/-home-claude/b86b93d9-dce3-5593-b874-f82fdce5a066/scratchpad/samples/vsco'
NOTES = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11}
def nm(n):  # 'D#3' -> midi
    m = re.match(r'([A-G]#?)(-?\d)', n); return NOTES[m.group(1)] + 12 * (int(m.group(2)) + 1)
@functools.lru_cache(None)
def load(path):
    raw = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', path, '-ar', str(SR), '-ac', '2', '-f', 'f32le', '-'], capture_output=True).stdout
    a = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()
    # срезать тишину в начале
    env = np.abs(a).max(1); thr = env.max() * 0.02
    i = int(np.argmax(env > thr)); a = a[max(0, i - 64):]
    return a
def pitch(a, lo=60, hi=1200):
    m = a.mean(1); seg = m[int(.12*SR):int(.5*SR)]
    if len(seg) < 2048: seg = m[:8192]
    seg = seg - seg.mean(); seg = seg * np.hanning(len(seg))
    ac = np.correlate(seg, seg, 'full')[len(seg)-1:]
    lmin, lmax = int(SR/hi), int(SR/lo)
    lag = lmin + int(np.argmax(ac[lmin:lmax])); return SR/lag
def hz2midi(f): return 69 + 12*np.log2(f/440)
def bank(pattern):
    files = sorted(glob.glob(os.path.join(ROOT, pattern)))
    out = []
    for f in files:
        m = re.search(r'_([A-G]#?\d)_', os.path.basename(f)) or re.search(r'_([A-G]#?\d)\.wav', os.path.basename(f))
        if m: out.append((nm(m.group(1)), f))
    return out
@functools.lru_cache(None)
def offset(pattern):
    b = bank(pattern); ds = []
    for n, f in b[::max(1, len(b)//6)][:6]:
        try: ds.append(round(hz2midi(pitch(load(f))) - n))
        except Exception: pass
    vals, cnt = np.unique(ds, return_counts=True); return int(vals[np.argmax(cnt)]) if len(vals) else 0
def note(pattern, midi, dur=None, vel=1.0, fade=0.08):
    b = bank(pattern); off = offset(pattern)
    n, f = min(b, key=lambda x: abs(x[0] + off - midi))
    a = load(f); ratio = 2 ** ((midi - (n + off)) / 12)
    if abs(ratio - 1) > 1e-3:
        idx = np.arange(0, len(a) - 1, ratio); a = np.stack([np.interp(idx, np.arange(len(a)), a[:, c]) for c in (0, 1)], 1)
    if dur:
        L = int(dur * SR); a = a[:L].copy(); fl = min(int(fade * SR), len(a))
        a[-fl:] *= np.linspace(1, 0, fl)[:, None]
    return a * vel
def hit(path, vel=1.0, dur=None, fade=0.2):
    a = load(os.path.join(ROOT, path)) * vel
    if dur: a = a[:int(dur*SR)].copy(); fl=min(int(fade*SR),len(a)); a[-fl:] *= np.linspace(1,0,fl)[:,None]
    return a
class Mix:
    def __init__(self, sec): self.b = np.zeros((int(sec*SR), 2), np.float32)
    def add(self, a, at, gain=1.0, pan=0.0):
        s = int(at*SR); e = min(len(self.b), s+len(a)); seg = a[:e-s] * gain
        l, r = np.cos((pan+1)*np.pi/4), np.sin((pan+1)*np.pi/4)
        self.b[s:e, 0] += seg[:, 0]*l*1.414; self.b[s:e, 1] += seg[:, 1]*r*1.414
    def render(self, out, wet=0.22, rt=1.6, tail=0.5):
        rng = np.random.default_rng(3); n = int(rt*SR); t = np.arange(n)/SR
        ir = np.stack([rng.standard_normal(n), rng.standard_normal(n)], 1) * np.exp(-6.9*t/rt)[:, None]
        ir[:int(.012*SR)] = 0; ir /= np.sqrt((ir**2).sum(0))
        dry = np.vstack([self.b, np.zeros((int(tail*SR), 2), np.float32)])
        from scipy.signal import fftconvolve
        w = np.stack([fftconvolve(dry[:, c], ir[:, c])[:len(dry)] for c in (0, 1)], 1)
        y = dry*(1-wet*0.5) + w*wet*3
        # мягкий лимитер
        y = np.tanh(y / (np.abs(y).max()*0.75)) ; y = y / np.abs(y).max() * 0.89
        fl = int(.3*SR); y[-fl:] *= np.linspace(1, 0, fl)[:, None]
        raw = (y*32767).astype('<i2').tobytes()
        wav = out.replace('.mp3', '.wav')
        import wave
        with wave.open(wav, 'wb') as w_: w_.setnchannels(2); w_.setsampwidth(2); w_.setframerate(SR); w_.writeframes(raw)
        subprocess.run(['ffmpeg', '-v', 'quiet', '-y', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '112k', out], check=True)
        return out
