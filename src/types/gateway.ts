export type RoutingStrategy =
  | 'auto'
  | 'random'
  | 'single_account'
  | 'quota_high_first'
  | 'quota_low_first'
  | 'plan_high_first'
  | 'custom';

export type GatewayScope = 'localhost' | 'lan';

export interface ClientApiKey {
  id: string;
  name: string;
  key: string;
  enabled: boolean;
  allowedModels?: string[];
  excludedModels?: string[];
  boundAccountIds?: string[];
  tokenLimit?: number;
  totalTokensUsed: number;
  createdAt: number;
}

export interface GatewayState {
  running: boolean;
  port: number;
  host: string;
  scope: GatewayScope;
  routingStrategy: RoutingStrategy;
  sessionAffinity: boolean;
  sessionAffinityTtlSeconds: number;
  quotaReservePercent: number;
  maxRetries: number;
  requestTimeoutSeconds: number;
  requestsPerMinute: number;
  apiKeys: ClientApiKey[];
  activeUpstreamAccountId?: string;
  stats: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    totalTokens: number;
    requestsPerSecond: number;
  };
}
