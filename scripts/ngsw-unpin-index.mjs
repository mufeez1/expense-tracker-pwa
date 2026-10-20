// Some hosts (e.g. Netlify) inject comments into served HTML. The Angular service worker verifies
// every file in ngsw.json's hashTable byte-for-byte, so a rewritten index.html makes it reject the
// app version and offline mode silently stops working. index.html only references content-hashed
// bundles, so dropping its hash is safe: new builds still change ngsw.json and trigger updates.
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../dist/expense-tracker/browser/ngsw.json', import.meta.url);
const ngsw = JSON.parse(readFileSync(file, 'utf8'));
delete ngsw.hashTable['/index.html'];
writeFileSync(file, JSON.stringify(ngsw, null, 2));
console.log('ngsw.json: index.html unpinned from hash verification');
