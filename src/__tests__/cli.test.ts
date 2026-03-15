/**
 * CLI entry point tests
 *
 * Tests the CLI argument parsing and command dispatch. We test by spawning the
 * built CLI as a child process (using ts-node/tsx for the source), checking
 * exit codes and stdout/stderr output.
 *
 * These tests do NOT require a running network — they test only the CLI's
 * argument parsing, help text, version output, and error handling.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const CLI_SRC = resolve(PROJECT_ROOT, 'src/cli.ts');

/**
 * Run the CLI with the given args and return { stdout, stderr, status }.
 * We use tsx to run the TypeScript source directly so we don't need a build step.
 */
function runCli(args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(
    'node',
    ['--import', 'tsx', CLI_SRC, ...args],
    {
      cwd: PROJECT_ROOT,
      timeout: 10_000,
      encoding: 'utf8',
    },
  );

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  };
}

describe('CLI entry point', () => {
  // ---------------------------------------------------------------------------
  // Version
  // ---------------------------------------------------------------------------

  describe('version command', () => {
    it('prints version with "version" command', () => {
      const { stdout, status } = runCli(['version']);
      expect(status).toBe(0);
      expect(stdout).toContain('@openagents/nexus');
      expect(stdout).toContain('0.1.0');
    });

    it('prints version with --version flag', () => {
      const { stdout, status } = runCli(['--version']);
      expect(status).toBe(0);
      expect(stdout).toContain('0.1.0');
    });

    it('prints version with -v flag', () => {
      const { stdout, status } = runCli(['-v']);
      expect(status).toBe(0);
      expect(stdout).toContain('0.1.0');
    });
  });

  // ---------------------------------------------------------------------------
  // Help
  // ---------------------------------------------------------------------------

  describe('help command', () => {
    it('prints help with "help" command', () => {
      const { stdout, status } = runCli(['help']);
      expect(status).toBe(0);
      expect(stdout).toContain('Usage:');
      expect(stdout).toContain('nexus start');
      expect(stdout).toContain('nexus hub');
      expect(stdout).toContain('nexus join');
    });

    it('prints help with --help flag', () => {
      const { stdout, status } = runCli(['--help']);
      expect(status).toBe(0);
      expect(stdout).toContain('Usage:');
    });

    it('prints help with -h flag', () => {
      const { stdout, status } = runCli(['-h']);
      expect(status).toBe(0);
      expect(stdout).toContain('Usage:');
    });

    it('help output mentions --name option', () => {
      const { stdout } = runCli(['help']);
      expect(stdout).toContain('--name');
    });

    it('help output mentions --hub option', () => {
      const { stdout } = runCli(['help']);
      expect(stdout).toContain('--hub');
    });

    it('help output mentions --port option', () => {
      const { stdout } = runCli(['help']);
      expect(stdout).toContain('--port');
    });

    it('help output mentions decentralized/no central authority', () => {
      const { stdout } = runCli(['help']);
      // Ensure the philosophy message is present
      expect(stdout.toLowerCase()).toContain('decentralized');
    });
  });

  // ---------------------------------------------------------------------------
  // Unknown command
  // ---------------------------------------------------------------------------

  describe('unknown command', () => {
    it('exits with code 1 for unknown command', () => {
      const { status } = runCli(['unknowncommand']);
      expect(status).toBe(1);
    });

    it('prints error message to stderr for unknown command', () => {
      const { stderr } = runCli(['unknowncommand']);
      expect(stderr).toContain('Unknown command');
      expect(stderr).toContain('unknowncommand');
    });

    it('prints help text when an unknown command is given', () => {
      const { stdout } = runCli(['unknowncommand']);
      expect(stdout).toContain('Usage:');
    });
  });

  // ---------------------------------------------------------------------------
  // join command input validation
  // ---------------------------------------------------------------------------

  describe('join command', () => {
    it('exits with code 1 when no room ID is given', () => {
      const { status } = runCli(['join']);
      expect(status).toBe(1);
    });

    it('prints error message when no room ID is given', () => {
      const { stderr } = runCli(['join']);
      expect(stderr).toContain('room ID required');
    });
  });
});
