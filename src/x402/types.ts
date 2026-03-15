/**
 * x402 Payment Protocol Types
 *
 * Based on the x402 open standard (https://x402.org)
 * HTTP 402 Payment Required for agent-to-agent micropayments
 */

// Payment terms returned in a 402 response
export interface PaymentTerms {
  // Amount in smallest unit (e.g., wei for ETH, 1e-6 for USDC)
  amount: string;
  // Currency identifier
  currency: 'USDC' | 'ETH' | 'BASE_ETH';
  // Blockchain network
  network: 'base' | 'ethereum' | 'polygon' | 'solana';
  // Recipient wallet address
  recipient: string;
  // Description of what's being purchased
  description: string;
  // Expiry timestamp (unix ms)
  expiresAt: number;
  // Unique payment request ID
  requestId: string;
}

// Payment proof sent by client
export interface PaymentProof {
  // EIP-712 typed data signature
  signature: string;
  // The signed payment data
  payment: {
    requestId: string;
    amount: string;
    currency: string;
    network: string;
    recipient: string;
    payer: string;
    timestamp: number;
  };
}

// Service offering advertised by an agent
export interface ServiceOffering {
  // Service identifier
  serviceId: string;
  // Human-readable name
  name: string;
  // Description
  description: string;
  // Price per invocation
  price: PaymentTerms;
  // Rate limit (requests per minute)
  rateLimit: number;
  // Whether this service handles sensitive data
  sensitive: boolean;
}

// x402 configuration
export interface X402Config {
  // Whether x402 payments are enabled
  enabled: boolean;
  // Wallet address to receive payments (if offering services)
  walletAddress?: string;
  // Maximum amount willing to pay per request (safety cap)
  maxPaymentPerRequest?: string;
  // Allowed currencies
  allowedCurrencies: string[];
  // Allowed networks
  allowedNetworks: string[];
}

export const DEFAULT_X402_CONFIG: X402Config = {
  enabled: false,
  walletAddress: undefined,
  maxPaymentPerRequest: '1000000', // $1 USDC (6 decimals)
  allowedCurrencies: ['USDC'],
  allowedNetworks: ['base'],
};
