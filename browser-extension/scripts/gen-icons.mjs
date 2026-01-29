/**
 * 从 peanut.svg 生成灰色/绿色背景的各尺寸 PNG
 * 运行: npm install sharp && node scripts/gen-icons.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'icons');
const sizes = [16, 32, 48, 128];

const peanutSvg = readFileSync(join(iconsDir, 'peanut.svg'), 'utf8');
const peanutPaths = peanutSvg
  .replace(/<svg[^>]*>/, '')
  .replace(/<\/svg>/, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .trim();

function svgWithBackground(color, size) {
  const bg = `<circle cx="${size/2}" cy="${size/2}" r="${size/2 - 1}" fill="${color}"/>`;
  const scale = size / 36;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bg}
  <g transform="scale(${scale})">${peanutPaths}</g>
</svg>`;
}

async function main() {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.error('请先安装 sharp: cd browser-extension && npm install sharp');
    process.exit(1);
  }

  const colors = [
    { name: 'gray', hex: '#6b7280' },
    { name: 'green', hex: '#22c55e' },
  ];

  for (const { name, hex } of colors) {
    for (const size of sizes) {
      const svg = svgWithBackground(hex, size);
      const out = join(iconsDir, `icon-${name}-${size}.png`);
      await sharp(Buffer.from(svg)).png().toFile(out);
      console.log('生成', out);
    }
  }
  console.log('完成');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
