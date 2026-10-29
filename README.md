# Mountain Mural Plan

An editor for a layered mountain mural on a 127″ × 91″ wall: reshape the mountains, change the
front/back order and the Behr paint colors, see how much paint each color needs, print the plan,
and trace it onto the wall with a projector.

The app is the `docs/` folder: one self-contained `index.html` plus the files that make it
installable and usable offline (`manifest.webmanifest`, `sw.js`, `icons/`). GitHub Pages serves
that folder.

- **Use it online or install it:** open the Pages URL in Chrome, then ⋮ → **Install app** (Android) or
  the install icon in the address bar (Windows/Mac).
- **Use it from a file:** open `docs/index.html` directly; everything except installing works.
- **Your designs** are saved in each browser separately. Use **Export JSON** / **Import JSON** to back
  them up or move them between devices.

When you change anything in `docs/`, bump `CACHE_VERSION` in `docs/sw.js` so installed copies pick
up the new version (they show an "Update available" banner).

## Behr colors

The paint picker opens on the design's short list (`behrLibrary`). Typing in its search box, or
choosing a family, searches the full Behr catalog (about 5,400 colors) that is embedded in
`index.html`, so it works offline and from a file. Swatches are screen approximations: LRV is
computed from the hex, and real chips should be checked on the wall.

The catalog data comes from [PaintDB](https://paintdb.com), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changes made here: only the Behr rows are
kept, and LRV is recomputed from the hex instead of using PaintDB's column. To refresh it, download
`paintdb-colors.csv` from paintdb.com, then run `node dev/tools/build-behr-catalog.mjs <csv>` and
`node dev/tools/splice.mjs catalog`, and bump `CACHE_VERSION`.
