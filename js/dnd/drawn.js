// D&D fork — the Illustrated base: the world as a hand-drawn fantasy map (the look of a map made in a map-maker's
// app): the land on parchment, tinted by its climate; the coast inked, the sea washed with ripples round it; and the
// relief drawn as little icons — mountains, hills, trees, dunes — placed on a jittered grid. Two halves: `drawnColorAt`
// paints the picture's pixels (the land and sea colours, the coast), `drawIcons` draws the icons on top of it.

import { rasterAt } from '../../v2/js/evolution/finish-view.js';
import { finishedClimateValue } from '../../v2/js/evolution/climate-view.js';

export const DRAWN_LAYER = 'dndDrawn';

const INK = [62, 44, 30];
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const mix = (a, b, t, out) => { out[0] = lerp(a[0], b[0], t); out[1] = lerp(a[1], b[1], t); out[2] = lerp(a[2], b[2], t); return out; };

// ── the land's colours: a parchment tinted by how much rain it gets, how cold it is, how high ──
const SAND = [226, 202, 146], STEPPE = [216, 204, 148], GRASS = [184, 193, 116], FOREST = [136, 160, 96], WET = [112, 144, 90];
const SNOW = [242, 240, 232], ROCK = [172, 150, 124], LAKE = [150, 196, 204];
const SEA_NEAR = [176, 220, 214], SEA_MID = [118, 176, 190], SEA_DEEP = [84, 138, 168];

// ── a cheap hash and a value noise: the paper's grain and the washes of colour ──
function hash2(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const NOISE = (() => { const n = new Float32Array(256 * 256); for (let i = 0; i < n.length; i++) n[i] = hash2(i & 255, i >> 8); return n; })();
function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = NOISE[((yi & 255) << 8) | (xi & 255)], b = NOISE[((yi & 255) << 8) | ((xi + 1) & 255)], c = NOISE[(((yi + 1) & 255) << 8) | (xi & 255)], d = NOISE[(((yi + 1) & 255) << 8) | ((xi + 1) & 255)];
    return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

// ── the picture at a width, kept with the moment: its heights and sea, and the distance to the coast of each pixel ──
const caches = new WeakMap();
function cacheOf(fin) { let c = caches.get(fin); if (!c) caches.set(fin, c = { raster: new Map(), coast: new Map() }); return c; }
function rasterOf(fin, W) {
    const c = cacheOf(fin);
    if (!c.raster.has(W)) c.raster.set(W, rasterAt(fin.raster, W, { lakes: true }));
    return c.raster.get(W);
}
/** The distance, in pixels of a `Wd`-wide picture, from each pixel to the coast (the nearest pixel of the other kind,
 *  sea or land): a two-pass chamfer. */
function coastDistance(fin, Wd) {
    const c = cacheOf(fin);
    if (c.coast.has(Wd)) return c.coast.get(Wd);
    const H = Wd >> 1, { sea } = rasterOf(fin, Wd), d = new Float32Array(Wd * H), INF = 1e9, D = Math.SQRT2;
    for (let y = 0; y < H; y++) for (let x = 0; x < Wd; x++) {
        const i = y * Wd + x, s = sea[i];
        const edge = (x > 0 && sea[i - 1] !== s) || (x < Wd - 1 && sea[i + 1] !== s) || (y > 0 && sea[i - Wd] !== s) || (y < H - 1 && sea[i + Wd] !== s);
        d[i] = edge ? 0.5 : INF;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < Wd; x++) {
        const i = y * Wd + x; let v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + 1);
        if (y > 0) { v = Math.min(v, d[i - Wd] + 1); if (x > 0) v = Math.min(v, d[i - Wd - 1] + D); if (x < Wd - 1) v = Math.min(v, d[i - Wd + 1] + D); }
        d[i] = v;
    }
    for (let y = H - 1; y >= 0; y--) for (let x = Wd - 1; x >= 0; x--) {
        const i = y * Wd + x; let v = d[i];
        if (x < Wd - 1) v = Math.min(v, d[i + 1] + 1);
        if (y < H - 1) { v = Math.min(v, d[i + Wd] + 1); if (x < Wd - 1) v = Math.min(v, d[i + Wd + 1] + D); if (x > 0) v = Math.min(v, d[i + Wd - 1] + D); }
        d[i] = v;
    }
    c.coast.set(Wd, d);
    return d;
}

/**
 * The pixel colouring (paintFinished's `colorAt`) of the Illustrated base for a picture of width W.
 * Distances are in "units": pixels of a 2048-wide picture, so the lines are as thick, relative to the map, at any width.
 */
export function drawnColorAt(fin, W) {
    const Wd = Math.min(W, 4096), cd = coastDistance(fin, Wd), Hd = Wd >> 1, toUnits = 2048 / Wd, k = W / 2048, f = Wd / W;
    const T = finishedClimateValue('temperature', 'year', fin.climate, W), P = finishedClimateValue('precip', 'year', fin.climate, W);
    const tmp = [0, 0, 0], tmp2 = [0, 0, 0];
    const dist = (x, y) => {      // (bilinear, in units)
        const fx = Math.min(Wd - 1.001, Math.max(0, x * f - 0.5)), fy = Math.min(Hd - 1.001, Math.max(0, y * f - 0.5));
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, i = y0 * Wd + x0;
        return lerp(lerp(cd[i], cd[i + 1], tx), lerp(cd[i + Wd], cd[i + Wd + 1], tx), ty) * toUnits;
    };
    return (out, o, x, y, wet, kk, k3, v, lake) => {
        const grain = (hash2(x, y) - 0.5) * 0.07, wash = (vnoise(x / (36 * k), y / (36 * k)) - 0.5) * 0.12 + (vnoise(x / (9 * k), y / (9 * k)) - 0.5) * 0.05;
        let c;
        if (wet || lake) {
            const du = dist(x, y);
            if (lake && !wet) c = mix(LAKE, SEA_NEAR, 0.2, tmp);
            else {
                const depth = clamp01(du / 38);
                c = mix(SEA_NEAR, SEA_MID, clamp01(du / 11), tmp);
                c = mix(c, SEA_DEEP, clamp01((du - 11) / 60) * 0.85 + clamp01(-v / 4) * 0.15, tmp);
                // (the ripples: thin darker lines following the coast, fainter the farther out)
                for (let r = 0; r < 3; r++) {
                    const at = 4 + r * 6, a = clamp01(1 - Math.abs(du - at) / 1.1) * (0.62 - r * 0.15);
                    if (a > 0) c = mix(c, [58, 104, 138], a, tmp);
                }
                void depth;
            }
        } else {
            const rain = 12 * P(x, y, false), t = T(x, y, false), du = dist(x, y);
            c = mix(SAND, STEPPE, clamp01(rain / 300), tmp);
            c = mix(c, GRASS, clamp01((rain - 300) / 400), tmp);
            c = mix(c, FOREST, clamp01((rain - 700) / 600), tmp);
            c = mix(c, WET, clamp01((rain - 1500) / 1200) * 0.7, tmp);
            c = mix(c, SNOW, clamp01((2 - t) / 10) * 0.9, tmp);
            c = mix(c, ROCK, clamp01((v - 1.4) / 2.4) * 0.8, tmp);
            c = mix(c, SNOW, clamp01((v - 3.6) / 1.4), tmp);
            // (a darker rim inside the coast, then the inked line)
            const rim = clamp01(1 - du / 7);
            c = mix(c, [150, 120, 84], rim * 0.22, tmp2);
            const ink = clamp01((2 - du) / 0.9);
            if (ink > 0) c = mix(c, INK, ink * 0.92, tmp2);
        }
        // (the paper: the relief's light only a little, and the grain and washes of the page)
        const lit = wet ? 0.97 + 0.03 * kk : 0.82 + 0.18 * kk, n = 1 + grain + wash * (wet ? 0.6 : 1);
        out[o] = Math.min(255, c[0] * lit * n); out[o + 1] = Math.min(255, c[1] * lit * n); out[o + 2] = Math.min(255, c[2] * lit * n); out[o + 3] = 255;
    };
}

// ── the icons ──
const WI = 2048;
function inkStroke(ctx, w) { ctx.lineWidth = w; ctx.strokeStyle = `rgb(${INK[0]},${INK[1]},${INK[2]})`; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; }

function mountain(ctx, x, y, s, snow) {
    const w = s * 0.95, h = s * 1.25, px = x + (hash2(x | 0, y | 0) - 0.5) * s * 0.12;
    ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(px, y - h); ctx.lineTo(x + w * 0.1, y); ctx.closePath();
    ctx.fillStyle = 'rgb(206,190,160)'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(px, y - h); ctx.lineTo(x + w * 0.1, y); ctx.lineTo(x + w, y); ctx.closePath();
    ctx.fillStyle = 'rgb(140,120,96)'; ctx.fill();
    if (snow) {
        ctx.beginPath(); ctx.moveTo(px, y - h); ctx.lineTo(px - w * 0.28, y - h * 0.62); ctx.lineTo(px - w * 0.08, y - h * 0.7); ctx.lineTo(px + w * 0.06, y - h * 0.58); ctx.lineTo(px + w * 0.26, y - h * 0.66); ctx.closePath();
        ctx.fillStyle = 'rgb(246,244,238)'; ctx.fill();
    }
    ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(px, y - h); ctx.lineTo(x + w, y); ctx.moveTo(px, y - h); ctx.lineTo(x + w * 0.1, y);
    ctx.stroke();
}
function hill(ctx, x, y, s) {
    const w = s * 0.8, h = s * 0.5;
    ctx.beginPath(); ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x - w * 0.4, y - h * 1.5, x + w * 0.1, y - h * 1.2); ctx.quadraticCurveTo(x + w * 0.7, y - h, x + w, y); ctx.closePath();
    ctx.fillStyle = 'rgb(196,180,134)'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + w * 0.1, y - h * 1.2); ctx.quadraticCurveTo(x + w * 0.7, y - h, x + w, y); ctx.lineTo(x + w * 0.2, y); ctx.closePath();
    ctx.fillStyle = 'rgb(160,140,100)'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x - w * 0.4, y - h * 1.5, x + w * 0.1, y - h * 1.2); ctx.quadraticCurveTo(x + w * 0.7, y - h, x + w, y);
    ctx.stroke();
}
function tree(ctx, x, y, s, pine, dark) {
    const g = dark ? [66, 98, 62] : [92, 128, 74], g2 = dark ? [48, 78, 50] : [72, 106, 60];
    if (pine) {
        for (let i = 0; i < 2; i++) {
            const yy = y - i * s * 0.45, w = s * (0.5 - i * 0.12);
            ctx.beginPath(); ctx.moveTo(x, yy - s * 0.75); ctx.lineTo(x - w, yy); ctx.lineTo(x + w, yy); ctx.closePath();
            ctx.fillStyle = i ? `rgb(${g[0]},${g[1]},${g[2]})` : `rgb(${g2[0]},${g2[1]},${g2[2]})`; ctx.fill(); ctx.stroke();
        }
    } else {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - s * 0.3); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y - s * 0.62, s * 0.42, 0, 2 * Math.PI);
        ctx.fillStyle = `rgb(${g[0]},${g[1]},${g[2]})`; ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(x - s * 0.12, y - s * 0.7, s * 0.2, 0, 2 * Math.PI); ctx.fillStyle = 'rgba(190,210,140,0.55)'; ctx.fill();
    }
}
function dune(ctx, x, y, s) {
    ctx.beginPath(); ctx.moveTo(x - s * 0.6, y); ctx.quadraticCurveTo(x - s * 0.2, y - s * 0.5, x + s * 0.2, y - s * 0.1); ctx.quadraticCurveTo(x + s * 0.4, y + s * 0.05, x + s * 0.6, y - s * 0.05);
    ctx.stroke();
}

/** The icons of the picture's relief, drawn over a W-wide picture (a rolled map: call it once shifted, once a width over). */
export function drawIcons(ctx, W, fin) {
    const { h, sea, wat } = rasterOf(fin, WI), f = W / WI, s = W / 150, cell = s * 1.15;
    const T = finishedClimateValue('temperature', 'year', fin.climate, WI), P = finishedClimateValue('precip', 'year', fin.climate, WI);
    const sites = [];
    const cols = Math.ceil(W / cell), rows = Math.ceil((W / 2) / cell);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const r1 = hash2(i, j), r2 = hash2(i + 977, j + 131), r3 = hash2(i + 31, j + 4001);
        const x = (i + 0.15 + 0.7 * r1) * cell, y = (j + 0.15 + 0.7 * r2) * cell;
        const px = Math.min(WI - 1, Math.floor(x / f)), py = Math.min((WI >> 1) - 1, Math.floor(y / f)), p = py * WI + px;
        if (sea[p] || (wat && wat[p])) continue;
        // (not on the coast: the icon would run into the inked line)
        const nb = 2;
        if (sea[Math.max(0, p - nb)] || sea[Math.min(sea.length - 1, p + nb)] || sea[Math.max(0, p - nb * WI)] || sea[Math.min(sea.length - 1, p + nb * WI)]) continue;
        const v = h[p], rain = 12 * P(px, py, false), t = T(px, py, false);
        if (v > 1.6) { if (r3 < clamp01(0.35 + (v - 1.6) / 2.2)) sites.push({ x, y, k: 'm', s: s * (0.7 + 0.5 * clamp01((v - 1.6) / 4) + 0.2 * r1), snow: v > 3.4 || t < -2 }); }
        else if (v > 0.55) { if (r3 < 0.55) sites.push({ x, y, k: 'h', s: s * (0.7 + 0.3 * r1) }); }
        else if (t > -4 && rain > 620 && v < 1.5) {
            const dens = clamp01((rain - 620) / 1100) * 0.7 + 0.12;
            if (r3 < dens) sites.push({ x, y, k: 't', s: s * (0.62 + 0.3 * r2), pine: t < 9, dark: rain > 1500 });
        } else if (rain < 220 && t > 5 && r3 < 0.14) sites.push({ x, y, k: 'd', s: s * 0.8 });
    }
    sites.sort((a, b) => a.y - b.y);
    ctx.save();
    inkStroke(ctx, Math.max(0.8, W / 2048 * 0.9));
    for (const q of sites) {
        if (q.k === 'm') mountain(ctx, q.x, q.y, q.s, q.snow);
        else if (q.k === 'h') hill(ctx, q.x, q.y, q.s);
        else if (q.k === 't') tree(ctx, q.x, q.y, q.s, q.pine, q.dark);
        else dune(ctx, q.x, q.y, q.s);
    }
    ctx.restore();
}

export function drawnLegend() {
    return `<div class="evo-legend-head">Illustrated</div>
        <div class="dnd-leg-note">Mountains, hills, forests and dunes are drawn where the land has them; the paper is tinted by rain and cold. The coast is inked, the sea rippled.</div>`;
}
