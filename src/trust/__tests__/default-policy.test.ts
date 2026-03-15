import { describe, it, expect, beforeEach } from 'vitest';
import { DefaultTrustPolicy } from '../default-policy.js';

describe('DefaultTrustPolicy — empty config (permissive)', () => {
  let policy: DefaultTrustPolicy;

  beforeEach(() => {
    policy = new DefaultTrustPolicy();
  });

  it('allowPeer returns true for any peer', () => {
    expect(policy.allowPeer('peer-abc')).toBe(true);
    expect(policy.allowPeer('peer-xyz')).toBe(true);
  });

  it('allowRoom returns true for any room and peer', () => {
    expect(policy.allowRoom('room-1', 'peer-abc')).toBe(true);
  });

  it('allowCapability returns true for any peer and capability', () => {
    expect(policy.allowCapability('peer-abc', 'some-capability')).toBe(true);
  });

  it('allowRelay returns true for any peer', () => {
    expect(policy.allowRelay('peer-abc')).toBe(true);
  });
});

describe('DefaultTrustPolicy — denylist', () => {
  let policy: DefaultTrustPolicy;

  beforeEach(() => {
    policy = new DefaultTrustPolicy({ denylist: ['bad-peer-1', 'bad-peer-2'] });
  });

  it('allowPeer returns false for denied peers', () => {
    expect(policy.allowPeer('bad-peer-1')).toBe(false);
    expect(policy.allowPeer('bad-peer-2')).toBe(false);
  });

  it('allowPeer returns true for non-denied peers', () => {
    expect(policy.allowPeer('good-peer')).toBe(true);
  });

  it('allowRoom returns false for denied peers', () => {
    expect(policy.allowRoom('any-room', 'bad-peer-1')).toBe(false);
  });

  it('allowRoom returns true for non-denied peers', () => {
    expect(policy.allowRoom('any-room', 'good-peer')).toBe(true);
  });

  it('allowCapability returns false for denied peers', () => {
    expect(policy.allowCapability('bad-peer-1', 'chat')).toBe(false);
  });

  it('allowRelay returns false for denied peers', () => {
    expect(policy.allowRelay('bad-peer-2')).toBe(false);
  });
});

describe('DefaultTrustPolicy — allowlist-only mode', () => {
  let policy: DefaultTrustPolicy;

  beforeEach(() => {
    policy = new DefaultTrustPolicy({ allowlist: ['trusted-peer-1', 'trusted-peer-2'] });
  });

  it('allowPeer returns true for listed peers', () => {
    expect(policy.allowPeer('trusted-peer-1')).toBe(true);
    expect(policy.allowPeer('trusted-peer-2')).toBe(true);
  });

  it('allowPeer returns false for unlisted peers', () => {
    expect(policy.allowPeer('unknown-peer')).toBe(false);
  });

  it('allowRoom returns false for unlisted peers', () => {
    expect(policy.allowRoom('room-1', 'unknown-peer')).toBe(false);
  });

  it('allowCapability returns false for unlisted peers', () => {
    expect(policy.allowCapability('unknown-peer', 'relay')).toBe(false);
  });

  it('allowRelay returns false for unlisted peers', () => {
    expect(policy.allowRelay('unknown-peer')).toBe(false);
  });
});

describe('DefaultTrustPolicy — room denylist', () => {
  let policy: DefaultTrustPolicy;

  beforeEach(() => {
    policy = new DefaultTrustPolicy({ roomDenylist: ['forbidden-room'] });
  });

  it('allowRoom returns false for denied room', () => {
    expect(policy.allowRoom('forbidden-room', 'any-peer')).toBe(false);
  });

  it('allowRoom returns true for non-denied rooms', () => {
    expect(policy.allowRoom('allowed-room', 'any-peer')).toBe(true);
  });

  it('allowRoom still blocks peer-denied peers even for allowed rooms', () => {
    const policyWithBoth = new DefaultTrustPolicy({
      denylist: ['bad-peer'],
      roomDenylist: ['forbidden-room'],
    });
    expect(policyWithBoth.allowRoom('allowed-room', 'bad-peer')).toBe(false);
  });
});

describe('DefaultTrustPolicy — dynamic mutation', () => {
  let policy: DefaultTrustPolicy;

  beforeEach(() => {
    policy = new DefaultTrustPolicy();
  });

  it('addToDenylist blocks a previously-allowed peer', () => {
    expect(policy.allowPeer('peer-x')).toBe(true);
    policy.addToDenylist('peer-x');
    expect(policy.allowPeer('peer-x')).toBe(false);
  });

  it('removeFromDenylist unblocks a denied peer', () => {
    policy.addToDenylist('peer-x');
    expect(policy.allowPeer('peer-x')).toBe(false);
    policy.removeFromDenylist('peer-x');
    expect(policy.allowPeer('peer-x')).toBe(true);
  });

  it('addToAllowlist switches to allowlist-only mode for new entries', () => {
    expect(policy.allowPeer('peer-y')).toBe(true); // no allowlist yet
    policy.addToAllowlist('peer-trusted');
    // Now allowlist is non-empty, so unknown peers are blocked
    expect(policy.allowPeer('peer-y')).toBe(false);
    expect(policy.allowPeer('peer-trusted')).toBe(true);
  });

  it('removeFromAllowlist removes entry; if allowlist becomes empty all peers allowed', () => {
    policy.addToAllowlist('peer-a');
    expect(policy.allowPeer('peer-b')).toBe(false);
    policy.removeFromAllowlist('peer-a');
    // Allowlist is empty again — open to all
    expect(policy.allowPeer('peer-b')).toBe(true);
  });

  it('denyRoom blocks a room that was previously allowed', () => {
    expect(policy.allowRoom('room-test', 'peer-x')).toBe(true);
    policy.denyRoom('room-test');
    expect(policy.allowRoom('room-test', 'peer-x')).toBe(false);
  });

  it('allowRoomId unblocks a previously-denied room', () => {
    policy.denyRoom('room-test');
    expect(policy.allowRoom('room-test', 'peer-x')).toBe(false);
    policy.allowRoomId('room-test');
    expect(policy.allowRoom('room-test', 'peer-x')).toBe(true);
  });
});

describe('DefaultTrustPolicy — capability and relay delegate to allowPeer', () => {
  it('allowCapability mirrors allowPeer result', () => {
    const policy = new DefaultTrustPolicy({ denylist: ['bad'] });
    expect(policy.allowCapability('bad', 'anything')).toBe(false);
    expect(policy.allowCapability('good', 'anything')).toBe(true);
  });

  it('allowRelay mirrors allowPeer result', () => {
    const policy = new DefaultTrustPolicy({ denylist: ['bad'] });
    expect(policy.allowRelay('bad')).toBe(false);
    expect(policy.allowRelay('good')).toBe(true);
  });
});
