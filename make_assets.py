"""Draw the logo, favicons, app icons and the social share image for sha3.si
into ./docs. Pillow only; text is measured before drawing so nothing clips."""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'docs')
BG = (11, 15, 20)
GRID = (31, 42, 55)
ACCENT = (57, 211, 160)
TEXT = (230, 237, 243)
MUTED = (139, 152, 168)
F = 'C:/Windows/Fonts/'


def font(names, size):
    for n in names:
        try:
            return ImageFont.truetype(F + n, size)
        except OSError:
            pass
    raise SystemExit('no font found: ' + ', '.join(names))

MONO_B = ['consolab.ttf', 'courbd.ttf']
SANS = ['segoeui.ttf', 'arial.ttf']
SANS_B = ['segoeuib.ttf', 'arialbd.ttf']


def mark(size):
    """The logo mark: a 3x3 lattice, the Keccak state seen from above."""
    s = 4  # draw big, then downsample for smooth edges
    n = size * s
    im = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * 0.22), fill=BG)
    for y in (0.28, 0.5, 0.72):
        d.line([(n * 0.2, n * y), (n * 0.8, n * y)], fill=GRID, width=max(1, int(n * 0.06)))
    w = max(1, int(n * 0.08))
    for x in (0.31, 0.5, 0.69):
        d.line([(n * x, n * 0.22), (n * x, n * 0.78)], fill=ACCENT, width=w)
        r = w // 2
        for yy in (0.22, 0.78):
            d.ellipse([n * x - r, n * yy - r, n * x + r, n * yy + r], fill=ACCENT)
    return im.resize((size, size), Image.LANCZOS)


def save_icons():
    mark(180).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'))
    mark(192).save(os.path.join(OUT, 'icon-192.png'))
    mark(512).save(os.path.join(OUT, 'icon-512.png'))
    mark(256).save(os.path.join(OUT, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])


def fit(d, text, names, size, maxw):
    while size > 10:
        f = font(names, size)
        if d.textlength(text, font=f) <= maxw:
            return f
        size -= 2
    return font(names, size)


def save_og():
    W, H = 1200, 630
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    # faint lattice in the background
    for x in range(0, W, 60):
        d.line([(x, 0), (x, H)], fill=(16, 22, 30))
    for y in range(0, H, 60):
        d.line([(0, y), (W, y)], fill=(16, 22, 30))
    m = mark(150)
    im.paste(m, (80, 90), m)
    X, maxw = 80, W - 160
    f1 = fit(d, 'sha3.si', MONO_B, 140, maxw)
    d.text((X, 270), 'sha3', font=f1, fill=TEXT)
    d.text((X + d.textlength('sha3', font=f1), 270), '.si', font=f1, fill=ACCENT)
    line2 = 'SHA-3 hash tools & reference'
    f2 = fit(d, line2, SANS, 46, maxw)
    d.text((X, 435), line2, font=f2, fill=MUTED)
    tag = 'THIS DOMAIN IS FOR SALE'
    f3 = font(SANS_B, 30)
    tw = d.textlength(tag, font=f3)
    d.rounded_rectangle([X, 515, X + tw + 48, 571], radius=12, fill=ACCENT)
    d.text((X + 24, 524), tag, font=f3, fill=(4, 21, 15))
    im.save(os.path.join(OUT, 'og.png'), optimize=True)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    save_icons()
    save_og()
    print('icons and og.png written to', OUT)
