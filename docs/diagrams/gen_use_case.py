"""Generates docs/diagrams/use-case.svg, the SRS use case diagram.

Run: python3 docs/diagrams/gen_use_case.py
The SVG is converted to figures/use-case.pdf for inclusion in the SRS.

Content follows Shikhar's "FoodBridge - Use Case Diagram (Final)": five actors,
twenty-six use cases, and the include/extend dependencies between them.
"""
import math

W, H = 2200, 960
p = []

def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

# ---------------------------------------------------------- primitives

def actor(x, y, lines, system=False, label_above=False):
    if system:
        p.append(f'<rect x="{x-24}" y="{y-26}" width="48" height="48" rx="6" '
                 f'fill="none" stroke="currentColor" stroke-width="1.6"/>')
        p.append(f'<circle cx="{x}" cy="{y-2}" r="10" fill="none" stroke="currentColor" stroke-width="1.6"/>')
        for a in (0, 45, 90, 135):
            dx, dy = 15*math.cos(math.radians(a)), 15*math.sin(math.radians(a))
            p.append(f'<line x1="{x-dx:.1f}" y1="{y-2-dy:.1f}" x2="{x+dx:.1f}" y2="{y-2+dy:.1f}" '
                     f'stroke="currentColor" stroke-width="1.6"/>')
        p.append(f'<circle cx="{x}" cy="{y-2}" r="4.5" fill="var(--diagram-bg,#fff)" '
                 f'stroke="currentColor" stroke-width="1.6"/>')
    else:
        p.append(f'<circle cx="{x}" cy="{y-28}" r="11" fill="none" stroke="currentColor" stroke-width="1.8"/>')
        p.append(f'<line x1="{x}" y1="{y-17}" x2="{x}" y2="{y+9}" stroke="currentColor" stroke-width="1.8"/>')
        p.append(f'<line x1="{x-16}" y1="{y-7}" x2="{x+16}" y2="{y-7}" stroke="currentColor" stroke-width="1.8"/>')
        p.append(f'<line x1="{x}" y1="{y+9}" x2="{x-13}" y2="{y+30}" stroke="currentColor" stroke-width="1.8"/>')
        p.append(f'<line x1="{x}" y1="{y+9}" x2="{x+13}" y2="{y+30}" stroke="currentColor" stroke-width="1.8"/>')
    base = (y - 54 - (len(lines)-1)*19) if label_above else (y + 50)
    for i, ln in enumerate(lines):
        p.append(f'<text x="{x}" y="{base+i*19}" text-anchor="middle" font-size="18" '
                 f'font-weight="600" fill="currentColor">{esc(ln)}</text>')

UC = {}
RY = 25

def uc(name, cx, cy, lines, rx, core=False):
    op = '0.11' if core else '0.04'
    p.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{RY}" fill="currentColor" '
             f'fill-opacity="{op}" stroke="currentColor" stroke-width="1.3"/>')
    start = cy - (len(lines)-1)*8.5 + 5
    for i, ln in enumerate(lines):
        p.append(f'<text x="{cx}" y="{start+i*17}" text-anchor="middle" font-size="15" '
                 f'fill="currentColor">{esc(ln)}</text>')
    UC[name] = (cx, cy, rx, RY)

def edge_point(name, tx, ty):
    cx, cy, rx, ry = UC[name]
    dx, dy = tx - cx, ty - cy
    d = math.hypot(dx, dy) or 1
    t = 1.0 / math.hypot(dx/(rx*d), dy/(ry*d)) if (dx or dy) else 0
    return cx + dx/d*t, cy + dy/d*t

def assoc(ax, ay, name):
    x2, y2 = edge_point(name, ax, ay)
    p.append(f'<line x1="{ax}" y1="{ay}" x2="{x2:.1f}" y2="{y2:.1f}" '
             f'stroke="currentColor" stroke-width="1.1" stroke-opacity="0.72"/>')

def dep(src, dst, kind, lx=None, ly=None):
    sx, sy, _, _ = UC[src]
    dxc, dyc, _, _ = UC[dst]
    x1, y1 = edge_point(src, dxc, dyc)
    x2, y2 = edge_point(dst, sx, sy)
    p.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
             f'stroke="currentColor" stroke-width="1.15" stroke-dasharray="6 4" '
             f'marker-end="url(#oa)"/>')
    mx = lx if lx is not None else (x1+x2)/2
    my = ly if ly is not None else (y1+y2)/2 - 5
    p.append(f'<text x="{mx:.0f}" y="{my:.0f}" text-anchor="middle" font-size="13" '
             f'font-style="italic" fill="currentColor" fill-opacity="0.8">'
             f'&#171;{kind}&#187;</text>')

# ------------------------------------------------------ system boundary
BX0, BY0, BX1, BY1 = 20, 215, 2175, 740
p.append(f'<rect x="{BX0}" y="{BY0}" width="{BX1-BX0}" height="{BY1-BY0}" rx="10" '
         f'fill="currentColor" fill-opacity="0.018" stroke="currentColor" stroke-width="1.6"/>')
p.append(f'<text x="{(BX0+BX1)/2}" y="{BY0+32}" text-anchor="middle" font-size="21" '
         f'font-weight="700" fill="currentColor" letter-spacing="0.03em">FoodBridge System</text>')

# -------------------------------------------------------------- actors
actor(430, 105, ['Donor'], label_above=True)
actor(1420, 105, ['Map / Geocoding', 'Service'], system=True, label_above=True)
actor(300, 810, ['Recipient', 'Organisation'])
actor(1150, 810, ['Administrator'])
actor(1450, 810, ['Notification', 'Service'], system=True)

# ----------------------------------------------------------- use cases
uc('register',  170, 300, ['Register / Log In'], 78)
uc('profile',   170, 395, ['Manage Profile'], 74)
uc('notif_rx',  170, 490, ['Receive Notifications'], 98)

uc('track',     420, 290, ['Track Donation', '/ Pickup'], 80)
uc('post',      600, 290, ['Post Surplus Food'], 80, core=True)
uc('listing',   820, 290, ['View / Cancel', 'Active Listing'], 82)

uc('validate',  480, 395, ['Validate', 'Donation Details'], 80)
uc('submit',    680, 395, ['Submit Donation', 'for Review'], 84, core=True)
uc('details',   880, 395, ['View Donation', 'Details'], 78)
uc('locate',   1420, 395, ['Determine', 'Pickup Location'], 84)

uc('accept',    350, 520, ['Accept Match'], 66)
uc('reject_m',  600, 520, ['Reject Match'], 64)
uc('review_m',  470, 612, ['Review Match'], 70, core=True)
uc('pickup_s',  760, 585, ['Update Pickup Status'], 95)
uc('pickup_v',  760, 660, ['View Pickup Details'], 90)

uc('monitor',   980, 620, ['Monitor Donations,', 'Matches and Pickups'], 96)
uc('accounts',  980, 690, ['Manage User Accounts'], 96)
uc('impact',   1480, 620, ['View Impact', 'Dashboard'], 72)

uc('reject_d', 1520, 290, ['Reject Donation'], 76)
uc('approve',  1760, 290, ['Approve Donation'], 80, core=True)
uc('legit',    1620, 395, ['Review Donation', 'Legitimacy'], 86, core=True)
uc('run',      1960, 395, ['Run Matching', 'Process'], 80, core=True)
uc('donor_v',  1540, 565, ['View Donor and', 'Donation Details'], 86)
uc('score',    1850, 500, ['Score and Assign', 'Best Match'], 86)
uc('eligible', 2050, 500, ['Identify Eligible', 'Recipients'], 84)

uc('alerts',   1180, 520, ['Send Alerts'], 70)

# ------------------------------------------------- actor associations
for n in ('register', 'profile', 'notif_rx', 'track', 'post', 'listing'):
    assoc(452, 118, n)
for n in ('register', 'profile', 'notif_rx', 'review_m', 'pickup_s', 'pickup_v'):
    assoc(322, 790, n)
for n in ('monitor', 'accounts', 'impact', 'reject_d', 'approve'):
    assoc(1172, 790, n)
assoc(1420, 140, 'locate')
assoc(1450, 784, 'alerts')

# ------------------------------------------------------------ include
dep('post', 'validate', 'include')
dep('post', 'submit', 'include')
dep('post', 'locate', 'include', lx=1060, ly=330)
dep('listing', 'details', 'include', lx=895, ly=347)
dep('pickup_s', 'pickup_v', 'include', lx=812, ly=627)
dep('legit', 'donor_v', 'include', lx=1528, ly=485)
dep('approve', 'run', 'include', lx=1905, ly=330)
dep('run', 'score', 'include', lx=1868, ly=458)
dep('run', 'eligible', 'include', lx=2046, ly=458)
dep('submit', 'alerts', 'include', lx=960, ly=448)
dep('notif_rx', 'alerts', 'include', lx=690, ly=500)

# ------------------------------------------------------------- extend
dep('accept', 'review_m', 'extend')
dep('reject_m', 'review_m', 'extend')
dep('reject_d', 'legit', 'extend')
dep('approve', 'legit', 'extend', lx=1718, ly=358)

# --------------------------------------------------------------- note
p.append('<path d="M 1690 742 h 430 v 86 h -420 l -10 -10 z" fill="currentColor" '
         'fill-opacity="0.05" stroke="currentColor" stroke-width="1.1"/>')
for i, ln in enumerate(['Internal system behaviour, not an actor.',
                        'Runs only after administrator approval.',
                        'Scores on urgency, proximity and capacity.']):
    p.append(f'<text x="1706" y="{768+i*20}" font-size="15" fill="currentColor" '
             f'fill-opacity="0.85">{esc(ln)}</text>')
p.append('<path d="M 1960 745 L 1960 420" fill="none" stroke="currentColor" '
         'stroke-width="1.1" stroke-dasharray="3 3" stroke-opacity="0.6"/>')

p.append(f'<ellipse cx="{BX0+34}" cy="{H-28}" rx="19" ry="11" fill="currentColor" '
         f'fill-opacity="0.11" stroke="currentColor" stroke-width="1.1"/>')
p.append(f'<text x="{BX0+64}" y="{H-23}" font-size="15.5" fill="currentColor" fill-opacity="0.85">'
         f'shaded = the core donation workflow</text>')

body = '\n'.join(p)
DEFS = ('<defs><marker id="oa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
        'markerHeight="7" orient="auto-start-reverse">'
        '<path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="currentColor" stroke-width="1.4"/>'
        '</marker></defs>')
TITLE = ('FoodBridge use case diagram: three human actors, two system actors, and '
         'twenty-six use cases with include and extend relationships.')

import os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'use-case.svg')
open(OUT, 'w').write(
    f'<svg viewBox="0 0 {W} {H}" width="{W}" height="{H}" xmlns="http://www.w3.org/2000/svg" '
    f'role="img" aria-label="{TITLE}" color="#16201c" style="--diagram-bg:#fbfcfb">\n'
    f'<rect width="{W}" height="{H}" fill="#fbfcfb"/>\n{DEFS}\n{body}\n</svg>\n')
print("wrote use-case.svg")
