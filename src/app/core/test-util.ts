// Test-only helpers (imported from *.spec.ts files).
import { Tx, uid } from './models';

export function mk(p: Partial<Tx> & Pick<Tx, 'type' | 'amount'>): Tx {
  return {
    id: uid(),
    title: p.type,
    date: '2024-03-10',
    tags: [],
    attachmentCount: 0,
    createdAt: 0,
    updatedAt: 0,
    ...p,
  };
}
