import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, setLogLevel } from '../logger.js';

describe('createLogger', () => {
  beforeEach(() => {
    // Reset to default info level before each test
    setLogLevel('info');
  });

  it('returns an object with debug, info, warn, error methods', () => {
    const log = createLogger('test-scope');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
  });

  describe('log level filtering', () => {
    it('logs info messages at info level', () => {
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
      setLogLevel('info');
      const log = createLogger('scope');
      log.info('test info message');
      expect(spy).toHaveBeenCalledOnce();
      spy.mockRestore();
    });

    it('suppresses debug messages at info level', () => {
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      setLogLevel('info');
      const log = createLogger('scope');
      log.debug('should not appear');
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('logs debug messages at debug level', () => {
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      setLogLevel('debug');
      const log = createLogger('scope');
      log.debug('now visible');
      expect(spy).toHaveBeenCalledOnce();
      spy.mockRestore();
    });

    it('logs warn messages at warn level and above', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      setLogLevel('warn');
      const log = createLogger('scope');
      log.warn('warn msg');
      log.info('info suppressed');
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(infoSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
      infoSpy.mockRestore();
    });

    it('only logs error messages at error level', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      setLogLevel('error');
      const log = createLogger('scope');
      log.error('error msg');
      log.warn('warn suppressed');
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(warnSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });

  describe('log format', () => {
    it('includes scope in log output', () => {
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const log = createLogger('my-scope');
      log.info('test msg');
      const output = spy.mock.calls[0][0] as string;
      expect(output).toContain('[my-scope]');
      spy.mockRestore();
    });

    it('includes log level in output', () => {
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const log = createLogger('s');
      log.info('msg');
      const output = spy.mock.calls[0][0] as string;
      expect(output).toContain('[INFO]');
      spy.mockRestore();
    });

    it('includes ISO timestamp in output', () => {
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const log = createLogger('s');
      log.info('msg');
      const output = spy.mock.calls[0][0] as string;
      // ISO date pattern e.g. 2026-03-14T...
      expect(output).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      spy.mockRestore();
    });

    it('includes the message in output', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const log = createLogger('s');
      log.warn('my warning message');
      const output = spy.mock.calls[0][0] as string;
      expect(output).toContain('my warning message');
      spy.mockRestore();
    });

    it('passes extra args through to console', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      setLogLevel('error');
      const log = createLogger('s');
      const extra = { key: 'value' };
      log.error('err msg', extra);
      expect(spy).toHaveBeenCalledWith(expect.any(String), extra);
      spy.mockRestore();
    });
  });
});

describe('setLogLevel', () => {
  afterEach(() => {
    setLogLevel('info');
  });

  it('changes the effective log level globally', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    setLogLevel('debug');
    const log = createLogger('global');
    log.debug('debug visible');
    expect(debugSpy).toHaveBeenCalledOnce();
    debugSpy.mockRestore();
  });
});
