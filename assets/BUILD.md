# Vendored assets

Everything the app needs at runtime is in this folder. There is **no build step** and
**no network dependency** — `index.html` + `assets/` is the whole deployable.

## Framework — Preact (replaces React 18 UMD from unpkg)

| file | source | notes |
|------|--------|-------|
| `preact.umd.js`  | `preact@10.29.8/dist/preact.umd.js`        | global `preact` |
| `hooks.umd.js`   | `preact@10.29.8/hooks/dist/hooks.umd.js`   | global `preactHooks` |
| `compat.umd.js`  | `preact@10.29.8/compat/dist/compat.umd.js` | global `preactCompat` |

`index.html` loads the three in order, then sets `window.React = window.ReactDOM =
window.preactCompat`. The app code is unchanged except the mount call, which uses
`ReactDOM.render(vnode, el)` (compat has no `createRoot`).

To update: re-download the three files at a pinned version from
`https://cdn.jsdelivr.net/npm/preact@<version>/...` and bump the comment in `index.html`.

## Fonts

Source families:

- **Inter** — `latin-400-normal` / `latin-600-normal` from the fontsource CDN.
- **Noto Nastaliq Urdu** — variable TTF from `github.com/google/fonts/ofl/notonastaliqurdu`,
  instanced to `wght=500`.
- **Noto Naskh Arabic** — `arabic-500-normal` from fontsource. Kept as `nna-500.woff2` but
  **not referenced** by `index.html`. It is the lightweight fallback (~14 KB vs ~108 KB) to
  swap in if Nastaliq load time is unacceptable on a target device — change the one
  `@font-face src` and the `--font-ur` stack.

Regeneration (needs `pip install fonttools brotli`):

```sh
# Inter — subset to the Latin glyphs the UI actually renders
for w in 400 600; do
  pyftsubset inter-$w-source.woff2 \
    --unicodes="U+0020-007E,U+00A0,U+00D7,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2026,U+2192,U+2212" \
    --layout-features='kern' --no-hinting --desubroutinize \
    --flavor=woff2 --output-file=inter-$w.woff2
done

# Noto Nastaliq Urdu — instance to one weight, then subset to the Urdu repertoire
python3 -m fontTools.varLib.instancer 'NotoNastaliqUrdu[wght].ttf' wght=500 -o nnu-500.ttf
pyftsubset nnu-500.ttf \
  --unicodes="U+0020-0021,U+0028-0029,U+002D-002E,U+0030-0039,U+060C,U+061F,U+0621-063A,U+0641-0652,U+0654-0655,U+0660-066A,U+0670,U+0679,U+067E,U+0686,U+0688,U+0691,U+0698,U+06A9,U+06AF,U+06BA,U+06BE,U+06C1,U+06C3,U+06CC,U+06D2,U+06D4,U+06F0-06F9,U+200C-200D,U+2013-2014,U+2018-2019,U+201C-201D,U+2026,U+FDF2" \
  --layout-features='*' --no-hinting --desubroutinize \
  --flavor=woff2 --output-file=nnu-500.woff2
```

The Nastaliq unicode set is a full Urdu repertoire (not just the glyphs in the current
strings), so adding Urdu UI text in later phases does not require re-subsetting. If you add
a character outside it, extend the `--unicodes` list and rerun.
