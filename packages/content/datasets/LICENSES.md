# Dataset licenses

Every dataset a Track 2 level provides through the `data` module is listed
here with its source, license and size (plan: Resource policy; E-ML-07).
Only public-domain or permissive licenses are allowed, and each level stays
within 20 MB of data.

| Id | Used by | Source | License | Size |
| --- | --- | --- | --- | --- |
| `digits-8x8` | `digit-recognizer` | Generated in code by [`digits.ts`](digits.ts): 5×7 digit glyphs drawn for this project, placed in an 8×8 grid with seeded shifts, stroke gaps and noise. Nothing is downloaded or derived from another dataset. | CC0-1.0 (public domain dedication) | 1,800 images × 64 values, about 0.5 MB as JSON; generated at load, no file shipped |

## Adding a dataset

- Record the exact source URL (fetched, not written from memory), the
  license name and a link to its text, and the size per level.
- Prefer generating data in code from a seed when the level only needs a
  toy distribution: it has no license risk and nothing to download.

## Text for the language-model levels (Track 2, phases 4 to 7)

Two public-domain works by William Shakespeare from Project Gutenberg, in
[`text/`](text/), registered by [`text/index.ts`](text/index.ts). Each
`.txt` is the eBook's plain-text file with the Project Gutenberg header and
footer removed (everything outside the `*** START OF` / `*** END OF` lines),
as Project Gutenberg asks when a public-domain text is redistributed without
its trademark. The text was then normalized to ASCII: curly quotes to `'`
and `"`, the em dash to `--`, `æ` to `ae`, CRLF to LF, and runs of blank
lines collapsed to one blank line. Nothing else was changed.

| Id | Used by | Source | License | Size |
| --- | --- | --- | --- | --- |
| `text-macbeth` | `bigram-lm`, `train-tiny-gpt`, `loss-perplexity`, `fine-tuning`, `lora`, `scaling-experiment` | *Macbeth* by William Shakespeare, Project Gutenberg eBook #1533: page <https://www.gutenberg.org/ebooks/1533> (title seen: "Macbeth by William Shakespeare \| Project Gutenberg"), text <https://www.gutenberg.org/cache/epub/1533/pg1533.txt>. Verified 2026-10-05. | Public domain in the USA (the eBook page's "Copyright Status") | 104,581 bytes |
| `text-sonnets` | `fine-tuning`, `lora` | *Shakespeare's Sonnets* by William Shakespeare, Project Gutenberg eBook #1041: page <https://www.gutenberg.org/ebooks/1041> (title seen: "Shakespeare's Sonnets by William Shakespeare \| Project Gutenberg"), text <https://www.gutenberg.org/cache/epub/1041/pg1041.txt>. Verified 2026-10-05. | Public domain in the USA (the eBook page's "Copyright Status") | 96,210 bytes |
