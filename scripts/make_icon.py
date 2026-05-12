"""Generate a 1024x1024 placeholder app icon for the Mac .app bundle.

Run once from the repo root:
    python3 scripts/make_icon.py

Output: scripts/icon.png — picked up automatically by install-app-icon.sh.

Replace with a custom 1024x1024 PNG at the same path any time and re-run
install-app-icon.sh to refresh the bundle.
"""

from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path

SIZE = 1024
BG = (15, 17, 23, 255)        # near-black, matches dashboard
ACCENT = (34, 211, 238, 255)  # cyan-400
SUBTLE = (50, 56, 66, 255)    # subtle grid lines


def main() -> None:
    img = Image.new("RGBA", (SIZE, SIZE), BG)
    d = ImageDraw.Draw(img)

    # Rounded-square background with a subtle border highlight
    radius = int(SIZE * 0.22)
    pad = int(SIZE * 0.04)
    d.rounded_rectangle(
        [pad, pad, SIZE - pad, SIZE - pad],
        radius=radius,
        fill=BG,
        outline=SUBTLE,
        width=4,
    )

    # Faint topo-like horizontal hairlines (echoes the app background)
    for y in range(int(SIZE * 0.15), int(SIZE * 0.9), int(SIZE * 0.07)):
        d.line(
            [(pad + 40, y), (SIZE - pad - 40, y)],
            fill=(40, 46, 56, 255),
            width=2,
        )

    # The hero glyph: a stylised segment route — a curving cyan stroke with
    # two endpoint discs (start = small, end = large) to evoke segment start/end.
    pts = [
        (int(SIZE * 0.22), int(SIZE * 0.72)),
        (int(SIZE * 0.32), int(SIZE * 0.50)),
        (int(SIZE * 0.50), int(SIZE * 0.42)),
        (int(SIZE * 0.66), int(SIZE * 0.30)),
        (int(SIZE * 0.80), int(SIZE * 0.26)),
    ]
    # Glow layer
    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.line(pts, fill=ACCENT, width=int(SIZE * 0.06), joint="curve")
    glow = glow.filter(ImageFilter.GaussianBlur(radius=int(SIZE * 0.022)))
    img.alpha_composite(glow)

    # Main stroke
    d.line(pts, fill=ACCENT, width=int(SIZE * 0.04), joint="curve")

    # Endpoint discs
    def disc(c, r, fill, outline=None):
        d.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=fill, outline=outline,
                  width=6 if outline else 0)

    disc(pts[0], int(SIZE * 0.04), BG, outline=ACCENT)
    disc(pts[-1], int(SIZE * 0.06), ACCENT)

    # Speed/elevation tick marks under the route — purely decorative
    tick_y = int(SIZE * 0.84)
    for i, h in enumerate([0.04, 0.07, 0.05, 0.09, 0.06, 0.10, 0.07]):
        x = int(SIZE * (0.22 + i * 0.085))
        d.rectangle(
            [x, tick_y - int(SIZE * h), x + int(SIZE * 0.012), tick_y],
            fill=ACCENT if i % 2 == 0 else SUBTLE,
        )

    out = Path(__file__).parent / "icon.png"
    img.save(out, format="PNG")
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
