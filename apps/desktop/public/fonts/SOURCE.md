# Bundled interface fonts

DnDRom ships the two faces its interface is designed around so the app renders
identically offline and on a machine that has never seen them. Both are variable
fonts covering the whole weight range the interface uses in a single file per
style, and both are subset to Latin the way Google Fonts serves them.

| File | Family | Style | Axes | Subset |
| --- | --- | --- | --- | --- |
| `cinzel-latin.woff2` | Cinzel | normal | `wght` 400–700 | latin |
| `cinzel-latin-ext.woff2` | Cinzel | normal | `wght` 400–700 | latin-ext |
| `eb-garamond-latin.woff2` | EB Garamond | normal | `wght` 400–700 | latin |
| `eb-garamond-latin-ext.woff2` | EB Garamond | normal | `wght` 400–700 | latin-ext |
| `eb-garamond-italic-latin.woff2` | EB Garamond | italic | `wght` 400–700 | latin |
| `eb-garamond-italic-latin-ext.woff2` | EB Garamond | italic | `wght` 400–700 | latin-ext |

Cinzel is `--font-display` (headings, buttons, section labels). EB Garamond is
`--font-body` and `--font-ui` (everything else). `--font-mono` is not bundled and
still resolves through the `Consolas, monospace` fallback.

## Provenance

Retrieved 2026-09-02 from the Google Fonts CSS API v2, which serves the current
upstream builds:

- Cinzel v26 — `https://fonts.googleapis.com/css2?family=Cinzel:wght@400..700`
  (upstream: https://github.com/NDISCOVER/Cinzel)
- EB Garamond v33 — `https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400..700;1,400..700`
  (upstream: https://github.com/octaviopardo/EBGaramond12)

Only the `latin` and `latin-ext` subsets are bundled. The Cyrillic, Greek and
Vietnamese subsets Google also publishes are omitted; the interface has no copy
in those scripts, and their `unicode-range` declarations in `styles.css` are
omitted to match, so nothing references a file that is not here.

## License

Both families are licensed under the SIL Open Font License 1.1, which permits
bundling and redistribution with an application. The full upstream license texts
are preserved beside the fonts as `CINZEL-OFL.txt` and `EB-GARAMOND-OFL.txt`.

## Updating

Re-fetch the CSS with a modern browser `User-Agent` (the API serves WOFF2 only to
UAs it recognises), take the `latin` and `latin-ext` `@font-face` blocks, download
the `.woff2` each `src` points at, and keep the `unicode-range` values in
`apps/desktop/src/styles.css` in step with the ones the API returns.
