/**
 * File audit hook tests
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createFileAuditHook } from '../file-logger.js';
import type { UsageRecord } from '../index.js';

function makeRecord(): UsageRecord {
  return {
    id: 'req-test',
    timestamp: 1700000000000,
    peerId: 'peer-1',
    service: 'chat',
    capability: 'chat',
    direction: 'inbound',
    inputBytes: 100,
    outputBytes: 200,
    durationMs: 50,
  };
}

describe('createFileAuditHook', () => {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `metering-test-${Date.now()}.jsonl`);

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch {}
  });

  it('appends a JSON line to the file', () => {
    const hook = createFileAuditHook(tmpFile);
    const rec = makeRecord();
    hook(rec);

    const content = fs.readFileSync(tmpFile, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual(rec);
  });

  it('appends multiple records as separate lines', () => {
    const hook = createFileAuditHook(tmpFile);
    hook(makeRecord());
    hook(makeRecord());

    const lines = fs.readFileSync(tmpFile, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('does not throw on write failure', () => {
    const hook = createFileAuditHook('/nonexistent/path/file.jsonl');
    expect(() => hook(makeRecord())).not.toThrow();
  });
});
