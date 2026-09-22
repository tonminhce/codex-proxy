export type CodexAuthMode = 'oauth' | 'apikey' | 'pat';

export type CodexPlanType = 'free' | 'basic' | 'plus' | 'team' | 'pro' | 'enterprise';

export interface CodexQuotaWindow {
  usedPercent: number;
  remainingPercent: number;
  resetAt?: string;
  resetMinutesRemaining?: number;
}

export interface CodexQuota {
  hourly: CodexQuotaWindow;
  weekly: CodexQuotaWindow;
  lunaReserveAllowed: boolean;
  lunaReserveActive: boolean;
  resetCreditsRemaining: number;
  updatedAt: number;
}

export interface CodexAccount {
  id: string;
  email: string;
  name?: string;
  authMode: CodexAuthMode;
  planType: CodexPlanType;
  isActive: boolean;
  isCooldown: boolean;
  cooldownUntil?: number;
  quota: CodexQuota;
  createdAt: number;
  lastUsedAt?: number;
  apiBaseUrl?: string;
  apiKeyPrefix?: string;
}

export interface AddAccountPayload {
  authMode: CodexAuthMode;
  email?: string;
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  apiBaseUrl?: string;
  name?: string;
}
