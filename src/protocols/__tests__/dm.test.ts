/**
 * Tests for the /nexus/dm/1.1.0 direct message protocol.
 */

import { describe, it, expect } from 'vitest';
import {
  DM_PROTOCOL,
  type DmMessage,
} from '../dm.js';

describe('DM_PROTOCOL', () => {
  it('has the correct protocol identifier', () => {
    expect(DM_PROTOCOL).toBe('/nexus/dm/1.1.0');
  });
});

describe('DmMessage', () => {
  it('constructs with required fields', () => {
    const msg: DmMessage = {
      type: 'dm.message',
      version: 1,
      messageId: 'msg-001',
      contentFormat: 'text/plain',
      content: 'Hello, peer!',
    };

    expect(msg.type).toBe('dm.message');
    expect(msg.version).toBe(1);
    expect(msg.messageId).toBe('msg-001');
    expect(msg.contentFormat).toBe('text/plain');
    expect(msg.content).toBe('Hello, peer!');
  });

  it('supports markdown content format', () => {
    const msg: DmMessage = {
      type: 'dm.message',
      version: 1,
      messageId: 'msg-002',
      contentFormat: 'text/markdown',
      content: '# Hello\n\nThis is **markdown**.',
    };

    expect(msg.contentFormat).toBe('text/markdown');
  });

  it('supports JSON content format', () => {
    const msg: DmMessage = {
      type: 'dm.message',
      version: 1,
      messageId: 'msg-003',
      contentFormat: 'application/json',
      content: JSON.stringify({ action: 'ping' }),
    };

    expect(msg.contentFormat).toBe('application/json');
    expect(() => JSON.parse(msg.content)).not.toThrow();
  });
});
