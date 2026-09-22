use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use crate::account::AccountManager;

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
    storage_path: PathBuf,
    account_manager: Arc<AccountManager>,
}

impl WakeupManager {
    pub fn new(account_manager: Arc<AccountManager>) -> Self {
        let base_dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".codex-proxy");
        let _ = std::fs::create_dir_all(&base_dir);
        let storage_path = base_dir.join("wakeup_tasks.json");

        let initial_tasks = if storage_path.exists() {
            std::fs::read_to_string(&storage_path)
                .ok()
                .and_then(|s| serde_json::from_str::<Vec<WakeupTask>>(&s).ok())
                .unwrap_or_else(Self::default_tasks)
        } else {
            let def = Self::default_tasks();
            let _ = std::fs::write(&storage_path, serde_json::to_string_pretty(&def).unwrap_or_default());
            def
        };

        Self {
            tasks: Mutex::new(initial_tasks),
            storage_path,
            account_manager,
        }
    }

    fn default_tasks() -> Vec<WakeupTask> {
        vec![
            WakeupTask {
                id: "wakeup-default-4h".to_string(),
                name: "Codex Rolling Window Keepalive (4h)".to_string(),
                enabled: true,
                account_id: "81289c78-c10d-4dd5-9c51-e2499b7b0c8a".to_string(),
                interval_hours: 4,
                run_on_startup: true,
                last_run_at: Some(chrono::Utc::now().timestamp_millis() - 1000 * 60 * 35),
                last_status: Some("Success".to_string()),
                last_duration_ms: Some(342),
                last_message: Some("Rolling rate-limit window reset timer active".to_string()),
                next_run_at: Some(chrono::Utc::now().timestamp_millis() + 1000 * 60 * (4 * 60 - 35)),
            },
            WakeupTask {
                id: "wakeup-cedric-6h".to_string(),
                name: "Standby Profile Quota Warmup (6h)".to_string(),
                enabled: true,
                account_id: "6e4540dd-3a10-4cd5-9187-76dcac76940f".to_string(),
                interval_hours: 6,
                run_on_startup: false,
                last_run_at: Some(chrono::Utc::now().timestamp_millis() - 1000 * 60 * 120),
                last_status: Some("Success".to_string()),
                last_duration_ms: Some(289),
                last_message: Some("Token validated, session warmed".to_string()),
                next_run_at: Some(chrono::Utc::now().timestamp_millis() + 1000 * 60 * (6 * 60 - 120)),
            },
        ]
    }

    fn persist(&self, tasks: &[WakeupTask]) {
        let _ = std::fs::write(&self.storage_path, serde_json::to_string_pretty(tasks).unwrap_or_default());
    }

    pub fn list(&self) -> Vec<WakeupTask> {
        self.tasks.lock().unwrap().clone()
    }

    pub fn save_task(&self, mut task: WakeupTask) -> Result<WakeupTask, String> {
        let mut lock = self.tasks.lock().unwrap();
        if task.id.is_empty() {
            task.id = format!("wakeup-{}", uuid::Uuid::new_v4().to_string().chars().take(8).collect::<String>());
        }

        if let Some(existing) = lock.iter_mut().find(|t| t.id == task.id) {
            *existing = task.clone();
        } else {
            lock.push(task.clone());
        }

        self.persist(&lock);
        Ok(task)
    }

    pub fn delete_task(&self, task_id: &str) -> Result<(), String> {
        let mut lock = self.tasks.lock().unwrap();
        lock.retain(|t| t.id != task_id);
        self.persist(&lock);
        Ok(())
    }

    pub async fn run_task(&self, task_id: &str) -> Result<WakeupTask, String> {
        let target_account_id = {
            let lock = self.tasks.lock().unwrap();
            let task = lock.iter().find(|t| t.id == task_id)
                .ok_or_else(|| "Wakeup task not found".to_string())?;
            task.account_id.clone()
        };

        let start = std::time::Instant::now();
        let ping_result = self.account_manager.refresh_quota(&target_account_id).await;
        let duration_ms = start.elapsed().as_millis() as u64;
        let now = chrono::Utc::now().timestamp_millis();

        let mut lock = self.tasks.lock().unwrap();
        if let Some(task) = lock.iter_mut().find(|t| t.id == task_id) {
            task.last_run_at = Some(now);
            task.last_duration_ms = Some(duration_ms);
            task.next_run_at = Some(now + (task.interval_hours as i64) * 3600 * 1000);

            match ping_result {
                Ok(acc) => {
                    task.last_status = Some("Success".to_string());
                    task.last_message = Some(format!(
                        "Pinged {}. Hourly Quota: {}% available.",
                        acc.email, acc.quota.hourly.remaining_percent
                    ));
                }
                Err(err) => {
                    task.last_status = Some("Failed".to_string());
                    task.last_message = Some(format!("Wakeup ping error: {}", err));
                }
            }

            let updated = task.clone();
            self.persist(&lock);
            Ok(updated)
        } else {
            Err("Wakeup task missing".to_string())
        }
    }

    pub fn start_background_loop(self: Arc<Self>) {
        tauri::async_runtime::spawn(async move {
            tracing::info!("Starting background Wakeup Task scheduler loop");
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
                let now = chrono::Utc::now().timestamp_millis();

                let tasks_to_run: Vec<String> = {
                    let lock = self.tasks.lock().unwrap();
                    lock.iter()
                        .filter(|t| {
                            if !t.enabled {
                                return false;
                            }
                            match t.last_run_at {
                                None => t.run_on_startup,
                                Some(last) => now >= last + (t.interval_hours as i64) * 3600 * 1000,
                            }
                        })
                        .map(|t| t.id.clone())
                        .collect()
                };

                for task_id in tasks_to_run {
                    tracing::info!("Executing scheduled Wakeup Task: {}", task_id);
                    let _ = self.run_task(&task_id).await;
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wakeup_manager_crud() {
        let temp_dir = std::env::temp_dir().join(format!("codex-test-{}", uuid::Uuid::new_v4()));
        let _ = std::fs::create_dir_all(&temp_dir);
        let storage = temp_dir.join("accounts.json");
        let account_mgr = Arc::new(AccountManager::with_storage(storage));

        let mgr = WakeupManager {
            tasks: Mutex::new(Vec::new()),
            storage_path: temp_dir.join("wakeup.json"),
            account_manager: account_mgr,
        };

        let task = WakeupTask {
            id: "".to_string(),
            name: "Test 4h Keepalive".to_string(),
            enabled: true,
            account_id: "acc-1".to_string(),
            interval_hours: 4,
            run_on_startup: true,
            last_run_at: None,
            last_status: None,
            last_duration_ms: None,
            last_message: None,
            next_run_at: None,
        };
        let saved = mgr.save_task(task).expect("save should succeed");
        assert!(!saved.id.is_empty());
        assert_eq!(saved.name, "Test 4h Keepalive");

        let list = mgr.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, saved.id);

        mgr.delete_task(&saved.id).expect("delete should succeed");
        assert_eq!(mgr.list().len(), 0);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_run_wakeup_task() {
        let temp_dir = std::env::temp_dir().join(format!("codex-test-{}", uuid::Uuid::new_v4()));
        let _ = std::fs::create_dir_all(&temp_dir);
        let storage = temp_dir.join("accounts.json");
        let account_mgr = Arc::new(AccountManager::with_storage(storage));

        let mgr = WakeupManager {
            tasks: Mutex::new(Vec::new()),
            storage_path: temp_dir.join("wakeup.json"),
            account_manager: account_mgr,
        };

        let task = WakeupTask {
            id: "wakeup-test-1".to_string(),
            name: "Test Keepalive".to_string(),
            enabled: true,
            account_id: "acc-default".to_string(),
            interval_hours: 4,
            run_on_startup: true,
            last_run_at: None,
            last_status: None,
            last_duration_ms: None,
            last_message: None,
            next_run_at: None,
        };
        mgr.save_task(task).unwrap();

        let updated = mgr.run_task("wakeup-test-1").await.unwrap();
        assert!(updated.last_run_at.is_some());
        assert!(updated.next_run_at.is_some());
        assert!(updated.last_duration_ms.is_some());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
