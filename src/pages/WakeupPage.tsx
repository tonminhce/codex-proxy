import React, { useState } from 'react';
import { Clock3, Plus, Play, Trash2, CalendarClock, ShieldCheck } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import {
  ConfirmDialog,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  Switch,
} from '../components/ui/Elements';
import { useWakeupStore } from '../stores/useWakeupStore';
import { useAccountStore } from '../stores/useAccountStore';
import { useBackendError } from '../lib/backend';
export const WakeupPage: React.FC = () => {
  const store = useWakeupStore();
  const accounts = useAccountStore((s) => s.accounts);
  const oauth = accounts.filter((a) => a.authMode === 'oauth');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [interval, setInterval] = useState(4);
  const [startup, setStartup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const add = () => {
    useBackendError.getState().clear();
    setAccountId(oauth[0]?.id || '');
    setOpen(true);
  };
  const date = (value?: number) =>
    value
      ? new Date(value).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'Not yet';
  return (
    <div className="page">
      <PageHeader
        eyebrow="Background operations"
        title="Schedules"
        description="A little maintenance, on your terms. Check quota and refresh expired credentials."
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={add}>
            New schedule
          </Button>
        }
      />
      <div className="metrics" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {[
          { label: 'Total schedules', value: store.tasks.length },
          { label: 'Enabled', value: store.tasks.filter((t) => t.enabled).length },
          {
            label: 'Last run failed',
            value: store.tasks.filter((t) => t.lastStatus === 'Failed').length,
          },
        ].map((m) => (
          <div className="metric" key={m.label}>
            <span className="metric-label">{m.label}</span>
            <div className="metric-value">{m.value.toString().padStart(2, '0')}</div>
          </div>
        ))}
      </div>
      {!store.tasks.length ? (
        <Card>
          <EmptyState
            icon={<CalendarClock size={24} />}
            title="Set it once. Stay informed."
            description="Schedule a quota check for an OAuth account. Tasks run while CodexProxy is open, even when hidden in the tray."
            action={
              <Button icon={<Plus size={13} />} onClick={add}>
                Create a schedule
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="stack">
          {store.tasks.map((task) => (
            <Card key={task.id}>
              <div className="account-card-head">
                <div className="account-identity">
                  <div className="avatar">
                    <Clock3 size={18} />
                  </div>
                  <div>
                    <h2>{task.name}</h2>
                    <p className="small muted mt-1">
                      {accounts.find((a) => a.id === task.accountId)?.email ||
                        'Account unavailable'}
                      <span className="mx-2 dim">·</span>Every {task.intervalHours}h
                    </p>
                  </div>
                </div>
                <div className="actions">
                  <Badge dot variant={task.enabled ? 'emerald' : 'zinc'}>
                    {task.enabled ? 'Scheduled' : 'Paused'}
                  </Badge>
                  <Button
                    size="sm"
                    loading={store.runningTaskId === task.id}
                    disabled={store.runningTaskId !== null}
                    icon={<Play size={12} />}
                    onClick={() => void store.runTaskNow(task.id)}
                  >
                    Run now
                  </Button>
                  <button
                    className="icon-button danger"
                    aria-label={'Delete schedule ' + task.name}
                    onClick={() => {
                      useBackendError.getState().clear();
                      setRemoveId(task.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="my-4">
                <Switch
                  label={task.enabled ? 'Schedule enabled' : 'Schedule paused'}
                  description={
                    task.runOnStartup
                      ? 'Also runs when the application starts.'
                      : 'Runs at the configured interval.'
                  }
                  checked={task.enabled}
                  onChange={() => void store.toggleTaskEnabled(task.id)}
                />
              </div>
              <dl className="task-meta">
                <div>
                  <dt>LAST CHECK</dt>
                  <dd>{date(task.lastRunAt)}</dd>
                </div>
                <div>
                  <dt>RESULT</dt>
                  <dd>
                    {task.lastStatus ? (
                      <Badge variant={task.lastStatus === 'Success' ? 'emerald' : 'rose'}>
                        {task.lastStatus}
                        {task.lastDurationMs != null ? ' · ' + task.lastDurationMs + ' ms' : ''}
                      </Badge>
                    ) : (
                      <span className="muted">Awaiting first run</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>NEXT CHECK</dt>
                  <dd>{task.enabled ? date(task.nextRunAt) : 'Paused'}</dd>
                </div>
              </dl>
              {task.lastMessage && <p className="small muted mt-4">{task.lastMessage}</p>}
            </Card>
          ))}
        </div>
      )}
      <Notice>
        <ShieldCheck size={12} className="inline mr-1" />
        These tasks fetch usage information; they do not send model prompts or guarantee a quota
        reset. No account is kept “warm” by generating hidden requests.
      </Notice>
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        dismissible={!busy}
        title="Create a schedule"
        description="Choose an account and how often to check its quota."
      >
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              if (
                await store.saveTask({
                  id: '',
                  name,
                  enabled: true,
                  accountId,
                  intervalHours: interval,
                  runOnStartup: startup,
                })
              ) {
                setOpen(false);
                setName('');
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          {!oauth.length && (
            <Notice tone="warning">
              Connect a ChatGPT OAuth account from the Accounts page before creating a schedule.
            </Notice>
          )}
          <Field label="Schedule name">
            <input
              className="input"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Work account check"
            />
          </Field>
          <Field label="OAuth account">
            <select
              className="input"
              required
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Select an account</option>
              {oauth.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.email}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Check interval">
            <select
              className="input"
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
            >
              {[2, 4, 6, 8, 12, 24].map((hours) => (
                <option key={hours} value={hours}>
                  Every {hours} hours
                </option>
              ))}
            </select>
          </Field>
          <Switch
            label="Run on app startup"
            description="Also check when CodexProxy is launched."
            checked={startup}
            onChange={setStartup}
          />
          <div className="modal-actions">
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!accountId}>
              Create schedule
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={removeId !== null}
        title="Delete this schedule?"
        description="Future quota checks for this task will stop. The connected account is not removed."
        confirmLabel="Delete schedule"
        onClose={() => setRemoveId(null)}
        onConfirm={() => store.deleteTask(removeId!)}
      />
    </div>
  );
};
