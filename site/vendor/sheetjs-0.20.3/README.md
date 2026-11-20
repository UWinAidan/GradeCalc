# SheetJS Community Edition 0.20.3 (pinned)

- File: `xlsx.mini.min.js` from the `dist/` folder of the official package
  `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (downloaded 2026-11-20).
- SHA-256 of `xlsx.mini.min.js`: `0cb353f830d7288385492c83d277b058ddeac664ca51cf1393aa1fd3e2b70939`
- SHA-256 of the package tarball: `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`
- Licence: Apache License 2.0 (`LICENSE`, copied unchanged from the package). Copyright (C) 2012-present SheetJS LLC.
- Unmodified. Served from this site only (no CDN at run time); the page loads it only when you export or import Excel.
- The "mini" build reads and writes .xlsx and CSV; it has no legacy codepage tables (old .xls files may not import).

To update: download the new tarball from cdn.sheetjs.com, replace both files, update this README, the folder name and
`XLSX_SRC` in `site/js/app.js`, then run `node tests/run-tests.js` and `node tests/ui-check.mjs`.
