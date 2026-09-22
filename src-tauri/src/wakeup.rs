use crate::{account::AccountManager, models::CodexAuthMode, storage};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WakeupTask {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub account_id: String,
    pub interval_hours: u32,
    pub run_on_startup: bool,
    pub last_run_at: Option<i64>,
    pub last_status: Option<String>,
    pub last_duration_ms: Option<u64>,
    pub last_message: Option<String>,
    pub next_run_at: Option<i64>,
}
pub struct WakeupManager {
    tasks: Mutex<Vec<WakeupTask>>,
    running: Mutex<HashSet<String>>,
    storage_path: PathBuf,
    account_manager: Arc<AccountManager>,
}
impl WakeupManager {
    pub fn new(account_manager: Arc<AccountManager>) -> Result<Self, String> {
        Self::with_storage(
            account_manager,
            storage::data_dir()?.join("wakeup_tasks.json"),
        )
    }
    pub fn with_storage(
        account_manager: Arc<AccountManager>,
        storage_path: PathBuf,
    ) -> Result<Self, String> {
        let mut tasks: Vec<WakeupTask> = storage::read_or_default(&storage_path)?;
        let now = chrono::Utc::now().timestamp_millis();
        for task in &mut tasks {
            if task.enabled {
                task.next_run_at = Some(if task.run_on_startup {
                    now
                } else {
                    task.next_run_at
                        .unwrap_or(now + interval_ms(task.interval_hours))
                });
            } else {
                task.next_run_at = None;
            }
        }
        Ok(Self {
            tasks: Mutex::new(tasks),
            running: Mutex::new(HashSet::new()),
            storage_path,
            account_manager,
        })
    }
    pub fn list(&self) -> Vec<WakeupTask> {
        self.tasks.lock().unwrap().clone()
    }
    pub fn save_task(&self, mut task: WakeupTask) -> Result<WakeupTask, String> {
        if task.name.trim().is_empty() || !(1..=168).contains(&task.interval_hours) {
            return Err("Name and an interval between 1 and 168 hours are required".into());
        }
        if self.account_manager.get(&task.account_id)?.auth_mode != CodexAuthMode::OAuth {
            return Err("Quota checks require an OAuth account".into());
        }
        let mut lock = self.tasks.lock().unwrap();
        let mut next = lock.clone();
        if task.id.is_empty() {
            task.id = uuid::Uuid::new_v4().to_string();
        }
        let now = chrono::Utc::now().timestamp_millis();
        let existing = next.iter_mut().find(|t| t.id == task.id);
        // Execution history is backend-owned; toggling a task cannot fabricate success.
        if let Some(old) = existing {
            task.last_run_at = old.last_run_at;
            task.last_status = old.last_status.clone();
            task.last_duration_ms = old.last_duration_ms;
            task.last_message = old.last_message.clone();
            task.next_run_at = if !task.enabled {
                None
            } else if !old.enabled || old.interval_hours != task.interval_hours {
                Some(now + interval_ms(task.interval_hours))
            } else {
                old.next_run_at
                    .or(Some(now + interval_ms(task.interval_hours)))
            };
            *old = task.clone();
        } else {
            task.last_run_at = None;
            task.last_status = None;
            task.last_duration_ms = None;
            task.last_message = None;
            task.next_run_at = task
                .enabled
                .then_some(now + interval_ms(task.interval_hours));
            next.push(task.clone());
        }
        storage::write_json(&self.storage_path, &next)?;
        *lock = next;
        Ok(task)
    }
    pub fn delete_task(&self, id: &str) -> Result<(), String> {
        let mut lock = self.tasks.lock().unwrap();
        let mut next = lock.clone();
        next.retain(|t| t.id != id);
        storage::write_json(&self.storage_path, &next)?;
        *lock = next;
        Ok(())
    }
    pub async fn run_task(&self, id: &str) -> Result<WakeupTask, String> {
        let account_id = self
            .list()
            .iter()
            .find(|t| t.id == id)
            .ok_or("Task not found")?
            .account_id
            .clone();
        if !self.running.lock().unwrap().insert(id.into()) {
            return Err("Task is already running".into());
        }
        let _guard = RunGuard {
            running: &self.running,
            id: id.into(),
        };
        let start = std::time::Instant::now();
        let result = self.account_manager.refresh_quota(&account_id).await;
        let now = chrono::Utc::now().timestamp_millis();
        let mut lock = self.tasks.lock().unwrap();
        let mut next = lock.clone();
        let task = next
            .iter_mut()
            .find(|t| t.id == id)
            .ok_or("Task removed during execution")?;
        task.last_run_at = Some(now);
        task.last_duration_ms = Some(start.elapsed().as_millis() as u64);
        task.next_run_at = task
            .enabled
            .then_some(now + interval_ms(task.interval_hours));
        match result {
            Ok(_) => {
                task.last_status = Some("Success".into());
                task.last_message = Some(
                    "Quota fetched; credentials are valid. No generation request was sent.".into(),
                );
            }
            Err(error) => {
                task.last_status = Some("Failed".into());
                task.last_message = Some(error);
            }
        }
        let updated = task.clone();
        storage::write_json(&self.storage_path, &next)?;
        *lock = next;
        Ok(updated)
    }
    fn due(&self, now: i64) -> Vec<String> {
        self.tasks
            .lock()
            .unwrap()
            .iter()
            .filter(|t| t.enabled && t.next_run_at.is_some_and(|at| at <= now))
            .map(|t| t.id.clone())
            .collect()
    }
    pub fn start_background_loop(self: Arc<Self>) {
        tauri::async_runtime::spawn(async move {
            let mut timer = tokio::time::interval(std::time::Duration::from_secs(30));
            timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                timer.tick().await;
                for id in self.due(chrono::Utc::now().timestamp_millis()) {
                    if let Err(error) = self.run_task(&id).await {
                        tracing::warn!("Quota task failed: {error}");
                    }
                }
            }
        });
    }
}
fn interval_ms(hours: u32) -> i64 {
    hours.clamp(1, 168) as i64 * 3_600_000
}
struct RunGuard<'a> {
    running: &'a Mutex<HashSet<String>>,
    id: String,
}
impl Drop for RunGuard<'_> {
    fn drop(&mut self) {
        self.running.lock().unwrap().remove(&self.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn task() -> WakeupTask {
        WakeupTask {
            id: String::new(),
            name: "Quota check".into(),
            enabled: true,
            account_id: "test".into(),
            interval_hours: 4,
            run_on_startup: false,
            last_run_at: None,
            last_status: None,
            last_duration_ms: None,
            last_message: None,
            next_run_at: None,
        }
    }
    fn setup() -> (tempfile::TempDir, WakeupManager) {
        let dir = tempfile::tempdir().unwrap();
        let accounts = Arc::new(AccountManager::with_storage(
            dir.path().join("accounts.json"),
        ));
        accounts
            .import_from_json(r#"{"account_id":"test","access_token":"synthetic"}"#)
            .unwrap();
        let manager = WakeupManager::with_storage(accounts, dir.path().join("tasks.json")).unwrap();
        (dir, manager)
    }
    #[test]
    fn fresh_task_without_startup_flag_still_gets_scheduled() {
        let (_dir, manager) = setup();
        assert!(manager.list().is_empty());
        let saved = manager.save_task(task()).unwrap();
        assert!(saved.next_run_at.is_some());
        assert!(manager
            .due(chrono::Utc::now().timestamp_millis())
            .is_empty());
        assert_eq!(
            manager.due(saved.next_run_at.unwrap()),
            vec![saved.id.clone()]
        );
        manager.delete_task(&saved.id).unwrap();
        assert!(manager.list().is_empty());
    }
    #[test]
    fn invalid_intervals_and_fabricated_history_rejected() {
        let (_dir, manager) = setup();
        let mut t = task();
        t.interval_hours = 0;
        assert!(manager.save_task(t.clone()).is_err());
        t.interval_hours = 4;
        t.last_status = Some("Success".into());
        let mut saved = manager.save_task(t).unwrap();
        assert!(saved.last_status.is_none());
        saved.enabled = false;
        let saved = manager.save_task(saved).unwrap();
        assert!(saved.next_run_at.is_none());
    }
    #[test]
    fn startup_schedule_and_disabled_tasks() {
        let (dir, manager) = setup();
        let mut t = task();
        t.run_on_startup = true;
        manager.save_task(t).unwrap();
        let reloaded = WakeupManager::with_storage(
            manager.account_manager.clone(),
            dir.path().join("tasks.json"),
        )
        .unwrap();
        assert_eq!(reloaded.due(chrono::Utc::now().timestamp_millis()).len(), 1);
    }
    #[tokio::test]
    async fn deleted_account_is_recorded_as_failed_without_network() {
        let (_dir, manager) = setup();
        let saved = manager.save_task(task()).unwrap();
        manager.account_manager.delete("test").unwrap();
        let result = manager.run_task(&saved.id).await.unwrap();
        assert_eq!(result.last_status.as_deref(), Some("Failed"));
        assert!(result.next_run_at.is_some());
    }
}
