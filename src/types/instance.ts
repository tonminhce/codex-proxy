export interface ModelRoute {
  id: string;
  namespace: string;
  providerName: string;
  providerBaseUrl: string;
  upstreamModel: string;
  enabled: boolean;
}

export interface CodexInstance {
  id: string;
  name: string;
  profilePath: string;
  isRunning: boolean;
  pid?: number;
  boundAccountId?: string;
  mixedRoutingEnabled: boolean;
  routes: ModelRoute[];
  createdAt: number;
  lastLaunchedAt?: number;
}
