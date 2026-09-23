// Explicit visual-test entry point. Never imported by src/main.tsx or included in the production build.
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../../src/App';
import '../../src/index.css';
import { useAccountStore } from '../../src/stores/useAccountStore';
import { useGatewayStore } from '../../src/stores/useGatewayStore';
import { useLogStore } from '../../src/stores/useLogStore';
import { useInstanceStore } from '../../src/stores/useInstanceStore';
import { useWakeupStore } from '../../src/stores/useWakeupStore';
import type { CodexAccount } from '../../src/types/account';

if (!import.meta.env.DEV) throw new Error('Visual fixtures are development-only');
const now = Date.now();
const accounts: CodexAccount[] = [
  {
    id: 'fixture-work',
    name: 'Work profile',
    email: 'work@example.invalid',
    authMode: 'oauth',
    planType: 'plus',
    isActive: true,
    isCooldown: false,
    createdAt: now,
    quota: {
      hourly: { usedPercent: 22, remainingPercent: 78 },
      weekly: { usedPercent: 42, remainingPercent: 58 },
      updatedAt: now,
      lunaReserveAllowed: false,
      lunaReserveActive: false,
      resetCreditsRemaining: 0,
    },
  },
  {
    id: 'fixture-personal',
    name: 'Personal research',
    email: 'personal@example.invalid',
    authMode: 'oauth',
    planType: 'pro',
    isActive: false,
    isCooldown: false,
    createdAt: now,
    quota: {
      hourly: { usedPercent: 86, remainingPercent: 14 },
      weekly: { usedPercent: 72, remainingPercent: 28 },
      updatedAt: now,
      lunaReserveAllowed: false,
      lunaReserveActive: false,
      resetCreditsRemaining: 0,
    },
  },
  {
    id: 'fixture-api',
    name: 'Engineering team — extraordinarily long profile name for layout testing',
    email: 'engineering-team-with-a-long-address@example.invalid',
    authMode: 'apikey',
    planType: 'unknown',
    isActive: false,
    isCooldown: false,
    createdAt: now,
    apiBaseUrl: 'https://api.example.invalid/v1',
    quota: {
      hourly: { usedPercent: 0, remainingPercent: 0 },
      weekly: { usedPercent: 0, remainingPercent: 0 },
      updatedAt: 0,
      lunaReserveAllowed: false,
      lunaReserveActive: false,
      resetCreditsRemaining: 0,
    },
  },
];
useAccountStore.setState({ accounts, activeAccount: accounts[0] });
useGatewayStore.setState({
  running: true,
  stats: {
    totalRequests: 128,
    successfulRequests: 126,
    failedRequests: 2,
    totalTokens: 284600,
    requestsPerSecond: 0.4,
  },
  apiKeys: [
    {
      id: 'fixture-key',
      name: 'Development CLI',
      key: 'synthetic-ui-fixture-not-a-real-key',
      enabled: true,
      totalTokensUsed: 8400,
      createdAt: now,
    },
  ],
});
useLogStore.setState({
  logs: [0, 1, 2, 3, 4].map((index) => ({
    id: 'fixture-request-' + index,
    timestamp: now - index * 60000,
    method: 'POST',
    path: '/v1/responses',
    clientModel: index === 1 ? 'work/example-model' : 'example-model',
    upstreamModel: 'example-model',
    routeKind: 'oauth',
    accountId: accounts[0].id,
    accountEmail: accounts[0].email,
    status: index === 2 ? 429 : 200,
    durationMs: 800 + index * 180,
    inputTokens: 1200,
    outputTokens: 400,
    totalTokens: 1600,
    cachedTokens: 800,
    reasoningTokens: 50,
    error: index === 2 ? 'Synthetic example: upstream rate limit reached.' : undefined,
  })),
});
useInstanceStore.setState({
  instances: [
    {
      id: 'fixture-instance',
      name: 'Engineering workspace',
      profilePath: '/synthetic/.codex-proxy/profiles/engineering-workspace',
      isRunning: true,
      pid: 12345,
      endpoint: 'ws://127.0.0.1:9009',
      boundAccountId: accounts[0].id,
      mixedRoutingEnabled: true,
      routes: [
        {
          id: 'fixture-route',
          namespace: 'work',
          providerName: 'Engineering relay',
          providerBaseUrl: 'https://api.example.invalid/v1',
          upstreamModel: 'example-model-with-an-extraordinarily-long-name-for-layout-testing',
          accountId: accounts[2].id,
          enabled: true,
        },
      ],
      createdAt: now,
    },
    {
      id: 'fixture-sandbox',
      name: 'Sandbox',
      profilePath: '/synthetic/.codex-proxy/profiles/sandbox',
      isRunning: false,
      mixedRoutingEnabled: false,
      routes: [],
      createdAt: now,
    },
  ],
});
useWakeupStore.setState({
  tasks: [
    {
      id: 'fixture-task',
      name: 'Work account quota check',
      accountId: accounts[0].id,
      enabled: true,
      intervalHours: 4,
      runOnStartup: true,
      lastRunAt: now - 60000,
      nextRunAt: now + 3600000,
      lastStatus: 'Success',
      lastDurationMs: 220,
      lastMessage: 'Synthetic fixture: quota fetched successfully.',
    },
    {
      id: 'fixture-task-failed',
      name: 'Personal account check',
      accountId: accounts[1].id,
      enabled: false,
      intervalHours: 12,
      runOnStartup: false,
      lastRunAt: now - 7200000,
      lastStatus: 'Failed',
      lastDurationMs: 500,
      lastMessage: 'Synthetic fixture: account credentials need to be refreshed.',
    },
  ],
});
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
