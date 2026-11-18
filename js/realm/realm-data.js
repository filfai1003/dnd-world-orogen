// D&D fork — the realm's grid: what the finished planet hands up to the kingdoms, cities and routes (realm-worker.js),
// read once per finished world onto a coarse equirectangular grid (GW × GH, rows north → south, columns from −180°).
//
// Per cell: land or water (sea or lake), mean and highest height, the Köppen class, the biggest river's discharge, the
// wetlands, and what the land could feed — people a km² and their way of life and staple food, as the Food view works
// them out (farming/living.js livingPlace, with every farming technique on) — and, from the 1° climate, the year's
// winds, surface currents and sea ice, for the sea routes.

import { farmPlace, harvestsAt, hasHarvests, Staple, STAPLES, CROPS } from '../../v2/js/farming/farming.js';
import { gatherGround, gatherAt, livingPlace } from '../../v2/js/farming/living.js';
import { materialGrids, MATERIALS } from '../dnd/composer.js';
import { KOPPEN_CLASSES } from '../../v2/js/climate/koppen.js';
import { farmOptions } from '../../v2/js/evolution/farming-view.js';

export const GW = 1024, GH = 512;

/** The realm grid of a finished world `fin` ({ raster, rivers, climate }). */
export function realmGrid(fin) {
    const R = fin.raster, n = GW * GH;
    const land = new Uint8Array(n), lake = new Uint8Array(n), heightM = new Float32Array(n), peakM = new Float32Array(n);
    const koppen = new Uint8Array(n), riverQ = new Float32Array(n), wetland = new Float32Array(n);
    const people = new Float32Array(n), lifestyle = new Uint8Array(n), staple = new Uint8Array(n);
    const tempC = new Float32Array(n).fill(NaN), rainMm = new Float32Array(n).fill(NaN);
    const windU = new Float32Array(n), windV = new Float32Array(n), curU = new Float32Array(n), curV = new Float32Array(n), seaIce = new Float32Array(n);

    // ── the ground: land share, lakes and heights, from the finished picture (a few samples a cell) ──
    const sx = R.w / GW, sy = R.h / GH, S = 3;
    for (let y = 0; y < GH; y++) {
        for (let x = 0; x < GW; x++) {
            let nl = 0, nk = 0, sum = 0, top = -1e9, k = 0;
            for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) {
                const px = Math.min(R.w - 1, Math.floor((x + (b + 0.5) / S) * sx)), py = Math.min(R.h - 1, Math.floor((y + (a + 0.5) / S) * sy)), i = py * R.w + px;
                const lk = R.water?.[i] ? 1 : 0, ln = !R.ocean[i] && !lk;
                if (ln) { nl++; sum += R.heightM[i]; top = Math.max(top, R.heightM[i]); }
                if (lk) nk++;
                k++;
            }
            const c = y * GW + x;
            land[c] = nl * 2 > k ? 1 : 0;
            lake[c] = !land[c] && nk * 2 > k - nl ? 1 : 0;
            heightM[c] = nl ? sum / nl : 0;
            peakM[c] = nl ? top : 0;
        }
    }

    // ── the climate's picture: Köppen classes; and the food, as the Food view reckons it ──
    const L = fin.climate?.raster ?? R.climate, F = R.farming;
    const Cl = fin.climate?.Tsea ? fin.climate : (fin.climate?.page ?? fin.climate);
    const ground = F ? gatherGround(R, Cl) : null, kept = hasHarvests(F);
    const p = {}, e = new Float64Array(2 * CROPS.length), r = { scores: new Float64Array(STAPLES.length), foods: new Float64Array(STAPLES.length) }, g = {}, o = {};
    for (let y = 0; y < GH; y++) {
        const lat = 90 - (y + 0.5) / GH * 180;
        for (let x = 0; x < GW; x++) {
            const c = y * GW + x;
            if (L) {
                const i = Math.min(L.h - 1, Math.floor((y + 0.5) / GH * L.h)) * L.w + Math.min(L.w - 1, Math.floor((x + 0.5) / GW * L.w));
                koppen[c] = L.koppen[i];
                if (L.tAnnual && L.tAnnual[i] !== -32768) tempC[c] = L.tAnnual[i] / 100;
                if (L.pAnnual) rainMm[c] = L.pAnnual[i];
            }
            if (!land[c] || !F) continue;
            const i = Math.min(F.h - 1, Math.floor((y + 0.5) / GH * F.h)) * F.w + Math.min(F.w - 1, Math.floor((x + 0.5) / GW * F.w));
            if (koppen[c] === KOPPEN_ID_EF) continue;
            p.soil = F.soil[i] / 255; p.rain = F.rain[i] / 20; p.warm = F.warm[i] / 20; p.flood = F.flood[i] / 255; p.canal = F.canal[i] / 255;
            p.slope = 2 * F.slope[i]; p.wetland = F.wetland[i] / 255;
            wetland[c] = p.wetland;
            if (kept) harvestsAt(F.crops, i, e); else e.fill(0);
            if (kept) farmPlace(p, e, F.pasture[i] / 255, farmOptions, r);
            else { r.tech = r.rain = r.score = 0; r.staple = r.second = Staple.NONE; }
            gatherAt(ground, lat, (x + 0.5) / GW * 360 - 180, p, F.pasture[i] / 255, g);
            livingPlace(r, p, farmOptions, g, o);
            people[c] = o.people; lifestyle[c] = o.lifestyle; staple[c] = o.staple;
        }
    }

    // ── the rivers: each cell its biggest discharge (m³/s) ──
    const Rv = fin.rivers;
    const cellOf = (k) => Math.min(GH - 1, Math.max(0, Math.floor((90 - Rv.lat[k]) / 180 * GH))) * GW + Math.min(GW - 1, Math.floor((Rv.lon[k] + 180) / 360 * GW));
    if (Rv?.lat) for (let k = 0; k < Rv.lat.length; k++) { const c = cellOf(k); if (Rv.q[k] > riverQ[c]) riverQ[c] = Rv.q[k]; }
    // (D&D fork: which way each river runs — downstream, where its water grows — as a unit vector east, north per cell)
    const flowU = new Float32Array(n), flowV = new Float32Array(n);
    if (Rv?.lat && Rv.start) {
        const S = Rv.start, N = Rv.lat.length;
        for (let j = 0; j < S.length; j++) {
            const a = S[j], b = (j + 1 < S.length ? S[j + 1] : N) - 1;
            if (b <= a) continue;
            const sign = Rv.q[b] >= Rv.q[a] ? 1 : -1;
            for (let k = a; k < b; k++) {
                let dl = Rv.lon[k + 1] - Rv.lon[k]; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
                const e = dl * Math.cos(Rv.lat[k] * Math.PI / 180), nn = Rv.lat[k + 1] - Rv.lat[k], c = cellOf(k), w = Rv.q[k];
                flowU[c] += sign * e * w; flowV[c] += sign * nn * w;
            }
        }
        for (let c = 0; c < n; c++) { const l = Math.hypot(flowU[c], flowV[c]); if (l > 0) { flowU[c] /= l; flowV[c] /= l; } }
    }

    // ── the year's winds, currents and sea ice (the 1° climate: 360 × 180, rows from the north, columns from −180°) ──
    const grid = Cl?.grid ?? { w: 360, h: 180 };
    const at = (f, c1) => (f ? f[c1] : 0);
    const U = Cl?.u?.year, V = Cl?.v?.year, CU = Cl?.currentU?.year, CV = Cl?.currentV?.year, IC = Cl?.seaIce?.year;
    for (let y = 0; y < GH; y++) {
        const j = Math.min(grid.h - 1, Math.floor((y + 0.5) / GH * grid.h));
        for (let x = 0; x < GW; x++) {
            const c = y * GW + x, c1 = j * grid.w + Math.min(grid.w - 1, Math.floor((x + 0.5) / GW * grid.w));
            windU[c] = at(U, c1); windV[c] = at(V, c1); curU[c] = at(CU, c1) || 0; curV[c] = at(CV, c1) || 0; seaIce[c] = Math.max(0, Math.min(1, at(IC, c1) || 0));
        }
    }

    // ── the materials (D&D fork): each one's richness per cell, 0…255 — the best deposit in it ──
    const ores = {}, MG = materialGrids(fin);
    if (MG) for (const m of MATERIALS) {
        const v = MG.grids.get(m.id)?.raw; if (!v) continue;
        const o = new Uint8Array(n);
        for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
            const y0 = Math.floor(y / GH * MG.h), y1 = Math.max(y0 + 1, Math.floor((y + 1) / GH * MG.h)), x0 = Math.floor(x / GW * MG.w), x1 = Math.max(x0 + 1, Math.floor((x + 1) / GW * MG.w));
            let best = 0; for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) best = Math.max(best, v[yy * MG.w + xx]);
            o[y * GW + x] = Math.round(255 * best);
        }
        ores[m.id] = o;
    }
    return { GW, GH, ores, flowU, flowV, land, lake, heightM, peakM, koppen, tempC, rainMm, riverQ, wetland, people, lifestyle, staple, windU, windV, curU, curV, seaIce };
}
const KOPPEN_ID_EF = KOPPEN_CLASSES.findIndex(k => k.code === 'EF');
/** The Köppen codes by index (the worker reads the letters). */
export const KOPPEN_CODES = KOPPEN_CLASSES.map(k => k.code);
