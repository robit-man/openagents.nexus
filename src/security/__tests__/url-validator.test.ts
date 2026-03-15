/**
 * Unit tests for validateSignalingUrl
 *
 * Tests SSRF prevention: protocol enforcement, private IP blocking,
 * and path sanitisation.
 */

import { describe, it, expect } from 'vitest';
import { validateSignalingUrl } from '../url-validator.js';

describe('validateSignalingUrl', () => {
  // ---------------------------------------------------------------------------
  // Valid URLs
  // ---------------------------------------------------------------------------

  describe('valid public URLs', () => {
    it('accepts a plain https URL', () => {
      const result = validateSignalingUrl('https://openagents.nexus');
      expect(result).toBe('https://openagents.nexus');
    });

    it('accepts a plain http URL', () => {
      const result = validateSignalingUrl('http://openagents.nexus');
      expect(result).toBe('http://openagents.nexus');
    });

    it('accepts a URL with explicit port', () => {
      const result = validateSignalingUrl('https://openagents.nexus:8443');
      expect(result).toBe('https://openagents.nexus:8443');
    });

    it('strips path from the URL', () => {
      const result = validateSignalingUrl('https://openagents.nexus/some/path?foo=bar#frag');
      expect(result).toBe('https://openagents.nexus');
    });

    it('strips query string and fragment', () => {
      const result = validateSignalingUrl('https://openagents.nexus?debug=1');
      expect(result).toBe('https://openagents.nexus');
    });

    it('accepts localhost for development', () => {
      const result = validateSignalingUrl('http://localhost:9090');
      expect(result).toBe('http://localhost:9090');
    });

    it('accepts 127.0.0.1 for development', () => {
      const result = validateSignalingUrl('http://127.0.0.1:9090');
      expect(result).toBe('http://127.0.0.1:9090');
    });

    it('preserves port in returned URL', () => {
      const result = validateSignalingUrl('http://localhost:9090/path/to/ignore');
      expect(result).toBe('http://localhost:9090');
    });
  });

  // ---------------------------------------------------------------------------
  // Invalid protocol
  // ---------------------------------------------------------------------------

  describe('invalid protocols', () => {
    it('rejects ws:// protocol', () => {
      expect(() => validateSignalingUrl('ws://openagents.nexus')).toThrow(
        /must use http or https/i,
      );
    });

    it('rejects wss:// protocol', () => {
      expect(() => validateSignalingUrl('wss://openagents.nexus')).toThrow(
        /must use http or https/i,
      );
    });

    it('rejects ftp:// protocol', () => {
      expect(() => validateSignalingUrl('ftp://openagents.nexus')).toThrow(
        /must use http or https/i,
      );
    });

    it('rejects file:// protocol', () => {
      expect(() => validateSignalingUrl('file:///etc/passwd')).toThrow(
        /must use http or https/i,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Malformed URL
  // ---------------------------------------------------------------------------

  describe('malformed URLs', () => {
    it('throws for an empty string', () => {
      expect(() => validateSignalingUrl('')).toThrow(/Invalid signaling server URL/i);
    });

    it('throws for a bare hostname without protocol', () => {
      expect(() => validateSignalingUrl('openagents.nexus')).toThrow(
        /Invalid signaling server URL/i,
      );
    });

    it('throws for a totally invalid string', () => {
      expect(() => validateSignalingUrl('not a url at all')).toThrow(
        /Invalid signaling server URL/i,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Private IP blocking
  // ---------------------------------------------------------------------------

  describe('private IP ranges', () => {
    it('blocks 10.x.x.x', () => {
      expect(() => validateSignalingUrl('http://10.0.0.1:9090')).toThrow(
        /private\/internal/i,
      );
    });

    it('blocks 10.255.255.255', () => {
      expect(() => validateSignalingUrl('http://10.255.255.255')).toThrow(
        /private\/internal/i,
      );
    });

    it('blocks 172.16.x.x', () => {
      expect(() => validateSignalingUrl('http://172.16.0.1')).toThrow(
        /private\/internal/i,
      );
    });

    it('blocks 172.31.x.x', () => {
      expect(() => validateSignalingUrl('http://172.31.255.255')).toThrow(
        /private\/internal/i,
      );
    });

    it('does NOT block 172.15.x.x (outside range)', () => {
      // 172.15.x is not a private range per RFC 1918
      const result = validateSignalingUrl('http://172.15.0.1');
      expect(result).toBe('http://172.15.0.1');
    });

    it('does NOT block 172.32.x.x (outside range)', () => {
      const result = validateSignalingUrl('http://172.32.0.1');
      expect(result).toBe('http://172.32.0.1');
    });

    it('blocks 192.168.x.x', () => {
      expect(() => validateSignalingUrl('http://192.168.1.1')).toThrow(
        /private\/internal/i,
      );
    });

    it('blocks 169.254.x.x (link-local)', () => {
      expect(() => validateSignalingUrl('http://169.254.0.1')).toThrow(
        /private\/internal/i,
      );
    });

    it('allows ::1 (IPv6 loopback) for development', () => {
      // ::1 is explicitly allowed for dev/testing
      const result = validateSignalingUrl('http://[::1]:9090');
      expect(result).toBe('http://[::1]:9090');
    });
  });
});
