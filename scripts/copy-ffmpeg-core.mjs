// Copies the ffmpeg.wasm core (the fallback decoder) from node_modules into
// public/ffmpeg/ so it is served from our own site. Runs automatically before
// `npm run dev` and `npm run build`. public/ffmpeg/ is git-ignored.
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/@ffmpeg/core/dist/esm');
const dst = join(root, 'public/ffmpeg');
mkdirSync(dst, { recursive: true });
for (const file of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  const from = join(src, file);
  const to = join(dst, file);
  if (!existsSync(to) || statSync(to).size !== statSync(from).size) copyFileSync(from, to);
}
console.log('ffmpeg core copied to public/ffmpeg/');
