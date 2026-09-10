#!/usr/bin/env python3
"""Atlas Realm 行程配色工具 —— 生成「同族成对 + 色相递进」色带，并用 CIEDE2000 校验相邻可辨度。

用法:
  python3 palette_band.py --units 6                      # 生成 6 个单元的色带 + ΔE 校验
  python3 palette_band.py --units 8 --start violet --jump 3
  python3 palette_band.py --check "#60a5fa,#2563eb,#a78bfa"   # 校验已有色序
  python3 palette_band.py --units 6 --chart /tmp/band.png     # 顺手出一张色带图（需 Pillow）
  python3 palette_band.py --units 6 --json                    # 机器可读

阈值（经验值, CIEDE2000）: >=15 一眼可辨 / 12-15 勉强 / <12 视为同色。
"""
import argparse, json, math, sys

FAMILIES = {
    "sky":     {300: "#7dd3fc", 400: "#38bdf8", 500: "#0ea5e9", 600: "#0284c7", 700: "#0369a1", 800: "#075985"},
    "cyan":    {300: "#67e8f9", 400: "#22d3ee", 500: "#06b6d4", 600: "#0891b2", 700: "#0e7490", 800: "#155e75"},
    "teal":    {300: "#5eead4", 400: "#2dd4bf", 500: "#14b8a6", 600: "#0d9488", 700: "#0f766e", 800: "#115e59"},
    "emerald": {300: "#6ee7b7", 400: "#34d399", 500: "#10b981", 600: "#059669", 700: "#047857", 800: "#065f46"},
    "lime":    {300: "#bef264", 400: "#a3e635", 500: "#84cc16", 600: "#65a30d", 700: "#4d7c0f", 800: "#3f6212"},
    "amber":   {300: "#fcd34d", 400: "#fbbf24", 500: "#f59e0b", 600: "#d97706", 700: "#b45309", 800: "#92400e"},
    "orange":  {300: "#fdba74", 400: "#fb923c", 500: "#f97316", 600: "#ea580c", 700: "#c2410c", 800: "#9a3412"},
    "rose":    {300: "#fda4af", 400: "#fb7185", 500: "#f43f5e", 600: "#e11d48", 700: "#be123c", 800: "#9f1239"},
    "pink":    {300: "#f9a8d4", 400: "#f472b6", 500: "#ec4899", 600: "#db2777", 700: "#be185d", 800: "#9d174d"},
    "fuchsia": {300: "#f0abfc", 400: "#e879f9", 500: "#d946ef", 600: "#c026d3", 700: "#a21caf", 800: "#86198f"},
    "purple":  {300: "#d8b4fe", 400: "#c084fc", 500: "#a855f7", 600: "#9333ea", 700: "#7e22ce", 800: "#6b21a8"},
    "violet":  {300: "#c4b5fd", 400: "#a78bfa", 500: "#8b5cf6", 600: "#7c3aed", 700: "#6d28d9", 800: "#5b21b6"},
    "indigo":  {300: "#a5b4fc", 400: "#818cf8", 500: "#6366f1", 600: "#4f46e5", 700: "#4338ca", 800: "#3730a3"},
    "blue":    {300: "#93c5fd", 400: "#60a5fa", 500: "#3b82f6", 600: "#2563eb", 700: "#1d4ed8", 800: "#1e40af"},
}
# 推荐族序（按色相环排列，相邻族色相间距 ~13-45°）：起点可变，顺序不变
FAMILY_ORDER = ["blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose",
                "orange", "amber", "lime", "emerald", "teal", "cyan", "sky"]


def _s2l(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def _lab(h):
    r, g, b = [_s2l(x) for x in _hex2rgb(h)]
    x = (r * .4124 + g * .3576 + b * .1805) / .95047
    y = (r * .2126 + g * .7152 + b * .0722)
    z = (r * .0193 + g * .1192 + b * .9505) / 1.08883
    f = lambda t: t ** (1 / 3) if t > .008856 else 7.787 * t + 16 / 116
    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def _hue(h):
    r, g, b = _hex2rgb(h); mx, mn = max(r, g, b), min(r, g, b); d = mx - mn
    if d == 0:
        return 0.0
    if mx == r:
        v = 60 * (((g - b) / d) % 6)
    elif mx == g:
        v = 60 * ((b - r) / d + 2)
    else:
        v = 60 * ((r - g) / d + 4)
    return v % 360


def ciede2000(l1, l2):
    L1, a1, b1 = l1; L2, a2, b2 = l2
    C1, C2 = math.hypot(a1, b1), math.hypot(a2, b2); Cb = (C1 + C2) / 2
    G = .5 * (1 - math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p, h2p = math.degrees(math.atan2(b1, a1p)) % 360, math.degrees(math.atan2(b2, a2p)) % 360
    dLp, dCp = L2 - L1, C2p - C1p
    dhp = 0 if C1p * C2p == 0 else ((h2p - h1p + 180) % 360) - 180
    dHp = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dhp) / 2)
    Lbp, Cbp = (L1 + L2) / 2, (C1p + C2p) / 2
    if C1p * C2p == 0:
        hbp = h1p + h2p
    elif abs(h1p - h2p) <= 180:
        hbp = (h1p + h2p) / 2
    else:
        hbp = (h1p + h2p + 360) / 2 if h1p + h2p < 360 else (h1p + h2p - 360) / 2
    T = (1 - .17 * math.cos(math.radians(hbp - 30)) + .24 * math.cos(math.radians(2 * hbp))
         + .32 * math.cos(math.radians(3 * hbp + 6)) - .20 * math.cos(math.radians(4 * hbp - 63)))
    dth = 30 * math.exp(-((hbp - 275) / 25) ** 2)
    Rc = 2 * math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
    Sl = 1 + (.015 * (Lbp - 50) ** 2) / math.sqrt(20 + (Lbp - 50) ** 2)
    Sc, Sh = 1 + .045 * Cbp, 1 + .015 * Cbp * T
    Rt = -math.sin(math.radians(2 * dth)) * Rc
    return math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))


def delta(x, y):
    return ciede2000(_lab(x), _lab(y))


def build_band(units, start="blue", jump=2, light=400, dark=600, families=None, stride=1):
    """同族成对: 每 2 个单元共用一族, 深浅交替; 族用尽后按 FAMILY_ORDER 继续。
    families 显式给出族序（如 blue,violet,pink）时优先使用；stride=每次跨几族。"""
    shades = (light, light + 100 * jump, light + 300)
    if families:
        order = list(families)
    else:
        base = FAMILY_ORDER.index(start) if start in FAMILY_ORDER else 0
        order = [FAMILY_ORDER[(base + i * stride) % len(FAMILY_ORDER)] for i in range(len(FAMILY_ORDER))]
    band, fam_i = [], 0
    for i in range(units):
        if i and i % 2 == 0:
            fam_i += 1
        fam = order[fam_i % len(order)]
        sh = shades[i % 2]
        sh = sh if sh in FAMILIES[fam] else min(FAMILIES[fam], key=lambda k: abs(k - sh))
        band.append({"unit": f"Day{i + 1}", "family": fam, "shade": sh, "hex": FAMILIES[fam][sh]})
    return band


def audit(seq, hue_tol=75):
    """seq: [(label, hex)] -> 相邻逐项报告 + 结论。
    distinct: ΔE >= 15（硬指标）；series: 色相差 <= hue_tol（同族或相邻族递进）。"""
    rows = []
    for i in range(1, len(seq)):
        d = delta(seq[i - 1][1], seq[i][1])
        dh = abs(_hue(seq[i - 1][1]) - _hue(seq[i][1]))
        dh = min(dh, 360 - dh)
        rows.append({"from": seq[i - 1][0], "to": seq[i][0], "deltaE": round(d, 1),
                     "hue_gap": round(dh), "ok_distinct": d >= 15, "ok_series": dh <= hue_tol})
    weak = [r for r in rows if not r["ok_distinct"] or not r["ok_series"]]
    return {"rows": rows, "min_deltaE": min((r["deltaE"] for r in rows), default=0),
            "max_hue_gap": max((r["hue_gap"] for r in rows), default=0), "issues": weak,
            "pass": not weak}


def chart(seq, path):
    from PIL import Image, ImageDraw, ImageFont
    W = 120 + len(seq) * 170
    img = Image.new("RGB", (W, 260), (255, 255, 255)); d = ImageDraw.Draw(img)
    try:
        f = ImageFont.truetype("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", 16)
        fb = ImageFont.truetype("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", 20)
    except Exception:
        f = fb = ImageFont.load_default()
    d.text((40, 24), "Atlas Realm trip colour band", font=fb, fill=(17, 24, 39))
    for i, (lab, hx) in enumerate(seq):
        x = 60 + i * 160; y = 80
        rgb = tuple(int(hx[j:j + 2], 16) for j in (1, 3, 5))
        d.rectangle([x, y, x + 140, y + 44], fill=(17, 24, 39)); d.rectangle([x, y + 4, x + 140, y + 40], fill=rgb)
        d.text((x + 70, y + 54), lab, font=f, fill=(31, 41, 55), anchor="ma")
        d.text((x + 70, y + 78), hx, font=f, fill=(120, 128, 138), anchor="ma")
        if i:
            v = delta(seq[i - 1][1], hx)
            d.text((x - 10, y + 14), f"{v:.0f}", font=f, anchor="mm",
                   fill=(22, 163, 74) if v >= 15 else (220, 38, 38))
    img.save(path)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--units", type=int, help="行程单元数（天/岛/专题）")
    ap.add_argument("--start", default="blue", help="起点族（blue/violet/pink/amber/emerald/...）")
    ap.add_argument("--jump", type=int, default=2, choices=(2, 3), help="同族深浅跳档数: 2=一行可辨, 3=更强")
    ap.add_argument("--check", help="校验已有色序: '标签=#hex,标签=#hex,...' 或纯 '#hex,#hex'")
    ap.add_argument("--families", help="显式族序，如 blue,violet,pink（优先于 --start/--stride）")
    ap.add_argument("--stride", type=int, default=1, help="每跨一对前进几族，默认 1")
    ap.add_argument("--chart", help="输出色带 PNG（需 Pillow）")
    ap.add_argument("--hue-tol", type=int, default=75, help="同系列容差: 相邻单元色相差上限（度），默认 75")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    if a.check:
        seq = []
        for i, tok in enumerate(a.check.split(",")):
            tok = tok.strip()
            lab, hx = (tok.split("=", 1) if "=" in tok else (f"item{i + 1}", tok))
            seq.append((lab, hx if hx.startswith("#") else "#" + hx))
    elif a.units:
        fams = [x.strip() for x in a.families.split(",")] if a.families else None
        band = build_band(a.units, a.start, a.jump, families=fams, stride=a.stride)
        seq = [(f"{b['unit']}\n{b['family']}-{b['shade']}", b["hex"]) for b in band]
    else:
        ap.error("需要 --units 或 --check")

    rep = audit(seq, a.hue_tol)
    if a.chart:
        rep["chart"] = chart(seq, a.chart)
    if a.json:
        print(json.dumps({"band": seq, **rep}, ensure_ascii=False, indent=1)); return 0
    for lab, hx in seq:
        print(f"  {lab.replace(chr(10), ' '):<26}{hx}")
    print()
    for r in rep["rows"]:
        flag = "OK " if (r["ok_distinct"] and r["ok_series"]) else "!! "
        print(f"  {flag}{r['from']:<20} -> {r['to']:<20} ΔE={r['deltaE']:<5} 色相差={r['hue_gap']}°")
    print(f"\n  最小 ΔE = {rep['min_deltaE']}  {'PASS' if rep['pass'] else 'FAIL —— 调 --jump 或换 --start'}")
    return 0 if rep["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
