use crate::{
    models::{CodexAccount, CodexAuthMode, CodexQuota},
    storage,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

pub const CHATGPT_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
pub const OPENAI_OAUTH_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
pub const CODEX_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";

pub struct AccountManager {
    accounts: Mutex<Vec<CodexAccount>>,
    storage_path: PathBuf,
    profile_dir: Mutex<PathBuf>,
    refresh_lock: tokio::sync::Mutex<()>,
    client: reqwest::Client,
    usage_url: String,
    token_url: String,
}
impl AccountManager {
    pub fn new(profile_dir: PathBuf) -> Result<Self, String> {
        Self::with_paths(storage::data_dir()?.join("accounts.json"), profile_dir)
    }
    pub fn with_paths(storage_path: PathBuf, profile_dir: PathBuf) -> Result<Self, String> {
        let mut accounts: Vec<CodexAccount> = storage::read_or_default(&storage_path)?;
        accounts.retain(|a| !(a.id == "acc-default" && a.access_token.is_none()));
        Ok(Self {
            accounts: Mutex::new(accounts),
            storage_path,
            profile_dir: Mutex::new(profile_dir),
            refresh_lock: tokio::sync::Mutex::new(()),
            usage_url: CHATGPT_USAGE_URL.into(),
            token_url: OPENAI_OAUTH_TOKEN_URL.into(),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(20))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|e| e.to_string())?,
        })
    }
    #[cfg(test)]
    pub fn with_storage(storage_path: PathBuf) -> Self {
        let profile = storage_path.parent().unwrap().join("isolated-codex");
        Self::with_paths(storage_path, profile).unwrap()
    }
    pub fn set_profile_dir(&self, path: PathBuf) {
        *self.profile_dir.lock().unwrap() = path;
    }
    pub fn list(&self) -> Vec<CodexAccount> {
        self.accounts.lock().unwrap().clone()
    }
    pub fn get(&self, id: &str) -> Result<CodexAccount, String> {
        self.accounts
            .lock()
            .unwrap()
            .iter()
            .find(|a| a.id == id)
            .cloned()
            .ok_or("Account not found".into())
    }
    pub fn get_active(&self) -> Option<CodexAccount> {
        self.list().into_iter().find(|a| a.is_active)
    }
    pub fn redacted(mut account: CodexAccount) -> CodexAccount {
        account.access_token = None;
        account.refresh_token = None;
        account.id_token = None;
        account
    }
    fn commit(
        &self,
        current: &mut Vec<CodexAccount>,
        next: Vec<CodexAccount>,
    ) -> Result<(), String> {
        storage::write_json(&self.storage_path, &next)?;
        *current = next;
        Ok(())
    }
    pub fn switch_active(&self, account_id: &str) -> Result<CodexAccount, String> {
        let mut lock = self.accounts.lock().unwrap();
        let mut next = lock.clone();
        let target = next
            .iter_mut()
            .find(|a| a.id == account_id)
            .ok_or("Account not found")?;
        target.last_used_at = Some(chrono::Utc::now().timestamp_millis());
        target.is_active = true;
        let result = target.clone();
        for a in &mut next {
            a.is_active = a.id == account_id;
        }
        // Only an explicit switch writes the user's Codex auth file.
        let profile = self.profile_dir.lock().unwrap();
        let auth_path = profile.join("auth.json");
        let previous = match std::fs::read(&auth_path) {
            Ok(bytes) => Some(bytes),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.to_string()),
        };
        Self::sync_profile_takeover(&result, &profile)?;
        if let Err(error) = self.commit(&mut lock, next) {
            let rollback = match previous {
                Some(bytes) => storage::write_private(&auth_path, &bytes),
                None => std::fs::remove_file(&auth_path).map_err(|e| e.to_string()),
            };
            return Err(if rollback.is_err() {
                format!("{error}; profile rollback also failed")
            } else {
                error
            });
        }
        Ok(result)
    }
    pub fn add(&self, mut account: CodexAccount) -> Result<(), String> {
        validate_account(&account)?;
        let mut lock = self.accounts.lock().unwrap();
        let mut next = lock.clone();
        if let Some(existing) = next.iter_mut().find(|a| a.id == account.id) {
            account.is_active = existing.is_active;
            account.created_at = existing.created_at;
            *existing = account;
        } else {
            account.is_active = !next.iter().any(|a| a.is_active);
            next.push(account);
        }
        self.commit(&mut lock, next)
    }
    pub fn delete(&self, id: &str) -> Result<(), String> {
        let mut lock = self.accounts.lock().unwrap();
        let mut next = lock.clone();
        next.retain(|a| a.id != id);
        self.commit(&mut lock, next)
    }
    pub fn import_from_json(&self, content: &str) -> Result<Vec<CodexAccount>, String> {
        let trimmed = content.trim();
        let text = if trimmed.starts_with("\u{60}\u{60}\u{60}") {
            trimmed
                .trim_start_matches("\u{60}")
                .strip_prefix("json")
                .unwrap_or(trimmed.trim_start_matches("\u{60}"))
                .trim_end()
                .trim_end_matches("\u{60}")
                .trim()
        } else {
            trimmed
        };
        let value: Value = serde_json::from_str(&clean_json_trailing_commas(text))
            .map_err(|_| "Invalid account JSON")?;
        let items = match value {
            Value::Array(v) => v,
            Value::Object(_) => vec![value],
            _ => return Err("Expected account object or array".into()),
        };
        if items.is_empty() {
            return Err("No accounts supplied".into());
        }
        let imported = items
            .iter()
            .map(parse_account_from_value)
            .collect::<Result<Vec<_>, _>>()?;
        let mut lock = self.accounts.lock().unwrap();
        let mut next = lock.clone();
        let mut ids = Vec::new();
        for mut account in imported {
            validate_account(&account)?;
            if let Some(existing) = next.iter_mut().find(|a| a.id == account.id) {
                account.is_active = existing.is_active;
                account.created_at = existing.created_at;
                account.refresh_token = account.refresh_token.or(existing.refresh_token.clone());
                account.id_token = account.id_token.or(existing.id_token.clone());
                account.quota = existing.quota.clone();
                *existing = account.clone();
            } else {
                account.is_active = next.is_empty();
                next.push(account.clone());
            }
            ids.push(account.id);
        }
        let result = next
            .iter()
            .filter(|a| ids.contains(&a.id))
            .cloned()
            .collect();
        self.commit(&mut lock, next)?;
        Ok(result)
    }
    pub async fn ready_account(&self, id: &str) -> Result<CodexAccount, String> {
        let target = self.get(id)?;
        if target.auth_mode == CodexAuthMode::OAuth && token_expired(&target) {
            self.refresh_token(id).await
        } else {
            Ok(target)
        }
    }
    pub async fn refresh_quota(&self, id: &str) -> Result<CodexAccount, String> {
        let mut target = self.ready_account(id).await?;
        if target.auth_mode != CodexAuthMode::OAuth {
            return Err("Quota is available only for ChatGPT OAuth accounts".into());
        }
        let mut response = self.quota_request(&target).await?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            target = self
                .refresh_after_rejection(id, target.access_token.as_deref().unwrap_or(""))
                .await?;
            response = self.quota_request(&target).await?;
        }
        if !response.status().is_success() {
            return Err(format!(
                "Quota request failed (HTTP {})",
                response.status().as_u16()
            ));
        }
        let value: Value = response
            .json()
            .await
            .map_err(|_| "Invalid quota response")?;
        let mut lock = self.accounts.lock().unwrap();
        let mut next = lock.clone();
        let account = next
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or("Account removed during quota refresh")?;
        if let Some(plan) = value["plan_type"].as_str() {
            account.plan_type = plan.into();
        }
        apply_quota(&mut account.quota, &value);
        account.is_cooldown = false;
        let result = account.clone();
        self.commit(&mut lock, next)?;
        Ok(result)
    }
    async fn quota_request(&self, account: &CodexAccount) -> Result<reqwest::Response, String> {
        self.client
            .get(&self.usage_url)
            .bearer_auth(
                account
                    .access_token
                    .as_deref()
                    .ok_or("Missing access token")?,
            )
            .header("ChatGPT-Account-Id", &account.id)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|_| "Quota service unavailable".into())
    }
    pub async fn refresh_token(&self, id: &str) -> Result<CodexAccount, String> {
        let before = self.get(id)?.access_token;
        self.refresh_after_rejection(id, before.as_deref().unwrap_or(""))
            .await
    }
    pub async fn refresh_after_rejection(
        &self,
        id: &str,
        rejected_token: &str,
    ) -> Result<CodexAccount, String> {
        // Refresh tokens rotate. Serialize and re-check before reusing one.
        let _guard = self.refresh_lock.lock().await;
        let target = self.get(id)?;
        if target.access_token.as_deref().unwrap_or("") != rejected_token {
            return Ok(target);
        }
        if target.auth_mode != CodexAuthMode::OAuth {
            return Err("Only OAuth accounts can refresh tokens".into());
        }
        let refresh = target
            .refresh_token
            .as_deref()
            .ok_or("No refresh token; sign in again")?;
        let response = self
            .client
            .post(&self.token_url)
            .form(&[
                ("client_id", CODEX_CLIENT_ID),
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh),
            ])
            .send()
            .await
            .map_err(|_| "Token service unavailable")?;
        if !response.status().is_success() {
            return Err(format!(
                "Token refresh failed (HTTP {}); sign in again",
                response.status().as_u16()
            ));
        }
        let value: Value = response
            .json()
            .await
            .map_err(|_| "Invalid token response")?;
        let access =
            nonempty(&value, &["access_token"]).ok_or("Token response is missing access_token")?;
        let mut lock = self.accounts.lock().unwrap();
        let mut next = lock.clone();
        let account = next
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or("Account removed during refresh")?;
        account.access_token = Some(access);
        if let Some(v) = nonempty(&value, &["refresh_token"]) {
            account.refresh_token = Some(v);
        }
        if let Some(v) = nonempty(&value, &["id_token"]) {
            account.id_token = Some(v);
        }
        let result = account.clone();
        self.commit(&mut lock, next)?;
        let profile = self.profile_dir.lock().unwrap();
        let current = std::fs::read(profile.join("auth.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok());
        if result.is_active
            && current
                .as_ref()
                .and_then(|v| v["tokens"]["account_id"].as_str())
                == Some(id)
        {
            Self::sync_profile_takeover(&result, &profile)?;
        }
        Ok(result)
    }
    pub fn sync_profile_takeover(target: &CodexAccount, profile: &Path) -> Result<(), String> {
        let token = target
            .access_token
            .as_deref()
            .filter(|v| !v.is_empty())
            .ok_or("Missing access token")?;
        let payload = if target.auth_mode == CodexAuthMode::ApiKey {
            json!({"auth_mode":"apikey", "OPENAI_API_KEY":token})
        } else {
            let id_token = target.id_token.as_deref().filter(|v| !v.is_empty()).ok_or(
                "This account has no ID token; sign in again before switching the Codex profile",
            )?;
            json!({"auth_mode":"chatgpt", "OPENAI_API_KEY":null, "tokens":{
                "id_token":id_token, "access_token":token, "refresh_token":target.refresh_token,
                "account_id":target.id }, "last_refresh":chrono::Utc::now().to_rfc3339()})
        };
        let auth = profile.join("auth.json");
        let backup = profile.join("auth.json.codex-proxy-backup");
        if auth.exists() && !backup.exists() {
            storage::write_private(&backup, &std::fs::read(&auth).map_err(|e| e.to_string())?)?;
        }
        storage::write_json(&auth, &payload)
    }
}
fn validate_account(account: &CodexAccount) -> Result<(), String> {
    if account.id.trim().is_empty()
        || account
            .access_token
            .as_deref()
            .is_none_or(|v| v.trim().is_empty())
    {
        return Err("Account ID and access token/API key are required".into());
    }
    if account.auth_mode == CodexAuthMode::Pat {
        return Err("Personal access tokens are not a supported Codex authentication mode".into());
    }
    if account.auth_mode == CodexAuthMode::OAuth && account.api_base_url.is_some() {
        return Err("OAuth credentials may only be sent to the official Codex backend".into());
    }
    if let Some(base) = &account.api_base_url {
        validate_base_url(base)?;
    }
    Ok(())
}
pub fn validate_base_url(base: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(base).map_err(|_| "Invalid upstream URL")?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if url.host_str().is_none()
        || (url.scheme() != "https" && !(url.scheme() == "http" && loopback))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Upstream URL must use HTTPS (HTTP only on loopback), without credentials, query or fragment".into());
    }
    Ok(())
}
fn token_expired(account: &CodexAccount) -> bool {
    account
        .access_token
        .as_deref()
        .and_then(decode_jwt_payload_value)
        .and_then(|v| v["exp"].as_i64())
        .is_some_and(|exp| exp <= chrono::Utc::now().timestamp() + 60)
}
pub fn apply_quota(quota: &mut CodexQuota, value: &Value) {
    for (window, key) in [
        (&mut quota.hourly, "primary_window"),
        (&mut quota.weekly, "secondary_window"),
    ] {
        if let Some(used) = value["rate_limit"][key]["used_percent"].as_f64() {
            window.used_percent = used.ceil().clamp(0.0, 100.0) as u32;
            window.remaining_percent = 100 - window.used_percent;
            window.reset_minutes_remaining = value["rate_limit"][key]["reset_after_seconds"]
                .as_u64()
                .map(|s| s.div_ceil(60).min(u32::MAX as u64) as u32);
        }
    }
    quota.reset_credits_remaining = value["rate_limit_reset_credits"]["available_count"]
        .as_u64()
        .unwrap_or(0)
        .min(u32::MAX as u64) as u32;
    quota.updated_at = chrono::Utc::now().timestamp_millis();
}
pub fn clean_json_trailing_commas(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    let (mut in_string, mut escape) = (false, false);
    while let Some(ch) = chars.next() {
        if in_string {
            out.push(ch);
            if escape {
                escape = false;
            } else if ch == '\\' {
                escape = true;
            } else if ch == '"' {
                in_string = false;
            }
        } else if ch == '"' {
            in_string = true;
            out.push(ch);
        } else if ch != ','
            || !matches!(chars.clone().find(|c| !c.is_whitespace()), Some(']' | '}'))
        {
            out.push(ch);
        }
    }
    out
}
pub fn decode_jwt_payload_value(token: &str) -> Option<Value> {
    let payload = token.split('.').nth(1)?.trim_end_matches('=');
    serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).ok()?).ok()
}
fn nonempty(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| {
        value[*k]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .map(str::to_owned)
    })
}
fn parse_account_from_value(item: &Value) -> Result<CodexAccount, String> {
    let tokens = item.get("tokens").unwrap_or(item);
    let key = nonempty(item, &["OPENAI_API_KEY", "api_key", "apiKey"]);
    let mode = if key.is_some() || matches!(item["authMode"].as_str(), Some("apikey")) {
        CodexAuthMode::ApiKey
    } else {
        CodexAuthMode::OAuth
    };
    let access = key
        .or_else(|| nonempty(tokens, &["access_token", "accessToken", "token"]))
        .ok_or("Account entry is missing access token/API key")?;
    let id_token = nonempty(tokens, &["id_token", "idToken"]);
    let access_claims = decode_jwt_payload_value(&access).unwrap_or(Value::Null);
    let identity = id_token
        .as_deref()
        .and_then(decode_jwt_payload_value)
        .unwrap_or(Value::Null);
    let account_id = nonempty(
        tokens,
        &["account_id", "accountId", "chatgpt_account_id", "id"],
    )
    .or_else(|| {
        nonempty(
            &access_claims["https://api.openai.com/auth"],
            &["chatgpt_account_id"],
        )
    })
    .or_else(|| {
        nonempty(
            &identity["https://api.openai.com/auth"],
            &["chatgpt_account_id"],
        )
    })
    .unwrap_or_else(|| {
        use sha2::{Digest, Sha256};
        format!("acc-{:x}", Sha256::digest(access.as_bytes()))
    });
    Ok(CodexAccount {
        id: account_id,
        email: nonempty(item, &["email"])
            .or_else(|| nonempty(&identity, &["email"]))
            .or_else(|| nonempty(&access_claims["https://api.openai.com/profile"], &["email"]))
            .unwrap_or_else(|| "Local account".into()),
        name: nonempty(item, &["name"]).or_else(|| nonempty(&identity, &["name"])),
        auth_mode: mode,
        plan_type: nonempty(item, &["plan_type", "planType", "plan"])
            .or_else(|| {
                nonempty(
                    &access_claims["https://api.openai.com/auth"],
                    &["chatgpt_plan_type"],
                )
            })
            .unwrap_or_else(|| "unknown".into()),
        is_active: false,
        is_cooldown: false,
        quota: CodexQuota::default(),
        created_at: chrono::Utc::now().timestamp_millis(),
        last_used_at: None,
        access_token: Some(access),
        refresh_token: nonempty(tokens, &["refresh_token", "refreshToken"]),
        id_token,
        api_base_url: nonempty(item, &["api_base_url", "apiBaseUrl"]),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn manager() -> (tempfile::TempDir, AccountManager) {
        let dir = tempfile::tempdir().unwrap();
        let manager = AccountManager::with_storage(dir.path().join("accounts.json"));
        (dir, manager)
    }
    #[test]
    fn empty_storage_and_import_never_touches_profile() {
        let (dir, mgr) = manager();
        assert!(mgr.list().is_empty());
        mgr.import_from_json(r#"{"tokens":{"account_id":"test","access_token":"synthetic","id_token":"synthetic-id","refresh_token":"synthetic-refresh"}}"#).unwrap();
        assert!(!dir.path().join("isolated-codex/auth.json").exists());
        assert!(mgr.get_active().is_some());
        mgr.switch_active("test").unwrap();
        let auth: Value =
            storage::read_or_default(&dir.path().join("isolated-codex/auth.json")).unwrap();
        assert_eq!(auth["tokens"]["id_token"], "synthetic-id");
        assert_eq!(auth["auth_mode"], "chatgpt");
    }
    #[test]
    fn invalid_switch_does_not_clear_active_or_mix_identity() {
        let (_dir, mgr) = manager();
        mgr.import_from_json(r#"{"account_id":"a","access_token":"synthetic"}"#)
            .unwrap();
        assert!(mgr.switch_active("missing").is_err());
        assert!(mgr.switch_active("a").is_err());
        assert_eq!(mgr.get_active().unwrap().id, "a");
    }
    #[test]
    fn batch_is_atomic_and_distinct_accounts_can_share_email() {
        let (_dir, mgr) = manager();
        assert!(mgr
            .import_from_json(r#"[{"apiKey":"synthetic"},{}]"#)
            .is_err());
        assert!(mgr.list().is_empty());
        mgr.import_from_json(r#"[{"account_id":"a","email":"test@example.invalid","access_token":"synthetic-a"},{"account_id":"b","email":"test@example.invalid","access_token":"synthetic-b"},]"#).unwrap();
        assert_eq!(mgr.list().len(), 2);
    }
    #[test]
    fn api_key_import_redaction_and_upsert() {
        let (_dir, mgr) = manager();
        let content = r#"{"OPENAI_API_KEY":"synthetic-key"}"#;
        let account = mgr.import_from_json(content).unwrap().remove(0);
        mgr.import_from_json(content).unwrap();
        assert_eq!(mgr.list().len(), 1);
        assert_eq!(account.auth_mode, CodexAuthMode::ApiKey);
        assert!(AccountManager::redacted(account).access_token.is_none());
    }
    #[test]
    fn trailing_commas_leave_strings_untouched() {
        assert_eq!(
            clean_json_trailing_commas(r#"{"text":",}",}"#),
            r#"{"text":",}"}"#
        );
    }
    #[test]
    fn fractional_quota_is_clamped_and_reset_rounded_up() {
        let mut quota = CodexQuota::default();
        apply_quota(
            &mut quota,
            &json!({"rate_limit":{"primary_window":{"used_percent":12.5,"reset_after_seconds":61},"secondary_window":{"used_percent":110}}}),
        );
        assert_eq!(quota.hourly.remaining_percent, 87);
        assert_eq!(quota.hourly.reset_minutes_remaining, Some(2));
        assert_eq!(quota.weekly.remaining_percent, 0);
    }
    #[test]
    fn credential_destination_validation() {
        assert!(validate_base_url("https://api.openai.com/v1").is_ok());
        assert!(validate_base_url("http://127.0.0.1:1234/v1").is_ok());
        assert!(validate_base_url("http://example.com/v1").is_err());
        let (_dir, mgr) = manager();
        assert!(mgr
            .import_from_json(r#"{"access_token":"synthetic","apiBaseUrl":"https://example.com"}"#)
            .is_err());
    }
    #[test]
    fn persistence_failure_leaves_memory_unchanged() {
        let (dir, mgr) = manager();
        std::fs::create_dir(dir.path().join("accounts.json")).unwrap();
        assert!(mgr.import_from_json(r#"{"apiKey":"synthetic"}"#).is_err());
        assert!(mgr.list().is_empty());
    }

    #[tokio::test]
    async fn concurrent_refresh_rotates_once_and_updates_the_correct_profile() {
        use axum::{routing::post, Router};
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };
        let (dir, mut mgr) = manager();
        let calls = Arc::new(AtomicUsize::new(0));
        let count = calls.clone();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        mgr.token_url = format!("http://{}/token", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener,Router::new().route("/token",post(move || {let count=count.clone();async move {
                count.fetch_add(1,Ordering::SeqCst);
                axum::Json(json!({"access_token":"rotated-access","refresh_token":"rotated-refresh","id_token":"rotated-identity"}))
            }}))).await.unwrap();
        });
        mgr.import_from_json(r#"{"account_id":"test","access_token":"synthetic","refresh_token":"synthetic-refresh","id_token":"synthetic-id"}"#).unwrap();
        mgr.switch_active("test").unwrap();
        let (a, b) = tokio::join!(
            mgr.refresh_after_rejection("test", "synthetic"),
            mgr.refresh_after_rejection("test", "synthetic")
        );
        assert_eq!(a.unwrap().access_token.as_deref(), Some("rotated-access"));
        assert_eq!(b.unwrap().id_token.as_deref(), Some("rotated-identity"));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let auth: Value =
            storage::read_or_default(&dir.path().join("isolated-codex/auth.json")).unwrap();
        assert_eq!(auth["tokens"]["id_token"], "rotated-identity");
        assert_eq!(auth["tokens"]["refresh_token"], "rotated-refresh");
        task.abort();
    }

    #[tokio::test]
    async fn quota_request_sends_account_header_and_applies_live_values() {
        use axum::{http::HeaderMap, routing::get, Router};
        let (_dir, mut mgr) = manager();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        mgr.usage_url = format!("http://{}/usage", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener,Router::new().route("/usage",get(|headers:HeaderMap|async move {
                assert_eq!(headers["chatgpt-account-id"],"test");
                assert_eq!(headers["authorization"],"Bearer synthetic");
                axum::Json(json!({"plan_type":"plus","rate_limit":{"primary_window":{"used_percent":25.2,"reset_after_seconds":61},"secondary_window":{"used_percent":10}}}))
            }))).await.unwrap();
        });
        mgr.import_from_json(r#"{"account_id":"test","access_token":"synthetic"}"#)
            .unwrap();
        let result = mgr.refresh_quota("test").await.unwrap();
        assert_eq!(result.quota.hourly.remaining_percent, 74);
        assert_eq!(result.quota.weekly.remaining_percent, 90);
        assert_eq!(result.plan_type, "plus");
        task.abort();
    }
}
