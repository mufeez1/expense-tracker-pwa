// Renders public/icons/*.png from an inline SVG using Playwright + local Chrome. Run: node scripts/icons.mjs
import { chromium } from '@playwright/test';
const svg = (pad, size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 112}" fill="#1e2a63"/>
  <g transform="translate(256 256) scale(${pad ? 0.72 : 1}) translate(-256 -256)">
    <rect x="116" y="150" width="280" height="212" rx="36" fill="#fff"/>
    <rect x="116" y="196" width="280" height="40" fill="#c7cbf2"/>
    <circle cx="340" cy="300" r="26" fill="#4f46e5"/>
  </g></svg>`;
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const out = [[72], [96], [128], [144], [152], [192], [384], [512], [180, 'apple-touch-icon', true], [512, 'maskable-512x512', true]];
for (const [size, name = `icon-${size}x${size}`, pad = false] of out) {
  await page.setContent(`<style>*{margin:0}svg{display:block}</style>${svg(pad, size)}`);
  await page.locator('svg').screenshot({ path: `public/icons/${name}.png`, omitBackground: true });
}
await browser.close();
