// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { invoke } from '@tauri-apps/api/core';
import { App } from '../../App';
import { Button } from './Button';
import { Badge } from './Badge';
import { Modal } from './Modal';
import { CopyButton, Notice } from './Elements';
import { DashboardPage } from '../../pages/DashboardPage';
import { AccountsPage } from '../../pages/AccountsPage';
import { GatewayPage } from '../../pages/GatewayPage';
import { InstancesPage } from '../../pages/InstancesPage';
import { WakeupPage } from '../../pages/WakeupPage';
import { InspectorPage } from '../../pages/InspectorPage';
import { SettingsPage } from '../../pages/SettingsPage';
import { useAccountStore } from '../../stores/useAccountStore';
import { useGatewayStore } from '../../stores/useGatewayStore';
import { useInstanceStore } from '../../stores/useInstanceStore';
import { useWakeupStore } from '../../stores/useWakeupStore';
import { useLogStore } from '../../stores/useLogStore';
import { useBackendError } from '../../lib/backend';
import type { CodexAccount } from '../../types/account';
import type { RequestLogEntry } from '../../types/logs';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const account: CodexAccount = {
  id: 'synthetic-account',
  email: 'test@example.invalid',
  name: 'Work profile',
  authMode: 'oauth',
  planType: 'plus',
  isActive: true,
  isCooldown: false,
  createdAt: 0,
  quota: {
    hourly: { usedPercent: 20, remainingPercent: 80 },
    weekly: { usedPercent: 10, remainingPercent: 90 },
    lunaReserveAllowed: false,
    lunaReserveActive: false,
    resetCreditsRemaining: 0,
    updatedAt: 1,
  },
};
const request: RequestLogEntry = {
  id: 'request-success',
  timestamp: 1,
  method: 'POST',
  path: '/v1/responses',
  clientModel: 'test-model',
  upstreamModel: 'test-model',
  routeKind: 'oauth',
  accountEmail: account.email,
  status: 201,
  durationMs: 300,
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
  cachedTokens: 0,
  reasoningTokens: 0,
};
const settings = {
  codexHome: '/synthetic/codex',
  codexBinary: 'codex',
  startGatewayOnLaunch: false,
  closeToTray: true,
  contextWindow: null,
  compactLimit: null,
  serviceTier: null,
};
function seed() {
  useAccountStore.setState({ accounts: [account], activeAccount: account });
  useLogStore.setState({
    logs: [
      request,
      {
        ...request,
        id: 'request-error',
        status: 429,
        error: 'Synthetic rate limit',
        clientModel: 'other-model',
      },
    ],
  });
  useGatewayStore.setState({
    apiKeys: [
      {
        id: 'test-key',
        name: 'Test client',
        key: 'synthetic-client-secret',
        enabled: true,
        totalTokensUsed: 30,
        createdAt: 0,
      },
    ],
  });
  useInstanceStore.setState({
    instances: [
      {
        id: 'test-instance',
        name: 'Project workspace',
        profilePath: '/synthetic/profiles/test',
        isRunning: false,
        mixedRoutingEnabled: false,
        routes: [],
        createdAt: 0,
      },
    ],
  });
  useWakeupStore.setState({
    tasks: [
      {
        id: 'task',
        name: 'Daily check',
        accountId: account.id,
        enabled: true,
        intervalHours: 4,
        runOnStartup: false,
        lastStatus: 'Success',
        lastDurationMs: 200,
      },
    ],
  });
}
beforeEach(() => {
  document.documentElement.lang = 'en';
  document.title = 'CodexProxy';
  vi.restoreAllMocks();
  vi.mocked(invoke).mockReset();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  useAccountStore.setState(useAccountStore.getInitialState());
  useGatewayStore.setState(useGatewayStore.getInitialState());
  useInstanceStore.setState(useInstanceStore.getInitialState());
  useWakeupStore.setState(useWakeupStore.getInitialState());
  useLogStore.setState(useLogStore.getInitialState());
  useBackendError.getState().clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('shared interaction and motion-ready components', () => {
  it('keeps static design variants available to the CSS compiler', () => {
    render(
      <>
        <Button variant="primary">Start</Button>
        <Badge variant="emerald">Live</Badge>
        <Notice tone="success">Saved</Notice>
      </>,
    );
    expect(screen.getByText('Start').classList.contains('btn-primary')).toBe(true);
    expect(screen.getByText('Live').classList.contains('badge-emerald')).toBe(true);
    expect(screen.getByText('Saved').parentElement?.classList.contains('notice-success')).toBe(
      true,
    );
  });
  it('disables a busy button without losing its accessible label', () => {
    render(<Button loading>Save changes</Button>);
    const button = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });
  it('focuses the dialog, traps Tab, restores focus and respects non-dismissible work', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    const shell = document.createElement('div');
    shell.id = 'app-shell';
    document.body.append(shell);
    const trigger = document.createElement('button');
    trigger.textContent = 'Trigger';
    shell.append(trigger);
    trigger.focus();
    const view = render(
      <Modal isOpen onClose={close} title="Edit">
        <label>
          Name
          <input />
        </label>
        <Button>Last</Button>
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }));
    expect(shell.inert).toBe(true);
    screen.getByRole('button', { name: 'Last' }).focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close dialog' }));
    await user.keyboard('{Escape}');
    expect(close).toHaveBeenCalledTimes(1);
    view.rerender(
      <Modal isOpen dismissible={false} onClose={close} title="Edit">
        <Button loading>Saving</Button>
      </Modal>,
    );
    await user.keyboard('{Escape}');
    expect(close).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(document.activeElement).toBe(trigger);
    expect(shell.inert).toBe(false);
    shell.remove();
  });
  it('only reports clipboard success when writing succeeds', async () => {
    const user = userEvent.setup();
    const write = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockRejectedValueOnce(new Error('Denied'));
    render(<CopyButton value="synthetic" label="Copy endpoint" />);
    await user.click(screen.getByRole('button', { name: 'Copy endpoint' }));
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
    expect(useBackendError.getState().error).toContain('clipboard');
    write.mockResolvedValueOnce();
    await user.click(screen.getByRole('button', { name: 'Copy endpoint' }));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
  });
});

describe('page workflows', () => {
  it('navigates all seven pages and supports the searchable keyboard palette', async () => {
    const user = userEvent.setup();
    render(<App />);
    for (const [name, heading] of [
      ['Accounts', 'Connected accounts'],
      ['Gateway', 'Gateway'],
      ['Instances', 'Instances'],
      ['Schedules', 'Schedules'],
      ['Request logs', 'Request logs'],
      ['Settings', 'Settings'],
      ['Overview', 'Workspace overview'],
    ]) {
      await user.click(
        within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', {
          name,
        }),
      );
      expect(screen.getByRole('heading', { level: 1, name: heading })).toBeTruthy();
    }
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog', { name: 'Go to a page' })).toBeTruthy();
    await user.type(screen.getByRole('searchbox', { name: 'Search pages…' }), 'accounts{Enter}');
    expect(screen.getByRole('heading', { name: 'Connected accounts' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('searches populated accounts and keeps failed imports open', async () => {
    seed();
    const user = userEvent.setup();
    render(<AccountsPage />);
    await user.type(screen.getByRole('searchbox'), 'missing');
    expect(screen.getByText('No matching accounts')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText('Work profile')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Import JSON' }));
    await user.type(screen.getByRole('textbox', { name: /Account JSON/ }), 'invalid');
    await user.click(screen.getByRole('button', { name: 'Import accounts' }));
    expect(screen.getByRole('dialog', { name: 'Import accounts' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Desktop backend unavailable');
  });
  it('requires confirmation before account removal or external profile writes', async () => {
    seed();
    const user = userEvent.setup();
    const remove = vi.fn().mockResolvedValue(true);
    const activate = vi.fn().mockResolvedValue(true);
    useAccountStore.setState({ deleteAccount: remove, switchActiveAccount: activate });
    render(<AccountsPage />);
    await user.click(screen.getByRole('button', { name: 'Remove test@example.invalid' }));
    expect(remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Sync Codex profile' }));
    expect(activate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Update profile' }));
    expect(activate).toHaveBeenCalledWith(account.id);
  });
  it('does not persist gateway edits on each keystroke', async () => {
    const user = userEvent.setup();
    const update = vi.fn().mockResolvedValue(true);
    useGatewayStore.setState({ updatePort: update });
    render(<GatewayPage />);
    const input = screen.getByRole('spinbutton', { name: /Listener port/ });
    await user.clear(input);
    await user.type(input, '9001');
    expect(update).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(update).toHaveBeenCalledWith(9001);
  });
  it('shows schedule setup requirements without creating fake work', async () => {
    const user = userEvent.setup();
    render(<WakeupPage />);
    await user.click(screen.getByRole('button', { name: 'New schedule' }));
    expect(screen.getByText(/Connect a ChatGPT OAuth account/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Create schedule' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it('keeps failed instance creation open', async () => {
    const user = userEvent.setup();
    render(<InstancesPage />);
    await user.click(screen.getByRole('button', { name: 'New instance' }));
    await user.type(screen.getByRole('textbox', { name: 'Instance name' }), 'Example');
    await user.click(screen.getByRole('button', { name: 'Create instance' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(useInstanceStore.getState().instances).toEqual([]);
  });
  it('treats all 2xx statuses as success and exposes keyboard-accessible details', async () => {
    seed();
    const user = userEvent.setup();
    render(<InspectorPage />);
    await user.click(screen.getByRole('button', { name: /Success/ }));
    expect(screen.queryByText('429')).toBeNull();
    expect(screen.getByText('201')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Inspect request request-success' }));
    expect(screen.getByRole('dialog', { name: 'Request details' })).toBeTruthy();
    expect(screen.getByText('Token accounting')).toBeTruthy();
  });
  it('keeps preview settings disabled and requires explicit confirmation to apply', async () => {
    const user = userEvent.setup();
    const first = render(<SettingsPage />);
    expect(
      (
        screen.getByRole('textbox', { name: 'Codex profile directory' }) as HTMLInputElement
      ).closest('fieldset')?.disabled,
    ).toBe(true);
    first.unmount();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === 'get_app_settings' ? settings : settings,
    );
    render(<SettingsPage />);
    await waitFor(() =>
      expect(
        (screen.getByRole('textbox', { name: 'Codex profile directory' }) as HTMLInputElement)
          .value,
      ).toBe('/synthetic/codex'),
    );
    await user.click(screen.getByRole('button', { name: 'Save & apply overrides' }));
    expect(vi.mocked(invoke).mock.calls.some(([name]) => name === 'apply_codex_config')).toBe(
      false,
    );
    await user.click(screen.getByRole('button', { name: 'Save & apply' }));
    await waitFor(() =>
      expect(vi.mocked(invoke).mock.calls.some(([name]) => name === 'apply_codex_config')).toBe(
        true,
      ),
    );
  });
});

const pages = [
  ['Overview', () => <DashboardPage onNavigate={() => {}} />],
  ['Accounts', () => <AccountsPage />],
  ['Gateway', () => <GatewayPage />],
  ['Instances', () => <InstancesPage />],
  ['Schedules', () => <WakeupPage />],
  ['Logs', () => <InspectorPage />],
  ['Settings', () => <SettingsPage />],
] as const;
describe.each(['empty', 'populated'])('%s page accessibility', (state) => {
  it.each(pages)('%s has no detectable semantic accessibility violations', async (_name, Page) => {
    if (state === 'populated') seed();
    render(
      <main>
        <Page />
      </main>,
    );
    const result = await axe.run(document.body, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(
      result.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
  });
});
it('Escape does not dismiss a busy OAuth dialog', async () => {
  const user = userEvent.setup();
  useAccountStore.setState({ startOAuthLogin: () => new Promise(() => {}) });
  render(<AccountsPage />);
  await user.click(screen.getByRole('button', { name: 'Add account' }));
  await user.click(screen.getByRole('button', { name: 'Continue with OpenAI' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeTruthy();
});

describe('dialog accessibility', () => {
  const dialogs = [
    { name: 'OAuth connection', page: AccountsPage, button: 'Add account' },
    { name: 'JSON import', page: AccountsPage, button: 'Import JSON' },
    { name: 'Client key', page: GatewayPage, button: 'New key' },
    { name: 'New instance', page: InstancesPage, button: 'New instance' },
    { name: 'Model route', page: InstancesPage, button: 'Add route' },
    { name: 'Schedule', page: WakeupPage, button: 'New schedule' },
    { name: 'Request details', page: InspectorPage, button: 'Inspect request request-success' },
    { name: 'Destructive confirmation', page: InspectorPage, button: 'Clear logs' },
  ];
  it.each(dialogs)(
    '$name is named, modal, and free of detectable semantic violations',
    async ({ page: Page, button }) => {
      seed();
      const user = userEvent.setup();
      render(
        <div id="app-shell">
          <main>
            <Page />
          </main>
        </div>,
      );
      await user.click(screen.getByRole('button', { name: button }));
      expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
      const result = await axe.run(document.body, {
        rules: { 'color-contrast': { enabled: false } },
      });
      expect(result.violations.map((v) => v.id)).toEqual([]);
    },
  );
});
