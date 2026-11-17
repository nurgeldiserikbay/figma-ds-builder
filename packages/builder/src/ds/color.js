// Цвет: sRGB ↔ Lab (D65), ΔE2000, LCh, контраст WCAG.

export const clamp01 = (v) => Math.max(0, Math.min(1, v));
const h2 = (v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');

export function toHex({ r, g, b }, a = 1) {
  const base = `#${h2(r)}${h2(g)}${h2(b)}`.toUpperCase();
  return a >= 0.995 ? base : base + h2(a).toUpperCase();
}

export function fromHex(hex) {
  const s = hex.replace('#', '');
  return {
    r: parseInt(s.slice(0, 2), 16) / 255, g: parseInt(s.slice(2, 4), 16) / 255, b: parseInt(s.slice(4, 6), 16) / 255,
    a: s.length >= 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1,
  };
}

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export function toLab({ r, g, b }) {
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export const chroma = (lab) => Math.hypot(lab.a, lab.b);
export const hue = (lab) => ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360;

/** CIEDE2000 */
export function deltaE(l1, l2) {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(l1.a, l1.b), C2 = Math.hypot(l2.a, l2.b);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1 = (1 + G) * l1.a, a2 = (1 + G) * l2.a;
  const c1 = Math.hypot(a1, l1.b), c2 = Math.hypot(a2, l2.b);
  const h = (a, b) => (a === 0 && b === 0 ? 0 : ((Math.atan2(b, a) / rad) + 360) % 360);
  const h1 = h(a1, l1.b), hh2 = h(a2, l2.b);
  const dL = l2.L - l1.L, dC = c2 - c1;
  let dh = 0;
  if (c1 * c2 !== 0) {
    dh = hh2 - h1;
    if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin((dh / 2) * rad);
  const Lm = (l1.L + l2.L) / 2, cm = (c1 + c2) / 2;
  let hm = h1 + hh2;
  if (c1 * c2 !== 0) {
    if (Math.abs(h1 - hh2) > 180) hm = hm < 360 ? hm + 360 : hm - 360;
    hm /= 2;
  }
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(cm ** 7 / (cm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * cm, Sh = 1 + 0.015 * cm * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

export function luminance({ r, g, b }) {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(c1, c2) {
  const a = luminance(c1), b = luminance(c2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Наложение цвета с прозрачностью на фон. */
export function over(top, a, bottom) {
  return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a) };
}

// Семейства по тону LCh (границы — между тонами палитры Tailwind в Lab: red ≈40°, orange ≈65°,
// yellow ≈100°, green ≈145°, teal ≈180°, cyan ≈215°, blue ≈265°, indigo ≈285°, violet ≈300°, purple ≈315°, pink ≈350°)
const FAMILIES = [[20, 'pink'], [55, 'red'], [85, 'orange'], [110, 'yellow'], [130, 'lime'], [165, 'green'], [200, 'teal'],
  [228, 'cyan'], [280, 'blue'], [293, 'indigo'], [305, 'violet'], [330, 'purple'], [361, 'pink']];

export function familyOf(lab) {
  if (chroma(lab) < (lab.L >= 85 ? 7 : 12)) return 'gray';
  const h = hue(lab);
  // малонасыщенные сине-серые (#252B42, #475569) — «slate», как в Tailwind
  if (chroma(lab) < 22 && h >= 200 && h < 293) return 'slate';
  for (const [lim, name] of FAMILIES) if (h < lim) return name;
  return 'red';
}

// Светлота «500» у разных тонов разная (жёлтый-500 светлее синего-500)
const L500 = { slate: 48, gray: 55, red: 55, orange: 65, yellow: 80, lime: 75, green: 65, teal: 65, cyan: 70, blue: 55, indigo: 48, violet: 52, purple: 50, pink: 60 };
export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const UP = { 50: 0, 100: 0.1, 200: 0.25, 300: 0.45, 400: 0.72, 500: 1 };
const DOWN = { 600: 0.22, 700: 0.41, 800: 0.61, 900: 0.8, 950: 1 };

export function stepTargets(fam) {
  const m = L500[fam] ?? 55;
  return STEPS.map((k) => (k <= 500 ? 97 - (97 - m) * UP[k] : m - (m - 12) * DOWN[k]));
}

/**
 * Монотонное назначение ступеней: светлее → меньше номер, без повторов, минимум ошибки по L (DP).
 * colors — отсортированы по убыванию L. Если цветов больше, чем ступеней, лишние получают null.
 */
export function assignSteps(colors, fam) {
  const T = stepTargets(fam);
  const n = colors.length, m = STEPS.length;
  if (n > m) return colors.map((c, i) => (i < m ? STEPS[i] : null));
  const INF = 1e9;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(INF));
  const from = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(-1));
  for (let j = 0; j <= m; j++) dp[0][j] = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = i; j <= m; j++) {
      // либо ступень j-1 не используется, либо её берёт цвет i-1
      const skip = dp[i][j - 1];
      const take = dp[i - 1][j - 1] + Math.abs(colors[i - 1].lab.L - T[j - 1]);
      if (take <= skip) { dp[i][j] = take; from[i][j] = 1; } else { dp[i][j] = skip; from[i][j] = 0; }
    }
  }
  const out = new Array(n);
  let i = n, j = m;
  while (i > 0) {
    if (from[i][j] === 1) { out[i - 1] = STEPS[j - 1]; i--; j--; } else j--;
  }
  return out;
}
