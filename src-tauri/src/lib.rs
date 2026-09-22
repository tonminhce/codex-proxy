pub mod account;
pub mod instances;
pub mod models;
pub mod oauth;
pub mod protocol;
pub mod proxy;
pub mod settings;
pub mod storage;
pub mod wakeup;

use account::AccountManager;
use instances::{CodexInstance, InstanceManager};
use models::{CodexAccount, GatewayConfig, GatewayStats, RequestLogEntry};
use proxy::ProxyServer;
use settings::{AppSettings, SettingsManager};
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, State,
};
use wakeup::{WakeupManager, WakeupTask};

pub struct AppState {
    pub account_manager: Arc<AccountManager>,
    pub proxy_server: Arc<ProxyServer>,
    pub wakeup_manager: Arc<WakeupManager>,
    pub settings: Arc<SettingsManager>,
    pub instances: Arc<InstanceManager>,
    pub oauth_lock: tokio::sync::Mutex<()>,
}
fn safe(account: CodexAccount) -> CodexAccount {
    AccountManager::redacted(account)
}

#[tauri::command]
fn list_codex_accounts(state: State<AppState>) -> Vec<CodexAccount> {
    state.account_manager.list().into_iter().map(safe).collect()
}
#[tauri::command]
fn get_active_codex_account(state: State<AppState>) -> Option<CodexAccount> {
    state.account_manager.get_active().map(safe)
}
#[tauri::command]
fn switch_codex_account(
    account_id: String,
    state: State<AppState>,
) -> Result<CodexAccount, String> {
    state.account_manager.switch_active(&account_id).map(safe)
}
#[tauri::command]
fn add_codex_account(account: CodexAccount, state: State<AppState>) -> Result<(), String> {
    state.account_manager.add(account)
}
#[tauri::command]
fn delete_codex_account(account_id: String, state: State<AppState>) -> Result<(), String> {
    state.account_manager.delete(&account_id)
}
#[tauri::command]
fn import_codex_from_json(
    json_content: String,
    state: State<AppState>,
) -> Result<Vec<CodexAccount>, String> {
    state
        .account_manager
        .import_from_json(&json_content)
        .map(|v| v.into_iter().map(safe).collect())
}
#[tauri::command]
async fn refresh_codex_quota(
    account_id: String,
    state: State<'_, AppState>,
) -> Result<CodexAccount, String> {
    state
        .account_manager
        .refresh_quota(&account_id)
        .await
        .map(safe)
}
#[tauri::command]
async fn refresh_codex_token(
    account_id: String,
    state: State<'_, AppState>,
) -> Result<CodexAccount, String> {
    state
        .account_manager
        .refresh_token(&account_id)
        .await
        .map(safe)
}
#[tauri::command]
async fn start_oauth_login(state: State<'_, AppState>) -> Result<CodexAccount, String> {
    let _guard = state
        .oauth_lock
        .try_lock()
        .map_err(|_| "An OAuth login is already in progress")?;
    oauth::perform_pkce_oauth_login(state.account_manager.clone())
        .await
        .map(safe)
}
#[tauri::command]
fn list_wakeup_tasks(state: State<AppState>) -> Vec<WakeupTask> {
    state.wakeup_manager.list()
}
#[tauri::command]
fn save_wakeup_task(task: WakeupTask, state: State<AppState>) -> Result<WakeupTask, String> {
    state.wakeup_manager.save_task(task)
}
#[tauri::command]
fn delete_wakeup_task(task_id: String, state: State<AppState>) -> Result<(), String> {
    state.wakeup_manager.delete_task(&task_id)
}
#[tauri::command]
async fn run_wakeup_task(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<WakeupTask, String> {
    state.wakeup_manager.run_task(&task_id).await
}
#[tauri::command]
fn get_gateway_config(state: State<AppState>) -> GatewayConfig {
    state.proxy_server.config()
}
#[tauri::command]
async fn update_gateway_config(
    config: GatewayConfig,
    state: State<'_, AppState>,
) -> Result<GatewayConfig, String> {
    state.proxy_server.update(config).await
}
#[tauri::command]
async fn toggle_gateway(state: State<'_, AppState>) -> Result<GatewayConfig, String> {
    state.proxy_server.toggle().await
}
#[tauri::command]
fn get_gateway_stats(state: State<AppState>) -> GatewayStats {
    state.proxy_server.stats()
}
#[tauri::command]
fn list_request_logs(state: State<AppState>) -> Vec<RequestLogEntry> {
    state.proxy_server.logs()
}
#[tauri::command]
fn clear_request_logs(state: State<AppState>) {
    state.proxy_server.clear_logs();
}
#[tauri::command]
fn get_app_settings(state: State<AppState>) -> AppSettings {
    state.settings.get()
}
#[tauri::command]
fn save_app_settings(settings: AppSettings, state: State<AppState>) -> Result<AppSettings, String> {
    let saved = state.settings.save(settings)?;
    state
        .account_manager
        .set_profile_dir(settings::expand_path(&saved.codex_home)?);
    Ok(saved)
}
#[tauri::command]
fn apply_codex_config(state: State<AppState>) -> Result<(), String> {
    state.settings.apply_codex_overrides()
}
#[tauri::command]
async fn list_codex_instances(state: State<'_, AppState>) -> Result<Vec<CodexInstance>, String> {
    Ok(state.instances.list().await)
}
#[tauri::command]
async fn save_codex_instance(
    instance: CodexInstance,
    state: State<'_, AppState>,
) -> Result<CodexInstance, String> {
    state.instances.save(instance).await
}
#[tauri::command]
async fn delete_codex_instance(
    instance_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.instances.delete(&instance_id).await
}
#[tauri::command]
async fn toggle_codex_instance(
    instance_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<CodexInstance>, String> {
    state
        .instances
        .toggle(&instance_id, &state.proxy_server.config())
        .await?;
    Ok(state.instances.list().await)
}
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .try_init();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let base = storage::data_dir().map_err(std::io::Error::other)?;
            let settings = Arc::new(
                SettingsManager::new(base.join("settings.json")).map_err(std::io::Error::other)?,
            );
            let account_manager = Arc::new(
                AccountManager::new(
                    settings::expand_path(&settings.get().codex_home)
                        .map_err(std::io::Error::other)?,
                )
                .map_err(std::io::Error::other)?,
            );
            let proxy_server = Arc::new(
                ProxyServer::new(account_manager.clone(), base.join("gateway.json"))
                    .map_err(std::io::Error::other)?,
            );
            let wakeup_manager = Arc::new(
                WakeupManager::new(account_manager.clone()).map_err(std::io::Error::other)?,
            );
            let instances = Arc::new(
                InstanceManager::new(
                    base.join("instances.json"),
                    account_manager.clone(),
                    settings.clone(),
                )
                .map_err(std::io::Error::other)?,
            );
            proxy_server.set_instances(instances.clone());
            if settings.get().start_gateway_on_launch {
                let server = proxy_server.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = server.start().await {
                        tracing::error!("{e}");
                    }
                });
            }
            wakeup_manager.clone().start_background_loop();
            app.manage(AppState {
                account_manager,
                proxy_server,
                wakeup_manager,
                settings,
                instances,
                oauth_lock: Default::default(),
            });
            let quit = MenuItem::with_id(app, "quit", "Quit CodexProxy", true, None::<&str>)?;
            let toggle = MenuItem::with_id(app, "toggle", "Show/Hide Window", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &quit])?;
            let mut tray =
                TrayIconBuilder::new()
                    .menu(&menu)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "quit" => app.exit(0),
                        "toggle" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = if w.is_visible().unwrap_or(false) {
                                    w.hide()
                                } else {
                                    w.show().and_then(|_| w.set_focus())
                                };
                            }
                        }
                        _ => {}
                    });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                if state.settings.get().close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_codex_accounts,
            get_active_codex_account,
            switch_codex_account,
            add_codex_account,
            delete_codex_account,
            import_codex_from_json,
            refresh_codex_quota,
            refresh_codex_token,
            start_oauth_login,
            list_wakeup_tasks,
            save_wakeup_task,
            delete_wakeup_task,
            run_wakeup_task,
            get_gateway_config,
            update_gateway_config,
            toggle_gateway,
            get_gateway_stats,
            list_request_logs,
            clear_request_logs,
            get_app_settings,
            save_app_settings,
            apply_codex_config,
            list_codex_instances,
            save_codex_instance,
            delete_codex_instance,
            toggle_codex_instance,
        ])
        .build(tauri::generate_context!())
        .expect("Failed to initialize CodexProxy")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<AppState>();
                tauri::async_runtime::block_on(async {
                    state.proxy_server.stop().await;
                    state.instances.stop_all().await;
                });
            }
        });
}
