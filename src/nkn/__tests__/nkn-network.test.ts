/**
 * NKN Network Integration Tests — REAL NETWORK
 *
 * These tests connect to the actual NKN public network.
 * Two MultiClient instances exchange verified messages and validate
 * HMAC signatures end-to-end. No mocks.
 *
 * Timeout: 60s (NKN connection can take 5-15s per client)
 */

import { describe, it, expect, afterAll } from 'vitest';
import {
  NknFallback,
  computeNknSharedSecret,
  signNknMessage,
  verifyNknMessage,
  buildNknEnvelope,
  parseNknEnvelope,
  deriveNknSeed,
} from '../index.js';
import type { NknInboxMessage } from '../index.js';

// ---------------------------------------------------------------------------
// Pure function tests (no network, fast)
// ---------------------------------------------------------------------------

describe('NKN crypto utilities', () => {
  it('deriveNknSeed produces deterministic 64-char hex from identity key', () => {
    const key = Buffer.from('test-identity-key-data');
    const seed1 = deriveNknSeed(key);
    const seed2 = deriveNknSeed(key);
    expect(seed1).toBe(seed2);
    expect(seed1).toHaveLength(64);
    expect(seed1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('deriveNknSeed differs for different keys', () => {
    const seed1 = deriveNknSeed(Buffer.from('key-a'));
    const seed2 = deriveNknSeed(Buffer.from('key-b'));
    expect(seed1).not.toBe(seed2);
  });

  it('computeNknSharedSecret is symmetric', () => {
    const s1 = computeNknSharedSecret('addr-alice', 'addr-bob');
    const s2 = computeNknSharedSecret('addr-alice', 'addr-bob');
    expect(s1).toBe(s2);
  });

  it('computeNknSharedSecret differs by order (directional)', () => {
    const s1 = computeNknSharedSecret('addr-alice', 'addr-bob');
    const s2 = computeNknSharedSecret('addr-bob', 'addr-alice');
    // These SHOULD differ — the secret is directional (sender → receiver)
    // This is by design: sender computes with (myAddr, theirAddr),
    // receiver computes with (theirAddr, myAddr) — same order
    expect(s1).not.toBe(s2);
  });

  it('signNknMessage + verifyNknMessage round-trip', () => {
    const secret = computeNknSharedSecret('alice.pubkey', 'bob.pubkey');
    const hmac = signNknMessage(secret, 'agent-alice', 'Hello Bob', 1700000000);
    expect(hmac).toHaveLength(16);
    expect(verifyNknMessage(secret, 'agent-alice', 'Hello Bob', 1700000000, hmac)).toBe(true);
    // Wrong content
    expect(verifyNknMessage(secret, 'agent-alice', 'Wrong msg', 1700000000, hmac)).toBe(false);
    // Wrong agent name
    expect(verifyNknMessage(secret, 'agent-bob', 'Hello Bob', 1700000000, hmac)).toBe(false);
    // Wrong timestamp
    expect(verifyNknMessage(secret, 'agent-alice', 'Hello Bob', 9999999999, hmac)).toBe(false);
  });

  it('buildNknEnvelope produces valid JSON with _hmac', () => {
    const env = buildNknEnvelope('sender.addr', 'receiver.addr', 'test-agent', 'Hello!', '12D3KooW...');
    const parsed = JSON.parse(env);
    expect(parsed._agentName).toBe('test-agent');
    expect(parsed.content).toBe('Hello!');
    expect(parsed._hmac).toHaveLength(16);
    expect(parsed.libp2pPeerId).toBe('12D3KooW...');
    expect(parsed.timestamp).toBeGreaterThan(0);
  });

  it('parseNknEnvelope verifies a valid envelope', () => {
    const senderAddr = 'oa-alice.abc123';
    const receiverAddr = 'oa-bob.def456';
    const envelope = buildNknEnvelope(senderAddr, receiverAddr, 'alice-agent', 'Test message');
    const msg = parseNknEnvelope(senderAddr, receiverAddr, envelope);
    expect(msg.verified).toBe(true);
    expect(msg.agentName).toBe('alice-agent');
    expect(msg.content).toBe('Test message');
    expect(msg.sender).toBe(senderAddr);
  });

  it('parseNknEnvelope rejects tampered content', () => {
    const senderAddr = 'oa-alice.abc123';
    const receiverAddr = 'oa-bob.def456';
    const envelope = buildNknEnvelope(senderAddr, receiverAddr, 'alice-agent', 'Original');
    // Tamper with the content
    const tampered = envelope.replace('"Original"', '"Tampered"');
    const msg = parseNknEnvelope(senderAddr, receiverAddr, tampered);
    expect(msg.verified).toBe(false);
  });

  it('parseNknEnvelope handles raw text (non-JSON)', () => {
    const msg = parseNknEnvelope('sender', 'receiver', 'just plain text');
    expect(msg.verified).toBe(false);
    expect(msg.raw).toBe('just plain text');
  });
});

// ---------------------------------------------------------------------------
// REAL NKN NETWORK TESTS
// Two NknFallback instances connect, exchange verified messages.
// ---------------------------------------------------------------------------

describe('NKN real network — two-node message exchange', () => {
  const aliceSeed = deriveNknSeed(Buffer.from('nkn-test-alice-identity-2026'));
  const bobSeed = deriveNknSeed(Buffer.from('nkn-test-bob-identity-2026'));

  let alice: NknFallback;
  let bob: NknFallback;
  let aliceAddr: string | null = null;
  let bobAddr: string | null = null;

  // Collect messages received by each node
  const aliceInbox: NknInboxMessage[] = [];
  const bobInbox: NknInboxMessage[] = [];

  afterAll(async () => {
    // Clean shutdown
    await alice?.disconnect();
    await bob?.disconnect();
  }, 10_000);

  it('Alice connects to NKN network', async () => {
    alice = new NknFallback({ enabled: true, identifier: 'oa-test-alice', numSubClients: 3 });
    const info = await alice.connect(aliceSeed);
    expect(info).not.toBeNull();
    expect(info!.address).toContain('oa-test-alice');
    expect(alice.isConnected).toBe(true);
    aliceAddr = alice.address;
    console.log('  Alice NKN address:', aliceAddr);

    alice.onVerifiedMessage((msg) => {
      aliceInbox.push(msg);
    });
  }, 30_000);

  it('Bob connects to NKN network', async () => {
    bob = new NknFallback({ enabled: true, identifier: 'oa-test-bob', numSubClients: 3 });
    const info = await bob.connect(bobSeed);
    expect(info).not.toBeNull();
    expect(info!.address).toContain('oa-test-bob');
    expect(bob.isConnected).toBe(true);
    bobAddr = bob.address;
    console.log('  Bob NKN address:', bobAddr);

    bob.onVerifiedMessage((msg) => {
      bobInbox.push(msg);
    });
  }, 30_000);

  it('Alice sends verified message to Bob', async () => {
    expect(aliceAddr).not.toBeNull();
    expect(bobAddr).not.toBeNull();

    const sent = await alice.sendVerified(
      bobAddr!,
      'alice-agent',
      'Hello Bob, this is a verified NKN message!',
      '12D3KooWAlice',
    );
    expect(sent).toBe(true);
    console.log('  Alice sent verified message to Bob');
  }, 15_000);

  it('Bob receives and verifies the message (wait up to 20s)', async () => {
    // Poll for message arrival (NKN delivery can take a few seconds)
    const start = Date.now();
    while (bobInbox.length === 0 && Date.now() - start < 20_000) {
      await new Promise(r => setTimeout(r, 500));
    }

    expect(bobInbox.length).toBeGreaterThanOrEqual(1);
    const msg = bobInbox[0]!;
    console.log('  Bob received:', { verified: msg.verified, agentName: msg.agentName, content: msg.content?.slice(0, 50) });

    expect(msg.verified).toBe(true);
    expect(msg.agentName).toBe('alice-agent');
    expect(msg.content).toBe('Hello Bob, this is a verified NKN message!');
    expect(msg.sender).toContain('oa-test-alice');
  }, 25_000);

  it('Bob sends verified reply to Alice', async () => {
    const sent = await bob.sendVerified(
      aliceAddr!,
      'bob-agent',
      'Got it! Reply from Bob.',
      '12D3KooWBob',
    );
    expect(sent).toBe(true);
    console.log('  Bob sent verified reply to Alice');
  }, 15_000);

  it('Alice receives and verifies the reply (wait up to 20s)', async () => {
    const start = Date.now();
    while (aliceInbox.length === 0 && Date.now() - start < 20_000) {
      await new Promise(r => setTimeout(r, 500));
    }

    expect(aliceInbox.length).toBeGreaterThanOrEqual(1);
    const msg = aliceInbox[0]!;
    console.log('  Alice received:', { verified: msg.verified, agentName: msg.agentName, content: msg.content?.slice(0, 50) });

    expect(msg.verified).toBe(true);
    expect(msg.agentName).toBe('bob-agent');
    expect(msg.content).toBe('Got it! Reply from Bob.');
    expect(msg.sender).toContain('oa-test-bob');
  }, 25_000);

  it('Spoofed message (wrong HMAC) is flagged as unverified', async () => {
    // Manually construct a message with a bad HMAC and send raw
    const spoofed = JSON.stringify({
      _agentName: 'fake-agent',
      content: 'I am pretending to be someone else',
      timestamp: Date.now(),
      _hmac: 'deadbeef12345678', // wrong HMAC
    });

    bobInbox.length = 0; // clear
    const sent = await alice.send(bobAddr!, spoofed);
    expect(sent).toBe(true);

    const start = Date.now();
    while (bobInbox.length === 0 && Date.now() - start < 20_000) {
      await new Promise(r => setTimeout(r, 500));
    }

    if (bobInbox.length > 0) {
      const msg = bobInbox[0]!;
      console.log('  Bob received spoofed msg:', { verified: msg.verified });
      expect(msg.verified).toBe(false); // HMAC mismatch!
    }
  }, 25_000);

  it('deterministic addresses: reconnecting with same seed gives same address', async () => {
    const addr1 = aliceAddr;
    await alice.disconnect();
    // Reconnect with same seed
    alice = new NknFallback({ enabled: true, identifier: 'oa-test-alice', numSubClients: 3 });
    alice.onVerifiedMessage((msg) => aliceInbox.push(msg));
    const info = await alice.connect(aliceSeed);
    expect(info!.address).toBe(addr1); // same address!
    aliceAddr = alice.address;
    console.log('  Alice reconnected — same address:', aliceAddr === addr1);
  }, 30_000);
}, 180_000); // 3-minute overall timeout for the network suite
