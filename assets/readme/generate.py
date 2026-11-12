import sys
out = sys.argv[1]
SANS = "'Space Grotesk', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
T = {
 "dark": dict(bg="#0C1420", surface="#121C2B", line="#24324A", text="#E6EDF6", muted="#91A2BB", primary="#5B9BE6", dim="#1F3352", delta="#F0A93B"),
 "light": dict(bg="#F4F6F9", surface="#FFFFFF", line="#D9E0EA", text="#122033", muted="#4E5E76", primary="#2563B8", dim="#C9D8EE", delta="#B86E00"),
}

def hero(t):
    c = T[t]
    W, H = 1200, 440
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="100%" role="img" aria-labelledby="t d">',
         '<title id="t">DeltaPostgres</title><desc id="d">Scheduled, encrypted, deduplicated backups for PostgreSQL containers. Each backup row shows a full dump; only the highlighted changed chunks are stored.</desc>',
         f'<rect width="{W}" height="{H}" rx="24" fill="{c["bg"]}"/>']
    # mark
    x0, y0 = 64, 78
    s.append(f'<rect x="{x0+22}" y="{y0}" width="20" height="20" rx="4" fill="{c["delta"]}"/>')
    s.append(f'<rect x="{x0+8}" y="{y0+28}" width="20" height="20" rx="4" fill="{c["primary"]}"/>')
    s.append(f'<rect x="{x0+36}" y="{y0+28}" width="20" height="20" rx="4" fill="{c["primary"]}" opacity="0.45"/>')
    s.append(f'<text x="64" y="206" font-family="{SANS}" font-size="64" font-weight="700" letter-spacing="-2" fill="{c["text"]}">Delta<tspan fill="{c["muted"]}">Postgres</tspan></text>')
    s.append(f'<text font-family="{SANS}" font-size="24" fill="{c["muted"]}"><tspan x="64" y="256">Scheduled, encrypted, deduplicated backups</tspan><tspan x="64" y="290">for every PostgreSQL container on your</tspan><tspan x="64" y="324">Docker hosts.</tspan></text>')
    s.append(f'<text x="64" y="384" font-family="{MONO}" font-size="18" fill="{c["muted"]}">pg_dump  →  borg  ·  zstd  ·  repokey-blake2</text>')
    # ledger: rows of chunks
    gx, gy, n, cw, gap, rh = 620, 104, 16, 24, 6, 56
    rows = [("Mon", set(range(n))), ("Tue", {5, 11}), ("Wed", {2, 11, 14}), ("Thu", {8}), ("Fri", {5, 12})]
    s.append(f'<text x="{gx}" y="{gy-26}" font-family="{SANS}" font-size="18" fill="{c["muted"]}">Each row is a full dump. Only changed chunks are stored.</text>')
    for r, (label, changed) in enumerate(rows):
        y = gy + r * rh
        s.append(f'<text x="{gx}" y="{y+26}" font-family="{MONO}" font-size="18" fill="{c["muted"]}">{label}</text>')
        for i in range(n):
            x = gx + 56 + i * (cw + gap)
            fill = c["delta"] if i in changed else c["dim"]
            s.append(f'<rect x="{x}" y="{y+4}" width="{cw}" height="30" rx="5" fill="{fill}"/>')
    ly = gy + len(rows) * rh + 18
    s.append(f'<rect x="{gx+56}" y="{ly}" width="16" height="16" rx="3" fill="{c["dim"]}"/><text x="{gx+80}" y="{ly+14}" font-family="{SANS}" font-size="18" fill="{c["muted"]}">already in repo</text>')
    s.append(f'<rect x="{gx+240}" y="{ly}" width="16" height="16" rx="3" fill="{c["delta"]}"/><text x="{gx+264}" y="{ly+14}" font-family="{SANS}" font-size="18" fill="{c["muted"]}">stored as new data</text>')
    s.append('</svg>')
    return "\n".join(s)

def pipeline(t):
    c = T[t]
    W, H = 1200, 290
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="100%" role="img" aria-labelledby="t d">',
         '<title id="t">How a DeltaPostgres backup runs</title><desc id="d">pg_dump runs inside the container, the dumps are staged with a manifest, Borg creates one encrypted deduplicated archive, then prune and compact apply retention.</desc>',
         f'<rect width="{W}" height="{H}" rx="24" fill="{c["bg"]}"/>']
    stages = [
        ("1", "Dump databases", ["pg_dumpall -g", "pg_dump -Fc -Z 0"], False),
        ("2", "Stage the run", ["globals.sql", "<db>.dump", "manifest.json"], False),
        ("3", "Borg archive", ["borg create", "zstd,3", "repokey-blake2"], True),
        ("4", "Apply retention", ["borg prune", "borg compact"], False),
    ]
    bw, bh, gap, top = 264, 190, 28, 50
    x = 40
    for i, (num, title, lines, hl) in enumerate(stages):
        stroke = c["delta"] if hl else c["line"]
        s.append(f'<rect x="{x}" y="{top}" width="{bw}" height="{bh}" rx="16" fill="{c["surface"]}" stroke="{stroke}" stroke-width="{2 if hl else 1.5}"/>')
        s.append(f'<text x="{x+24}" y="{top+44}" font-family="{MONO}" font-size="20" fill="{c["delta"] if hl else c["primary"]}">{num}</text>')
        s.append(f'<text x="{x+24}" y="{top+82}" font-family="{SANS}" font-size="22" font-weight="600" fill="{c["text"]}">{title}</text>')
        for j, line in enumerate(lines):
            line = line.replace("<", "&lt;").replace(">", "&gt;")
            s.append(f'<text x="{x+24}" y="{top+124+j*30}" font-family="{MONO}" font-size="18" fill="{c["muted"]}">{line}</text>')
        if i < len(stages) - 1:
            ax = x + bw + 8
            ay = top + bh / 2
            s.append(f'<path d="M{ax-2} {ay} H{ax+gap-14}" stroke="{c["muted"]}" stroke-width="2"/><path d="M{ax+gap-18} {ay-7} L{ax+gap-8} {ay} L{ax+gap-18} {ay+7}" fill="none" stroke="{c["muted"]}" stroke-width="2"/>')
        x += bw + gap
    s.append('</svg>')
    return "\n".join(s)

for t in ("dark", "light"):
    open(f"{out}/hero-{t}.svg", "w").write(hero(t))
    open(f"{out}/how-it-works-{t}.svg", "w").write(pipeline(t))
