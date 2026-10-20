// Unit tests run in jsdom, which has no IndexedDB, and whose Blob can't be structured-cloned
// into fake-indexeddb. Use Node's native Blob, which behaves like the browser's.
import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';

globalThis.Blob = NodeBlob as unknown as typeof Blob;
