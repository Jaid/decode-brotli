All fixtures needed by the regular tests are checked into the repository.

Additional release validation:

```sh
bun run build
bun run test:fuzz
bun run test:browser
```

`test:fuzz` runs 100 000 deterministic differential cases against native Brotli. `test:browser` runs the aggressive production bundle in a current Chromium-family browser against all 19 upstream corpus vectors and error handling.

`bun run build` produces the browser-compatible ESM package under `dist/decode-brotli/production/`, including `lib.js`, declarations, documentation and third-party notices.

The native Brotli encoder/decoder is used only as an independent test oracle. The production build contains neither test fixtures nor development dependencies.
