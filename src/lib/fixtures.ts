import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConnectorResult } from '../types/project';

export function loadFixture(source: string): ConnectorResult[] {
  const path = resolve(process.cwd(), 'tests/fixtures', `${source}.json`);
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ConnectorResult[];
  } catch {
    return [];
  }
}

export function isPlaceholderHandle(s: string | undefined): boolean {
  if (!s) return true;
  return s.startsWith('YOUR_') || s === '';
}
