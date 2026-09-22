import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import manifest from '../test/fixtures/manifest.json'

const windowsChrome = process.platform === 'win32' && await Bun.file('C:/Program Files/Google/Chrome/Application/chrome.exe').exists()
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  : undefined
const binary = Bun.env.CHROMIUM_BIN ?? Bun.which('chromium') ?? Bun.which('google-chrome') ?? windowsChrome
if (!binary) throw new Error('Set CHROMIUM_BIN to a current Chromium executable.')
const profile = await mkdtemp(join(tmpdir(), 'decode-brotli-browser-'))
const completion = Promise.withResolvers<string>()
const html = `<!doctype html><meta charset="utf-8"><title>decode-brotli browser validation</title>
<script type="module">
try {
  const {default: decode, BrotliDecodeError} = await import('/lib.js');
  const manifest = await (await fetch('/manifest')).json();
  for (const entry of manifest) {
    const input = new Uint8Array(await (await fetch('/fixture/' + entry.file)).arrayBuffer());
    const output = decode(input);
    if (output.length !== entry.bytes) throw Error('Length mismatch: ' + entry.file);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', output)).toHex();
    if (hash !== entry.sha256) throw Error('Digest mismatch: ' + entry.file);
  }
  for (const [input, options, code] of [
    [new Uint8Array(), {}, 'UNEXPECTED_EOF'],
    [new Uint8Array([6, 0]), {}, 'TRAILING_DATA'],
    [new Uint8Array([0x9b, 0xff, 0xff, 0xff]), {maxOutputLength: 8}, 'OUTPUT_LIMIT']
  ]) {
    let rejected = false;
    try { decode(input, options); }
    catch (error) { rejected = error instanceof BrotliDecodeError && error.code === code; }
    if (!rejected) throw Error('Expected ' + code);
  }
  await fetch('/result', {method: 'POST', body: 'PASS: ' + manifest.length + ' corpus vectors and error handling in ' + navigator.userAgent});
} catch (error) {
  await fetch('/result', {method: 'POST', body: 'FAIL: ' + error.stack});
}
</script>`
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/') return new Response(html, {headers: {'Content-Type': 'text/html'}})
    if (path === '/lib.js') return new Response(Bun.file(new URL('../dist/decode-brotli/production/lib.js', import.meta.url)), {headers: {'Content-Type': 'text/javascript'}})
    if (path === '/manifest') return Response.json(manifest)
    if (path.startsWith('/fixture/')) {
      const file = path.slice('/fixture/'.length)
      if (manifest.some(entry => entry.file === file)) return new Response(Bun.file(new URL('../test/fixtures/upstream/' + file, import.meta.url)))
    }
    if (path === '/result' && request.method === 'POST') {
      completion.resolve(await request.text())
      return new Response('OK')
    }
    return new Response('Not found.', {status: 404})
  },
})
let browser: ReturnType<typeof Bun.spawn> | undefined
let timer: ReturnType<typeof setTimeout> | undefined
try {
  browser = Bun.spawn([binary, '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--user-data-dir=' + profile, server.url.href], {stdout: 'ignore', stderr: 'ignore'})
  const result = await Promise.race([
    completion.promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Chromium validation timed out.')), 60000) }),
    browser.exited.then(code => { throw new Error('Chromium exited before reporting: ' + code) }),
  ])
  console.log(result)
  if (!result.startsWith('PASS:')) throw new Error('Browser validation failed.')
} finally {
  clearTimeout(timer)
  browser?.kill()
  await browser?.exited
  await server.stop(true)
  await rm(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 200})
}
