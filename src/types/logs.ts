export interface RequestLogEntry {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  clientModel: string;
  upstreamModel: string;
  routeKind: 'oauth' | 'provider_gateway' | 'mixed_route';
  accountId?: string;
  accountEmail?: string;
  apiKeyId?: string;
  status: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  error?: string;
}

export interface RequestLogFilter {
  query?: string;
  status?: 'all' | 'success' | 'error';
  model?: string;
  accountId?: string;
}
