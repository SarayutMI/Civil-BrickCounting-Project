const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const { parseView, isIdentity, filterChain, applyView } = require('../imageView');

test('parseView validates and normalises', () => {
  assert.deepStrictEqual(parseView({}).view, { rotate: 0, flipH: false, flipV: false, zoom: 1, cx: 0.5, cy: 0.5 });
  assert.match(parseView({ rotate: 45 }).error, /rotate/);
  assert.match(parseView({ zoom: 0.5 }).error, /zoom/);
  assert.match(parseView({ zoom: 6 }).error, /zoom/);
  assert.match(parseView({ cx: 2 }).error, /ตำแหน่ง/);
  assert.strictEqual(parseView({ rotate: '90', flipH: 1 }).view.flipH, true);
});

test('identity views need no ffmpeg pass', async () => {
  assert.ok(isIdentity({ rotate: 0, zoom: 1 }));
  assert.strictEqual(filterChain({ rotate: 0, zoom: 1, cx: 0.9 }), ''); // pan is meaningless without zoom
  const buf = Buffer.from('not-a-jpeg');
  assert.strictEqual(await applyView(buf, { rotate: 0, zoom: 1 }), buf);
});

test('applyView rotates / zooms a real JPEG (needs ffmpeg)', async (t) => {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch (_) { return t.skip('ffmpeg not installed'); }
  const src = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=1', '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'], { maxBuffer: 1 << 24 });
  const size = (buf) => execFileSync('ffprobe', ['-v', 'error', '-f', 'image2pipe', '-i', 'pipe:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0'], { input: buf }).toString().trim();
  assert.strictEqual(size(await applyView(src, parseView({ rotate: 90 }).view)), '360,640'); // landscape -> portrait
  assert.strictEqual(size(await applyView(src, parseView({ rotate: 180, flipH: true }).view)), '640,360');
  assert.strictEqual(size(await applyView(src, parseView({ zoom: 2, cx: 0.25, cy: 0.25 }).view)), '640,360'); // zoom keeps frame size
});
