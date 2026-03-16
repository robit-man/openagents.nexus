/**
 * File-based audit hook for the metering engine.
 *
 * Appends one JSON line per usage record to a file. Opt-in:
 *
 *   nexus.metering.addHook(createFileAuditHook('./metering.jsonl'));
 */

import * as fs from 'node:fs';
import type { MeteringHook, UsageRecord } from './index.js';

/**
 * Create a metering hook that appends JSON-lines to the given path.
 * The file is opened in append mode. Write errors are silently ignored
 * to avoid disrupting the metering pipeline.
 */
export function createFileAuditHook(filePath: string): MeteringHook {
  return (record: UsageRecord) => {
    try {
      const line = JSON.stringify(record) + '\n';
      fs.appendFileSync(filePath, line, 'utf8');
    } catch {
      // Silent — audit logging is best-effort
    }
  };
}
