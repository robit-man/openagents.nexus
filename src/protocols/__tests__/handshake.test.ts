/**
 * Tests for the /nexus/handshake/1.1.0 live suitability query protocol.
 *
 * Coverage targets:
 *   - HANDSHAKE_PROTOCOL constant value
 *   - HandshakeInit shape construction
 *   - HandshakeAck shape construction
 *   - Optional fields in HandshakeInit.wanted and HandshakeAck
 */

import { describe, it, expect } from 'vitest';
import {
  HANDSHAKE_PROTOCOL,
  type HandshakeInit,
  type HandshakeAck,
} from '../handshake.js';

// ---------------------------------------------------------------------------
// Protocol constant
// ---------------------------------------------------------------------------

describe('HANDSHAKE_PROTOCOL', () => {
  it('has the correct protocol identifier', () => {
    expect(HANDSHAKE_PROTOCOL).toBe('/nexus/handshake/1.1.0');
  });
});

// ---------------------------------------------------------------------------
// HandshakeInit — shape
// ---------------------------------------------------------------------------

describe('HandshakeInit', () => {
  it('constructs with required fields only', () => {
    const init: HandshakeInit = {
      type: 'handshake.init',
      version: 1,
      requestId: 'hs-001',
      peerId: '12D3KooWAbc',
      agentName: 'alice',
      agentType: 'assistant',
      roles: ['full'],
      wanted: {},
    };

    expect(init.type).toBe('handshake.init');
    expect(init.version).toBe(1);
    expect(init.requestId).toBe('hs-001');
    expect(init.peerId).toBe('12D3KooWAbc');
    expect(init.agentName).toBe('alice');
    expect(init.agentType).toBe('assistant');
    expect(init.roles).toEqual(['full']);
    expect(init.wanted).toEqual({});
  });

  it('accepts all optional wanted flags', () => {
    const init: HandshakeInit = {
      type: 'handshake.init',
      version: 1,
      requestId: 'hs-002',
      peerId: '12D3KooWDef',
      agentName: 'bob',
      agentType: 'specialist',
      roles: ['light'],
      wanted: {
        capabilityStatus: true,
        relayOptions: true,
        roomSummaries: false,
      },
    };

    expect(init.wanted.capabilityStatus).toBe(true);
    expect(init.wanted.relayOptions).toBe(true);
    expect(init.wanted.roomSummaries).toBe(false);
  });

  it('supports multiple roles', () => {
    const init: HandshakeInit = {
      type: 'handshake.init',
      version: 1,
      requestId: 'hs-003',
      peerId: '12D3KooWGhi',
      agentName: 'charlie',
      agentType: 'orchestrator',
      roles: ['full', 'storage'],
      wanted: { capabilityStatus: true },
    };

    expect(init.roles).toContain('full');
    expect(init.roles).toContain('storage');
    expect(init.roles).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// HandshakeAck — shape
// ---------------------------------------------------------------------------

describe('HandshakeAck', () => {
  it('constructs with required fields only', () => {
    const ack: HandshakeAck = {
      type: 'handshake.ack',
      version: 1,
      requestId: 'hs-001',
      peerId: '12D3KooWXyz',
      agentName: 'provider',
      agentType: 'inference',
      roles: ['full'],
    };

    expect(ack.type).toBe('handshake.ack');
    expect(ack.version).toBe(1);
    expect(ack.requestId).toBe('hs-001');
    expect(ack.peerId).toBe('12D3KooWXyz');
    expect(ack.agentName).toBe('provider');
    expect(ack.agentType).toBe('inference');
    expect(ack.roles).toEqual(['full']);
  });

  it('accepts capabilityStatus array', () => {
    const ack: HandshakeAck = {
      type: 'handshake.ack',
      version: 1,
      requestId: 'hs-002',
      peerId: '12D3KooWXyz',
      agentName: 'provider',
      agentType: 'inference',
      roles: ['full'],
      capabilityStatus: [
        {
          name: 'text.summarize',
          available: true,
          maxInputBytes: 65_536,
          streaming: true,
          estimatedQueueMs: 50,
        },
        {
          name: 'image.generate',
          available: false,
        },
      ],
    };

    expect(ack.capabilityStatus).toHaveLength(2);
    expect(ack.capabilityStatus![0].name).toBe('text.summarize');
    expect(ack.capabilityStatus![0].available).toBe(true);
    expect(ack.capabilityStatus![0].streaming).toBe(true);
    expect(ack.capabilityStatus![1].available).toBe(false);
  });

  it('accepts relay information', () => {
    const ack: HandshakeAck = {
      type: 'handshake.ack',
      version: 1,
      requestId: 'hs-003',
      peerId: '12D3KooWXyz',
      agentName: 'relay-node',
      agentType: 'infrastructure',
      roles: ['full', 'storage'],
      relay: { available: true },
    };

    expect(ack.relay?.available).toBe(true);
  });

  it('relay can indicate unavailable', () => {
    const ack: HandshakeAck = {
      type: 'handshake.ack',
      version: 1,
      requestId: 'hs-004',
      peerId: '12D3KooWXyz',
      agentName: 'light-node',
      agentType: 'client',
      roles: ['light'],
      relay: { available: false },
    };

    expect(ack.relay?.available).toBe(false);
  });
});
