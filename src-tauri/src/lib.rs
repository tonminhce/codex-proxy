pub mod models;
pub mod account;
pub mod proxy;
pub mod oauth;
pub mod wakeup;

use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, State,
};
use models::{CodexAccount, GatewayConfig};
use account::AccountManager;
use proxy::ProxyServer;
use wakeup::{WakeupManager, WakeupTask};

pub struct AppState {
    pub account_manager: Arc<AccountManager>,
    pub proxy_server: ProxyServer,
    pub gateway_config: Mutex<GatewayConfig>,
    pub wakeup_manager: Arc<WakeupManager>,
}

#[tauri::command]
fn list_codex_accounts(state: State<AppState>) -> Vec<CodexAccount> {
    state.account_manager.list()
}

#[tauri::command]
fn get_active_codex_account(state: State<AppState>) -> Option<CodexAccount> {
    state.account_manager.get_active()
}

#[tauri::command]
fn switch_codex_account(account_id: String, state: State<AppState>) -> Result<CodexAccount, String> {
    state.account_manager.switch_active(&account_id)
}

#[tauri::command]
fn add_codex_account(account: CodexAccount, state: State<AppState>) -> Result<(), String> {
    state.account_manager.add(account);
    Ok(())
}

#[tauri::command]
fn delete_codex_account(account_id: String, state: State<AppState>) -> Result<(), String> {
    state.account_manager.delete(&account_id);
    Ok(())
}

#[tauri::command]
fn import_codex_from_json(json_content: String, state: State<AppState>) -> Result<Vec<CodexAccount>, String> {
    state.account_manager.import_from_json(&json_content)
}

#[tauri::command]
async fn refresh_codex_quota(account_id: String, state: State<'_, AppState>) -> Result<CodexAccount, String> {
    state.account_manager.refresh_quota(&account_id).await
}

#[tauri::command]
async fn refresh_codex_token(account_id: String, state: State<'_, AppState>) -> Result<CodexAccount, String> {
    state.account_manager.refresh_token(&account_id).await
}

#[tauri::command]
async fn start_oauth_login(state: State<'_, AppState>) -> Result<CodexAccount, String> {
    oauth::perform_pkce_oauth_login(state.account_manager.clone()).await
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
async fn run_wakeup_task(task_id: String, state: State<'_, AppState>) -> Result<WakeupTask, String> {
    state.wakeup_manager.run_task(&task_id).await
}

#[tauri::command]
fn get_gateway_config(state: State<AppState>) -> GatewayConfig {
    state.gateway_config.lock().unwrap().clone()
}

#[tauri::command]
fn toggle_gateway(state: State<AppState>) -> bool {
    let mut config = state.gateway_config.lock().unwrap();
    if config.running {
        state.proxy_server.stop();
        config.running = false;
    } else {
        state.proxy_server.start();
        config.running = true;
    }
    config.running
}

pub fn run() {
    let account_manager = Arc::new(AccountManager::new());
    let proxy_server = ProxyServer::new("127.0.0.1".to_string(), 8080);
    let wakeup_manager = Arc::new(WakeupManager::new(account_manager.clone()));

    let app_state = AppState {
        account_manager,
        proxy_server,
        gateway_config: Mutex::new(GatewayConfig::default()),
        wakeup_manager: wakeup_manager.clone(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(app_state)
        .setup(|app| {
            // Start in-process proxy gateway inside async setup
            let state = app.state::<AppState>();
            state.proxy_server.start();

            // Start background loop for Wakeup tasks
            state.wakeup_manager.clone().start_background_loop();

            // Setup System Tray
            let quit_i = MenuItem::with_id(app, "quit", "Quit CodexProxy", true, None::<&str>)?;
            let toggle_i = MenuItem::with_id(app, "toggle", "Show/Hide Window", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "toggle" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = if window.is_visible().unwrap_or(false) {
                                window.hide()
                            } else {
                                window.show().and_then(|_| window.set_focus())
                            };
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
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
            toggle_gateway,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
