import '@testing-library/jest-dom';
import fs from 'node:fs';
import path from 'node:path';

const tmpDir = path.join(process.cwd(), '.tmp');
fs.mkdirSync(tmpDir, { recursive: true });
process.env.TEMP = tmpDir;
process.env.TMP = tmpDir;
process.env.TMPDIR = tmpDir;

const emptyRect = () => ({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  toJSON: () => ({}),
});

if ((globalThis as any).Text?.prototype && !(globalThis as any).Text.prototype.getBoundingClientRect) {
  (globalThis as any).Text.prototype.getBoundingClientRect = emptyRect;
}

if ((globalThis as any).Range?.prototype && !(globalThis as any).Range.prototype.getBoundingClientRect) {
  (globalThis as any).Range.prototype.getBoundingClientRect = emptyRect;
}

if ((globalThis as any).Range?.prototype && !(globalThis as any).Range.prototype.getClientRects) {
  (globalThis as any).Range.prototype.getClientRects = () => [];
}
