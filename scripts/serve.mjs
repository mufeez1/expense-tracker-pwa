// Minimal static server for the production build with SPA fallback: node scripts/serve.mjs [port] [base-path]
// Use a base path (e.g. /expense-tracker-pwa/) to mimic GitHub Pages project hosting.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('../dist/expense-tracker/browser/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const port = Number(process.argv[2] ?? 4300);
const base = process.argv[3] ?? '/';

createServer(async (req, res) => {
  const path = normalize('/' + decodeURIComponent(new URL(req.url, 'http://x').pathname).slice(base.length)).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, path);
  let body = await readFile(file).catch(() => null);
  if (!body) body = await readFile((file = join(root, 'index.html')));
  // Mimic hosts that rewrite HTML (Netlify injects a comment) so e2e tests catch service-worker hash breakage.
  if (extname(file) === '.html') body = String(body).replace('<head>', '<head>\n<!-- injected by host -->');
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(body);
}).listen(port, () => console.log(`Serving ${root} on http://localhost:${port}${base}`));
