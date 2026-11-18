# World Orogen — D&D edition

A personal fork of [World Orogen](https://github.com/raguilar011095/planet_heightmap_generation) by Robert Aguilar (GPL-3.0), adapted to build worlds for D&D campaigns. Two tools: **Generate** (generate.html) and **Import** (import.html, your own heightmap). Evolution is not part of this fork.

What changes from the original:

- **Left panel**: generation only. Generate: detail, continents, land coverage and plates with *Generate world*; Import: your heightmap and its detail with *Import*. Both: the number of kingdoms and cities with *Generate kingdoms* (each slider has a box to type its value — for plates, continents, kingdoms and cities without a ceiling, the continents no more than the plates; plates and continents past the planet code's range are kept in a suffix, `~p<plates>c<continents>`; the other controls are hidden for now).
- **Right side**: visualisation only, in a rail of icons; the panels it opens lie over the map without moving it.
- **Composable map**: a base (antique Terrain, Satellite, Temperature for the year/January/July with the sea all blue, Fertility with farmland, aridity or growing season) and, stacked over it, Politics, Winds or Sea currents, and Geology material by material (likely zones and the richest deposits; Generate only).
- **Rivers**: a level in place of the switch — Off, Low, Medium, High.
- **Wishes and conditions**: each kingdom's wish (climate, temperature, humidity, sea, height, mountains, river, seas, currents, fertility, riches — gems or a metal's main mines —, holds the sources of a material (its richest deposits held as outposts: as a condition every one, as a preference those within reach), near another kingdom) can be ticked *Must*: a condition, which must hold, rather than a preference. A world where no place meets them says so.
- **Routes**: roads and river ways black, sea routes blue, main ones solid, the rest dashed. The winds' and currents' arrows red when warmer than their latitude, blue when colder.
- **Close-ups**: the kingdoms' colours, the arrows and the materials' zones stay when zoomed far in.
- **Degrees**: a switch beside Grid lines shows or hides the degree numbers round the map.
- **Mouse**: the map fills the window, under the panels. Left button: drag to move the map (the globe: to turn it), click a city then a second one for the journey between them — the best way with a river boat and the best without, their days and how they are spent. Right button: drag to turn the map's centre (the globe: to turn it); Ctrl + right click adds a city. Middle button: move the view. Wheel: zoom. Double-click a city or a kingdom to rename it. The readout of the place under the pointer sits in the bottom-right corner. Van der Grinten, hillshade always on, no clouds, rivers by regime from dark blue to sky blue.
- **Kingdoms and cities** (`js/realm/`): placed where food, fresh water and harbours meet, balanced to feed themselves, with a summary per kingdom. Every piece of land belongs to a kingdom (no wilds), shown by its colour alone (no border lines). Each kingdom can be given a colour and where its people like to live — climate, temperature, humidity, the sea or inland, height, mountains, a big river, calm or rough seas: its capital stands where most of these hold. Borders settle on natural frontiers (high ranges, deserts, ice, barren land, great rivers, the sea), except for a people at home in them — mountain folk hold their mountains whole, desert folk their desert, seafarers cross the sea. Towns stand on each kingdom's best ground (food, fresh water, harbours, its people's wishes, away from the border), spread over the whole of it; a kingdom can have several capitals (the first, then its biggest towns). On the map the names come in tiers, all or none: the kingdoms' (else listed in the legend), then the capitals', then — only if every capital fits — the towns'. The peoples are remembered from world to world; a link `generate.html?realm=…` (base64url JSON: `{ cities, kingdoms: [{ name, color, cities: [names], capitals, prefs: { climate, temp, rain, sea, height, mountains, river, waters } }] }`) sets them up. Names editable; kept by the browser per planet code (or per imported image).
- **Plate editing**: Ctrl-click a piece to raise or sink it, or Ctrl-drag: a closed loop marks every piece inside it, an open line the pieces it passes over; then Rebuild.
- **Politics switches**: kingdom colours, capitals, cities, names, roads and routes — each shown or hidden, on the map and in the export, remembered by the browser.
- **One network**: every city is linked to the rest — no city or group of cities is cut off: groups are joined by their cheapest way, by sea when they must.
- **River boats**: a traveller may get a boat at a navigable river (3 days), then rows downstream fast and upstream slowly (60 km a day × (1 + 0.6 × the current along)), and carries it over land between rivers (walking 2.5 times slower) until leaving it. Rivers cost nothing to cross on foot.
- **Roads and routes**: roads, river ways and sea routes that account for winds, currents, ice and the open sea, with the current's arrows along the sea routes; times in days.
- **Export**: saves the map exactly as composed, in the chosen projection.

---

# World Orogen

**Believable worlds from the ground up: a free studio of planet tools that gets you from a blank page to a world that
makes sense.**

[![Live Site](https://img.shields.io/badge/Try_it-orogen.studio-brightgreen)](https://orogen.studio/) ![Three.js](https://img.shields.io/badge/Three.js-0.160.0-blue) ![No Build](https://img.shields.io/badge/build-none-green)

World Orogen builds planets the way the worldbuilding guides teach you to by hand: plates and their history first, then
the land, its climate, its water and ice, its rock, and what the land could feed. It runs in your browser, with no
install, no account and nothing to pay.

The science behind each layer is real, simplified, named and credited, so anyone who knows the guides can follow what it
is doing and see where it takes a shortcut. But these are possible worlds, not predictions. Much of a planet is a roll
of the dice, and what its people make of it is up to you.

The project's full vision is in [VISION.md](VISION.md).

## The tools

### Generate: a planet in seconds, shaped by hand

**[orogen.studio/generate](https://orogen.studio/generate)** · [guide](docs/generate.md)

Set the continents, plates and climate with sliders, then reshape any plate you don't like: Ctrl-click (⌘-click on a Mac)
on a desktop, or tap in edit mode on a phone. Every planet gets a past in closed form (old mountain belts, cratons,
hotspot tracks, continents that fit) and, a few seconds after it appears, Evolution's own finish: its climate, rivers and
lakes, an ice age, a satellite view with clouds, its rocks and ores, and its food. A planet code rebuilds it exactly. The
fastest of the tools, and the most at home on a phone.

### Import: your own landmass, its climate

**[orogen.studio/import](https://orogen.studio/import)** · [guide](docs/import.md)

Upload an equirectangular heightmap, whether hand-drawn, from another tool or of a real planet, and Orogen wraps it onto
a globe and runs the full climate on it, with its rivers and lakes, ice age, satellite view and food, and optional
erosion and sculpting. It opens with Earth, so you can see how well the climate matches.

### Evolution: a planet with a past

**[orogen.studio/evolution](https://orogen.studio/evolution)** · [guide](docs/evolution.md)

Watch a supercontinent break up, oceans open and close, and continents collide and gather again over hundreds of
millions of years. Stop on a moment and add detail: rivers and lakes, glaciers and fjords, its own climate, a satellite
view with clouds, the rocks, ores and gems its history left (Geology) and what the land could feed (Food, in beta).
Save the whole planet as one file. Works best on a desktop computer for now.

### What they share

[guide](docs/shared.md)

One planet view and layer bar (a globe, or a map in any of ten projections), one seasonal climate, one finish (rivers,
lakes, ice, rocks, food, the satellite view) and one export panel: every map as colour or 16-bit data, in ten
projections, up to 16,384 px wide, as one PNG or a ZIP with a README. Links, planet codes and planet files keep opening, and each minor release from 2.1 on stays online at
`orogen.studio/v/<major>.<minor>/`.

For map making, the exports stack: the terrain in sixteen palettes, the satellite view with or without clouds, Köppen climate zones, hillshade and a land mask, and rivers and lakes, and clouds, on transparent grounds, ready to trace, paint over or bring into a map-making tool.

Every page comes in Paper (light) or Night (dark), following the device or the switch in the top bar.

The Studio, at [orogen.studio](https://orogen.studio/), introduces the tools and the worldbuilding resources behind them.

## Quick start

Serve the project with a local HTTP server (ES modules need one). There is nothing to install and no build step:

```bash
# Node.js, with clean URLs as on orogen.studio (/generate, /import, /evolution)
node tuning/dev-server.mjs 8000

# Or any static server, opening the pages by file name (/generate.html, …)
python3 -m http.server 8000
```

Then open **http://localhost:8000** for the Studio.

## Project structure

```
index.html              Home page: the Studio — the tools with worlds made in each, and curated resources; sends Generate's old links (/#code) on to /generate
generate.html           Generate page — HTML markup + import map + structured data
import.html             Import page — heightmap upload + climate visualization
evolution.html          Evolution page — a planet's tectonic history (v2/)
studio.html             The Studio's old address (/studio): sends on to /
studio.css              Studio page styles
assets/studio/          The Studio's pictures: the hero globe (its still, and globe/: the maps it turns through), the worlds
                        (worlds/: two from each tool), the tools' screenshots
                        (evolution.jpg is Evolution's social image)
assets/social.svg       The GitHub, Bluesky, X and Threads marks for the follow links (one <symbol> each)
tokens.css              The style guide's design tokens (all pages): colours for Paper and Night, type, spacing, corners,
                        lines, sizes and shadows, and the fonts
styles.css              Shared CSS (all pages); today's interface colours are the --ui-* variables at its top
assets/fonts/           The three typefaces, self-hosted (woff2), and their licence (OFL.txt)
assets/brand/           The World Orogen mark, the favicon and app icons (site.webmanifest), and the line icons
robots.txt              Search engine crawler directives
sitemap.xml             Sitemap for search engine indexing
site.webmanifest        Web app manifest (metadata + theming)
llms.txt                AI/LLM-readable site description (AISEO)
humans.txt              Project credits
LICENSE                 The GNU GPL v3.0, verbatim
COPYRIGHT               The copyright notice
CNAME                   Custom domain config (orogen.studio)
404.html                Custom 404 page
preview.png             Social preview image (og:image / Twitter card)
VISION.md               The project's vision: what Orogen is, its pillars, each tool's profile, its scope
CLAUDE.md               Rules for Claude Code sessions (imports VISION.md)
.claude/               Claude Code setup: the look's checklist (skills/orogen-look/) and a hook that runs the style
                        check after edits to stylesheets, pages and interface JS (settings.json)
docs/                   Each tool's guide (generate.md, import.md, evolution.md) and what they share (shared.md)
docs/style-guide/       The look: the brand book, maps and the globe, page patterns, and the components (reference CSS and
                        JS); plans/REDESIGN_PLAN.md moves the app onto it
js/                     Generate and Import (file by file: docs/generate.md, "Code")
v2/                     World Orogen V2 — the Evolution page (/evolution) and the climate every page runs;
                        tectonic *history* engine built in confirmed phases; see v2/README.md and
                        plans/V2_TECTONIC_HISTORY_DESIGN.md. Open /v2/ for the Tectonics Lab (locally: the deploy leaves
                        the labs out);
                        `node v2/tools/check-phase<N>.mjs` runs each phase's headless checks;
                        `node v2/tools/check-style.mjs` checks the pages' CSS against the style guide's tokens;
                        v2/js/view/ holds what every page shares — the planet on screen (planet-view.js) and the layer
                        bar over it (layer-bar.js), the export panel (export-panel.js), its rasters, scales and README
                        (export-raster.js), the map projections (projections.js) and their GLSL inverses for the map
                        view (projection-glsl.js), PNG and ZIP writers; v2/js/present/ is Generate's present-day world
tuning/
  climate/              Automated climate tuning suite — scores the simulated Köppen
                        map of an imported Earth heightmap against the observed
                        Köppen-Geiger classification and optimizes v2/js/climate/config.js
                        parameters to match (see tuning/climate/README.md)
  geology/              earth-deposits.mjs — Evolution's deposit climate tests (bauxite,
                        peat, salt, enriched copper, opal, turquoise) run on observed Earth climate beside
                        where those deposits really are
```

## Dependencies

Loaded via CDN import maps (no installation needed):

- [Three.js](https://threejs.org/) v0.160.0 — 3D rendering
- [Delaunator](https://github.com/mapbox/delaunator) v5.0.1 — 2D Delaunay triangulation

Served with the site, so a page never waits on another server: the typefaces [Cormorant Garamond](https://github.com/CatharsisFonts/Cormorant), [EB Garamond](https://github.com/octaviopardo/EBGaramond12) and [Libre Franklin](https://github.com/googlefonts/Libre-Franklin), in `assets/fonts/`.

## Follow and support

New releases, work in progress and sneak peeks of what's coming, plus the odd planet along the way: [Bluesky](https://bsky.app/profile/did:plc:quknpdz3qcoid5uh4qv27w2t) · [X](https://x.com/worldorogen) · [Threads](https://www.threads.com/@orogen.studio).

If World Orogen has been useful to you, you can support it on [Ko-fi](https://ko-fi.com/orogenstudio). It stays free either way: no ads, no account, nothing locked.

## Using your maps

Maps, heightmaps and images you make with World Orogen are yours to use however you like, including commercially. I claim no rights in them. Raw output may not be protected by copyright, and anyone who enters the same planet code or link gets the same planet, so exclusivity isn't possible. Your own additions on top are yours. Crediting World Orogen is always appreciated. The app's code stays under the GPL-3.0.

## License

World Orogen · Copyright (C) 2026 Robert Aguilar. Free software under the GNU General Public License v3.0 — see [LICENSE](LICENSE).

The typefaces in `assets/fonts/` are their authors' work under the SIL Open Font License 1.1 — see [assets/fonts/OFL.txt](assets/fonts/OFL.txt).

## Acknowledgments

Inspired by [Red Blob Games' planet generation](https://www.redblobgames.com/x/1843-planet-generation/) — Fibonacci sphere meshing, dual-mesh traversal, and distance-field elevation approach.

Additional inspiration and reference from:
- [Worldbuilding Pasta](https://worldbuildingpasta.blogspot.com/) — worldbuilding science and climate reference
- [Artifexian](https://www.youtube.com/@Artifexian) — worldbuilding tutorials and planetary science inspiration
- [Madeline James](https://www.youtube.com/@MadelineJamesWorldbuilds) ([website](https://www.madelinejameswrites.com/)) — worldbuilding methodology and climate design reference
- [Fractal Philosophy](https://www.youtube.com/watch?v=7xL0udlhnqI) — procedural terrain generation inspiration
