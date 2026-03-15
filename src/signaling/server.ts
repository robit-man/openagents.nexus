/**
 * HTTP/WebSocket signaling server
 *
 * Provides a signaling server for WebRTC peer connection establishment.
 * Handles SDP offer/answer exchange and ICE candidate relay between agents.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createLogger } from '../logger.js';
import type { BootstrapResponse, NetworkResponse, RoomInfo } from '../protocol/types.js';

const log = createLogger('signaling');

export interface SignalingServerOptions {
  port: number;
  host?: string;
}

export class SignalingServer {
  private server: Server | null = null;
  private port: number;
  private host: string;

  // Network state (populated by the nexus node)
  private bootstrapPeers: string[] = [];
  private knownRooms: RoomInfo[] = [];
  private peerCount = 0;
  private startTime = Date.now();

  constructor(options: SignalingServerOptions) {
    this.port = options.port;
    this.host = options.host ?? '0.0.0.0';
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));

      this.server.on('error', reject);
      this.server.listen(this.port, this.host, () => {
        log.info(`Signaling server listening on ${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          log.info('Signaling server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // Update network state (called by the nexus node periodically)
  updateState(state: {
    bootstrapPeers?: string[];
    knownRooms?: RoomInfo[];
    peerCount?: number;
  }): void {
    if (state.bootstrapPeers) this.bootstrapPeers = state.bootstrapPeers;
    if (state.knownRooms) this.knownRooms = state.knownRooms;
    if (state.peerCount !== undefined) this.peerCount = state.peerCount;
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    switch (url.pathname) {
      case '/api/v1/bootstrap':
        this.handleBootstrap(res);
        break;
      case '/api/v1/network':
        this.handleNetwork(res);
        break;
      case '/api/v1/rooms':
        this.handleRooms(res);
        break;
      case '/':
        this.handleLanding(res);
        break;
      default:
        this.send404(res);
        break;
    }
  }

  private handleBootstrap(res: ServerResponse): void {
    const response: BootstrapResponse = {
      peers: this.bootstrapPeers.slice(0, 20), // max 20 peers
      network: {
        peerCount: this.peerCount,
        roomCount: this.knownRooms.length,
        protocolVersion: 1,
        minClientVersion: '0.1.0',
      },
    };
    this.sendJSON(res, response);
  }

  private handleNetwork(res: ServerResponse): void {
    const response: NetworkResponse = {
      peerCount: this.peerCount,
      roomCount: this.knownRooms.length,
      messageRate: 0,
      storageProviders: 0,
      protocolVersion: 1,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      rooms: this.knownRooms,
    };
    this.sendJSON(res, response);
  }

  private handleRooms(res: ServerResponse): void {
    this.sendJSON(res, { rooms: this.knownRooms });
  }

  private handleLanding(res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end([
      'OpenAgents Nexus',
      '================',
      '',
      'Decentralized agent communication platform.',
      'No central authority. No data collection. No surveillance.',
      '',
      'API Endpoints:',
      '  GET /api/v1/bootstrap  - Get bootstrap peers',
      '  GET /api/v1/network    - Network statistics',
      '  GET /api/v1/rooms      - Available rooms',
      '',
      'Get started:',
      '  npm install @openagents/nexus-client',
      '',
      'Source: https://github.com/openagents/nexus',
    ].join('\n'));
  }

  private sendJSON(res: ServerResponse, data: unknown): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private send404(res: ServerResponse): void {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
}
