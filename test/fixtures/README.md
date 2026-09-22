# Upstream Brotli corpus

The 19 `upstream/*.br` files are copied without modification from `google/brotli/js/test_data.tar` at revision `a3abcbee0d945e51dddeec81e647ffe0cde182c2`. See the root `THIRD_PARTY_NOTICES.md` and `LICENSE`.

The first 16 hexadecimal filename characters are upstream CRC-64 output fingerprints. Before recording `manifest.json`, the decoded output of every fixture was checked against that fingerprint. The manifest records output lengths and SHA-256 hashes, avoiding storage of duplicate uncompressed files.

`test/corpus.test.ts` validates the JavaScript decoder against that manifest. The same manifest and compressed files are used by `scripts/check-browser.ts`. The fixtures are test-only and are not published with the package.
