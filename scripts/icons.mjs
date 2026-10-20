// Génère les icônes PNG (web et Android) à partir de assets/icon.svg (nécessite Playwright).
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const root = new URL('..', import.meta.url).pathname;
const svg = readFileSync(`${root}assets/icon.svg`, 'utf8');
// Premier plan de l'icône adaptative Android : le motif sans son fond, dans la zone sûre.
const foreground = svg.replace(/<rect[^>]*\/>/, '');
const res = `${root}android/app/src/main/res`;
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(path, size, source, scale, background) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * scale);
  await page.setContent(
    `<body style="margin:0;background:${background};display:grid;place-items:center;width:${size}px;height:${size}px">${source.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</body>`,
  );
  await page.screenshot({ path, omitBackground: background === 'transparent' });
}

await render(`${root}assets/icon-192.png`, 192, svg, 1, 'transparent');
await render(`${root}assets/icon-512.png`, 512, svg, 1, 'transparent');
await render(`${root}assets/icon-maskable-512.png`, 512, svg, 0.76, '#06101b');
for (const [name, k] of Object.entries(densities)) {
  mkdirSync(`${res}/mipmap-${name}`, { recursive: true });
  await render(`${res}/mipmap-${name}/ic_launcher.png`, Math.round(48 * k), svg, 1, 'transparent');
  await render(`${res}/mipmap-${name}/ic_launcher_foreground.png`, Math.round(108 * k), foreground, 0.62, 'transparent');
}
await browser.close();
console.log('Icônes générées.');
