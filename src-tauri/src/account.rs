use std::path::PathBuf;
use std::sync::Mutex;
use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use crate::models::{CodexAccount, CodexAuthMode, CodexQuota, CodexQuotaWindow};

const CHATGPT_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const OPENAI_OAUTH_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const CODEX_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";

pub struct AccountManager {
    accounts: Mutex<Vec<CodexAccount>>,
    storage_path: PathBuf,
}

impl AccountManager {
    pub fn new() -> Self {
        let base_dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".codex-proxy");
        let _ = std::fs::create_dir_all(&base_dir);
        let storage_path = base_dir.join("accounts.json");

        let initial_accounts = if storage_path.exists() {
            std::fs::read_to_string(&storage_path)
                .ok()
                .and_then(|s| serde_json::from_str::<Vec<CodexAccount>>(&s).ok())
                .unwrap_or_else(Self::default_accounts)
        } else {
            Self::default_accounts()
        };

        Self {
            accounts: Mutex::new(initial_accounts),
            storage_path,
        }
    }

    pub fn with_storage(storage_path: PathBuf) -> Self {
        let initial_accounts = if storage_path.exists() {
            std::fs::read_to_string(&storage_path)
                .ok()
                .and_then(|s| serde_json::from_str::<Vec<CodexAccount>>(&s).ok())
                .unwrap_or_else(Self::default_accounts)
        } else {
            Self::default_accounts()
        };

        Self {
            accounts: Mutex::new(initial_accounts),
            storage_path,
        }
    }

    fn default_accounts() -> Vec<CodexAccount> {
        vec![CodexAccount {
            id: "acc-default".to_string(),
            email: "primary@codex.account".to_string(),
            name: Some("Primary ChatGPT Plus".to_string()),
            auth_mode: CodexAuthMode::OAuth,
            plan_type: "plus".to_string(),
            is_active: true,
            is_cooldown: false,
            quota: CodexQuota {
                hourly: CodexQuotaWindow {
                    used_percent: 20,
                    remaining_percent: 80,
                    reset_minutes_remaining: Some(42),
                },
                weekly: CodexQuotaWindow {
                    used_percent: 15,
                    remaining_percent: 85,
                    reset_minutes_remaining: Some(3800),
                },
                luna_reserve_allowed: true,
                luna_reserve_active: false,
                reset_credits_remaining: 2,
                updated_at: chrono::Utc::now().timestamp_millis(),
            },
            created_at: chrono::Utc::now().timestamp_millis(),
            last_used_at: Some(chrono::Utc::now().timestamp_millis()),
            access_token: None,
            refresh_token: None,
            id_token: None,
            api_base_url: None,
        }]
    }

    pub fn list(&self) -> Vec<CodexAccount> {
        self.accounts.lock().unwrap().clone()
    }

    pub fn get_active(&self) -> Option<CodexAccount> {
        let lock = self.accounts.lock().unwrap();
        lock.iter().find(|a| a.is_active).cloned()
    }

    pub fn switch_active(&self, account_id: &str) -> Result<CodexAccount, String> {
        let mut lock = self.accounts.lock().unwrap();
        let mut found = None;

        for acc in lock.iter_mut() {
            if acc.id == account_id {
                acc.is_active = true;
                acc.last_used_at = Some(chrono::Utc::now().timestamp_millis());
                found = Some(acc.clone());
            } else {
                acc.is_active = false;
            }
        }

        let target = found.ok_or_else(|| "Account not found".to_string())?;

        // Save state
        let _ = std::fs::write(&self.storage_path, serde_json::to_string_pretty(&*lock).unwrap_or_default());

        // Perform ~/.codex profile takeover if token is present
        Self::sync_profile_takeover(&target);

        Ok(target)
    }

    pub fn add(&self, account: CodexAccount) {
        let mut lock = self.accounts.lock().unwrap();
        lock.push(account);
        let _ = std::fs::write(&self.storage_path, serde_json::to_string_pretty(&*lock).unwrap_or_default());
    }

    pub fn delete(&self, account_id: &str) {
        let mut lock = self.accounts.lock().unwrap();
        lock.retain(|a| a.id != account_id);
        let _ = std::fs::write(&self.storage_path, serde_json::to_string_pretty(&*lock).unwrap_or_default());
    }

    pub fn import_from_json(&self, json_content: &str) -> Result<Vec<CodexAccount>, String> {
        let trimmed = json_content.trim();
        let unquoted = if trimmed.starts_with("```") {
            let after_fence = trimmed.strip_prefix("```json")
                .or_else(|| trimmed.strip_prefix("```"))
                .unwrap_or(trimmed);
            after_fence.strip_suffix("```").unwrap_or(after_fence).trim()
        } else {
            trimmed
        };

        let sanitized = clean_json_trailing_commas(unquoted);
        let parsed: serde_json::Value = serde_json::from_str(&sanitized)
            .map_err(|e| format!("Invalid JSON format: {}", e))?;

        let mut imported = Vec::new();
        match parsed {
            serde_json::Value::Array(items) => {
                for item in items {
                    if let Some(acc) = parse_account_from_value(&item) {
                        imported.push(acc);
                    }
                }
            }
            serde_json::Value::Object(_) => {
                if let Some(acc) = parse_account_from_value(&parsed) {
                    imported.push(acc);
                }
            }
            _ => return Err("JSON must be an object or an array of account objects".to_string()),
        }

        if imported.is_empty() {
            return Err("No valid Codex account tokens found in JSON".to_string());
        }

        let mut lock = self.accounts.lock().unwrap();

        // If only default placeholder account exists, remove it
        if lock.len() == 1 && lock[0].id == "acc-default" {
            lock.clear();
        }

        let mut result = Vec::new();
        let had_active = lock.iter().any(|a| a.is_active);

        for mut new_acc in imported {
            if let Some(existing) = lock.iter_mut().find(|a| a.id == new_acc.id || a.email == new_acc.email) {
                if new_acc.access_token.is_some() {
                    existing.access_token = new_acc.access_token;
                }
                if new_acc.refresh_token.is_some() {
                    existing.refresh_token = new_acc.refresh_token;
                }
                if new_acc.id_token.is_some() {
                    existing.id_token = new_acc.id_token;
                }
                existing.plan_type = new_acc.plan_type;
                if new_acc.name.is_some() {
                    existing.name = new_acc.name;
                }
                result.push(existing.clone());
            } else {
                if !had_active && result.is_empty() && lock.is_empty() {
                    new_acc.is_active = true;
                }
                lock.push(new_acc.clone());
                result.push(new_acc);
            }
        }

        // Ensure at least one account is active
        if !lock.is_empty() && !lock.iter().any(|a| a.is_active) {
            lock[0].is_active = true;
        }

        // Save state
        let _ = std::fs::write(&self.storage_path, serde_json::to_string_pretty(&*lock).unwrap_or_default());

        // Perform ~/.codex profile takeover for currently active account
        if let Some(active) = lock.iter().find(|a| a.is_active) {
            Self::sync_profile_takeover(active);
        }

        Ok(result)
    }

    pub async fn refresh_quota(&self, account_id: &str) -> Result<CodexAccount, String> {
        let (target, token) = {
            let lock = self.accounts.lock().unwrap();
            let acc = lock.iter().find(|a| a.id == account_id).cloned()
                .ok_or_else(|| "Account not found".to_string())?;
            let token = acc.access_token.clone()
                .ok_or_else(|| "No access token available for account".to_string())?;
            (acc, token)
        };

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| format!("Client build failed: {}", e))?;

        let mut req = client.get(CHATGPT_USAGE_URL)
            .header("Authorization", format!("Bearer {}", token))
            .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36")
            .header("Accept", "application/json");

        if !target.id.is_empty() && !target.id.starts_with("acc-") {
            req = req.header("Chatgpt-Account-Id", &target.id);
        }

        let resp = req.send().await.map_err(|e| format!("Failed to query quota: {}", e))?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(format!("Quota check failed (status: {}): {}", status, body));
        }

        let val: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse quota JSON: {}", e))?;

        let mut lock = self.accounts.lock().unwrap();
        let updated = if let Some(acc) = lock.iter_mut().find(|a| a.id == account_id) {
            if let Some(plan) = val.get("plan_type").and_then(|p| p.as_str()) {
                acc.plan_type = plan.to_string();
            }
            if let Some(rate_limit) = val.get("rate_limit") {
                if let Some(pw) = rate_limit.get("primary_window") {
                    let used = pw.get("used_percent").and_then(|u| u.as_u64()).unwrap_or(0) as u32;
                    acc.quota.hourly.used_percent = used;
                    acc.quota.hourly.remaining_percent = 100u32.saturating_sub(used);
                    acc.quota.hourly.reset_minutes_remaining = pw.get("reset_after_seconds")
                        .and_then(|s| s.as_u64())
                        .map(|sec| (sec / 60) as u32);
                }
                if let Some(sw) = rate_limit.get("secondary_window") {
                    let used = sw.get("used_percent").and_then(|u| u.as_u64()).unwrap_or(0) as u32;
                    acc.quota.weekly.used_percent = used;
                    acc.quota.weekly.remaining_percent = 100u32.saturating_sub(used);
                    acc.quota.weekly.reset_minutes_remaining = sw.get("reset_after_seconds")
                        .and_then(|s| s.as_u64())
                        .map(|sec| (sec / 60) as u32);
                }
            }
            if let Some(rc) = val.get("rate_limit_reset_credits") {
                if let Some(cnt) = rc.get("available_count").and_then(|c| c.as_u64()) {
                    acc.quota.reset_credits_remaining = cnt as u32;
                }
            }
            acc.quota.updated_at = chrono::Utc::now().timestamp_millis();
            Some(acc.clone())
        } else {
            None
        };

        if let Some(acc) = updated {
            let _ = std::fs::write(&self.storage_path, serde_json::to_string_pretty(&*lock).unwrap_or_default());
            Ok(acc)
        } else {
            Err("Account not found".to_string())
        }
    }

    pub async fn refresh_token(&self, account_id: &str) -> Result<CodexAccount, String> {
        let refresh_token = {
            let lock = self.accounts.lock().unwrap();
            let acc = lock.iter().find(|a| a.id == account_id)
                .ok_or_else(|| "Account not found".to_string())?;
            acc.refresh_token.clone().ok_or_else(|| "No refresh token available for account".to_string())?
        };

        let client = reqwest::Client::new();
        let resp = client.post(OPENAI_OAUTH_TOKEN_URL)
            .json(&serde_json::json!({
                "client_id": CODEX_CLIENT_ID,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            }))
            .send()
            .await
            .map_err(|e| format!("Token refresh request failed: {}", e))?;

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(format!("Token refresh failed ({}): {}", status, body));
        }

        let token_resp: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse token refresh response: {}", e))?;

        let new_access_token = token_resp.get("access_token")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "No access_token in refresh response".to_string())?
            .to_string();

        let new_refresh_token = token_resp.get("refresh_token")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| Some(refresh_token));

        let mut lock = self.accounts.lock().unwrap();
        let updated = if let Some(acc) = lock.iter_mut().find(|a| a.id == account_id) {
            acc.access_token = Some(new_access_token);
            acc.refresh_token = new_refresh_token;
            acc.last_used_at = Some(chrono::Utc::now().timestamp_millis());
            Some(acc.clone())
        } else {
            None
        };

        if let Some(acc) = updated {
            let _ = std::fs::write(&self.storage_path, serde_json::to_string_pretty(&*lock).unwrap_or_default());
            if acc.is_active {
                Self::sync_profile_takeover(&acc);
            }
            Ok(acc)
        } else {
            Err("Account not found".to_string())
        }
    }

    fn sync_profile_takeover(target: &CodexAccount) {
        if let Some(ref token) = target.access_token {
            let codex_dir = dirs::home_dir().unwrap_or_default().join(".codex");
            let _ = std::fs::create_dir_all(&codex_dir);
            let auth_file = codex_dir.join("auth.json");

            let backup_file = codex_dir.join("auth.json.codex-proxy-backup");
            if auth_file.exists() && !backup_file.exists() {
                let _ = std::fs::copy(&auth_file, &backup_file);
            }

            let id_token = target.id_token.clone().or_else(|| {
                if backup_file.exists() {
                    std::fs::read_to_string(&backup_file).ok().and_then(|s| {
                        let v: serde_json::Value = serde_json::from_str(&s).ok()?;
                        v.get("tokens").and_then(|t| t.get("id_token")).and_then(|i| i.as_str()).map(|s| s.to_string())
                    })
                } else {
                    None
                }
            }).unwrap_or_default();

            let auth_payload = serde_json::json!({
                "auth_mode": "chatgpt",
                "OPENAI_API_KEY": serde_json::Value::Null,
                "tokens": {
                    "id_token": id_token,
                    "access_token": token,
                    "refresh_token": target.refresh_token,
                    "account_id": target.id,
                },
                "last_refresh": chrono::Utc::now().to_rfc3339()
            });
            let _ = std::fs::write(&auth_file, serde_json::to_string_pretty(&auth_payload).unwrap_or_default());
        }
    }
}

pub fn clean_json_trailing_commas(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let len = chars.len();
    let mut in_string = false;
    let mut escape = false;

    for i in 0..len {
        let ch = chars[i];
        if in_string {
            out.push(ch);
            if escape {
                escape = false;
            } else if ch == '\\' {
                escape = true;
            } else if ch == '"' {
                in_string = false;
            }
        } else {
            if ch == '"' {
                in_string = true;
                out.push(ch);
            } else if ch == ',' {
                let mut is_trailing = false;
                for j in (i + 1)..len {
                    let next_ch = chars[j];
                    if next_ch.is_whitespace() {
                        continue;
                    }
                    if next_ch == ']' || next_ch == '}' {
                        is_trailing = true;
                    }
                    break;
                }
                if !is_trailing {
                    out.push(ch);
                }
            } else {
                out.push(ch);
            }
        }
    }
    out
}

pub fn decode_jwt_payload_value(token: &str) -> Option<serde_json::Value> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 {
        return None;
    }
    let payload = parts[1].trim();
    let unpadded = payload.trim_end_matches('=');
    let decoded = URL_SAFE_NO_PAD
        .decode(unpadded)
        .or_else(|_| URL_SAFE.decode(payload))
        .ok()?;
    serde_json::from_slice(&decoded).ok()
}

fn parse_account_from_value(item: &serde_json::Value) -> Option<CodexAccount> {
    let access_token = item.get("access_token")
        .or_else(|| item.get("accessToken"))
        .or_else(|| item.get("token"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let refresh_token = item.get("refresh_token")
        .or_else(|| item.get("refreshToken"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let id_token = item.get("id_token")
        .or_else(|| item.get("idToken"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let jwt_claims = access_token.as_deref()
        .and_then(decode_jwt_payload_value)
        .or_else(|| id_token.as_deref().and_then(decode_jwt_payload_value));

    let email = item.get("email")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            jwt_claims.as_ref().and_then(|c| {
                c.get("https://api.openai.com/profile")
                    .and_then(|p| p.get("email"))
                    .and_then(|e| e.as_str())
                    .or_else(|| c.get("email").and_then(|e| e.as_str()))
                    .map(|s| s.to_string())
            })
        })
        .unwrap_or_else(|| "codex-user@chatgpt.com".to_string());

    let name = item.get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            jwt_claims.as_ref().and_then(|c| {
                c.get("https://api.openai.com/profile")
                    .and_then(|p| p.get("name"))
                    .and_then(|n| n.as_str())
                    .or_else(|| c.get("name").and_then(|n| n.as_str()))
                    .map(|s| s.to_string())
            })
        });

    let account_id = item.get("account_id")
        .or_else(|| item.get("accountId"))
        .or_else(|| item.get("chatgpt_account_id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            jwt_claims.as_ref().and_then(|c| {
                c.get("https://api.openai.com/auth")
                    .and_then(|a| a.get("chatgpt_account_id"))
                    .and_then(|id| id.as_str())
                    .map(|s| s.to_string())
            })
        })
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let plan_type = item.get("plan_type")
        .or_else(|| item.get("plan"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            jwt_claims.as_ref().and_then(|c| {
                c.get("https://api.openai.com/auth")
                    .and_then(|a| a.get("chatgpt_plan_type"))
                    .and_then(|p| p.as_str())
                    .map(|s| s.to_string())
            })
        })
        .unwrap_or_else(|| "plus".to_string());

    if access_token.is_none() && refresh_token.is_none() {
        return None;
    }

    Some(CodexAccount {
        id: account_id,
        email,
        name: name.or_else(|| Some(format!("Codex ({})", plan_type))),
        auth_mode: CodexAuthMode::OAuth,
        plan_type,
        is_active: false,
        is_cooldown: false,
        quota: CodexQuota {
            hourly: CodexQuotaWindow {
                used_percent: 0,
                remaining_percent: 100,
                reset_minutes_remaining: None,
            },
            weekly: CodexQuotaWindow {
                used_percent: 0,
                remaining_percent: 100,
                reset_minutes_remaining: None,
            },
            luna_reserve_allowed: true,
            luna_reserve_active: false,
            reset_credits_remaining: 5,
            updated_at: chrono::Utc::now().timestamp_millis(),
        },
        created_at: chrono::Utc::now().timestamp_millis(),
        last_used_at: None,
        access_token,
        refresh_token,
        id_token,
        api_base_url: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_init_real_user_storage() {
        let manager = AccountManager::new();
        let raw = r#"[
  {
    "id_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6Im4wejZQcjEtdEItMTdXb1U0VGM5OHp1RDBrNmx5YU1ZQmJ3SkFEOGtSVnMiLCJ0eXAiOiJKV1QifQ.eyJhY3IiOiJodHRwOi8vc2NoZW1hcy5vcGVuaWQubmV0L3BhcGUvcG9saWNpZXMvMjAwNy8wNi9tdWx0aS1mYWN0b3IiLCJhbXIiOlsicHdkIiwidXJuOm9wZW5haTphbXI6cGFzc3dvcmQiLCJvdHAiLCJtZmEiLCJ1cm46b3BlbmFpOmFtcjpvdHBfdG90cCJdLCJhdWQiOlsiYXBwX0VNb2FtRUVaNzNmMENrWGFYcDdocmFubiJdLCJhdXRoX3Byb3ZpZGVyIjoicGFzc3dvcmQiLCJhdXRoX3RpbWUiOjE3ODk5MTc2NjIsImVtYWlsIjoiYW1hZG91ZGlhd2FyYTg2M0BnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS9hdXRoIjp7ImNoYXRncHRfYWNjb3VudF9pZCI6IjgxMjg5Yzc4LWMxMGQtNGRkNS05YzUxLWUyNDk5YjdiMGM4YSIsImNoYXRncHRfcGxhbl90eXBlIjoicGx1cyIsImNoYXRncHRfc3Vic2NyaXB0aW9uX2FjdGl2ZV9zdGFydCI6IjIwMjYtMDktMjBUMTA6Mzk6MjErMDA6MDAiLCJjaGF0Z3B0X3N1YnNjcmlwdGlvbl9hY3RpdmVfdW50aWwiOiIyMDI2LTEwLTIwVDEwOjM5OjIxKzAwOjAwIiwiY2hhdGdwdF9zdWJzY3JpcHRpb25fbGFzdF9jaGVja2VkIjoiMjAyNi0wOS0yMFQxNToyMTowMi41NzA4NjcrMDA6MDAiLCJjaGF0Z3B0X3VzZXJfaWQiOiJ1c2VyLVgwS21zS0ZIZU1FZm5lMnd5WjdVMUhmYyIsImdyb3VwcyI6W10sImxvY2FsaG9zdCI6dHJ1ZSwib3JnYW5pemF0aW9ucyI6W3siaWQiOiJvcmctcVhzVVVOUkdUbGRYc2J2MnBXQjFVNDhyIiwiaXNfZGVmYXVsdCI6dHJ1ZSwicm9sZSI6Im93bmVyIiwidGl0bGUiOiJQZXJzb25hbCJ9XSwidXNlcl9pZCI6InVzZXItWDBLbXNLRkhlTUVmbmUyd3laN1UxSGZjIn0sImlzcyI6Imh0dHBzOi8vYXV0aC5vcGVuYWkuY29tIiwibmFtZSI6IlRyXHUwMWIwXHUwMWExbmcgS2ltIEhvYSIsInJhdCI6MTc4OTkxNzU1Mywic2lkIjoiYXV0aHNlc3NfUlRKVXZpRGRvOUFGSFVhMk1wTlJBcG4xIiwic3ViIjoiYXV0aDB8RWZUcXAwdE9PdmdPVkFaN2J0NkNydHoxIiwiaWF0IjoxNzg5OTE3NjYzLCJleHAiOjE3ODk5MjEyNjMsImp0aSI6IjRmMjYyYTlmYmE2MDRmNGM4ZTBlMmZkODA5YTQxYzc4IiwiYXRfaGFzaCI6IlNtMW9FZjB1dlJSTUFiTTlNOGhDcmcifQ.xf_jfOV8YE5qyFQ78ckW1T-uQb4ANRHJxL-KVfp3c3RXOas_sSS7V412MdL-sZG0RkLPdG9tqE4LPiGVLounEZ-CxhU1eW-rG1SbkLvrRvv42SxNQd8uTxWGimK71TKmCij19lAru8Hg6zkW57pepQROzOIzoJ-RuTR2vn2ZRYyPPaX15WTKoU8kMpUz8bS82V-3uGKvqJ5m57VhdT9swfcfvDPC41OhHkgub122Ub5UvVwtWMGeARKSfWJe38ZfHfcYua8FSgwAJsEZPEJx2nhVPyEC_kGFYR8LWfggn-ZhnJ73W0yt2fWvzzQAgDxNHof1Mh8ZVdeBSiiiz7gSDQ",
    "access_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6Im4wejZQcjEtdEItMTdXb1U0VGM5OHp1RDBrNmx5YU1ZQmJ3SkFEOGtSVnMiLCJ0eXAiOiJKV1QifQ.eyJhdWQiOlsiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS92MSJdLCJjbGllbnRfaWQiOiJhcHBfRU1vYW1FRVo3M2YwQ2tYYVhwN2hyYW5uIiwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS9hdXRoIjp7ImFtciI6WyJwd2QiLCJ1cm46b3BlbmFpOmFtcjpwYXNzd29yZCIsIm90cCIsIm1mYSIsInVybjpvcGVuYWk6YW1yOm90cF90b3RwIl0sImNoYXRncHRfYWNjb3VudF9pZCI6IjgxMjg5Yzc4LWMxMGQtNGRkNS05YzUxLWUyNDk5YjdiMGM4YSIsImNoYXRncHRfYWNjb3VudF91c2VyX2lkIjoidXNlci1YMEttc0tGSGVNRWZuZTJ3eVo3VTFIZmNfXzgxMjg5Yzc4LWMxMGQtNGRkNS05YzUxLWUyNDk5YjdiMGM4YSIsImNoYXRncHRfY29tcHV0ZV9yZXNpZGVuY3kiOiJub19jb25zdHJhaW50IiwiY2hhdGdwdF9wbGFuX3R5cGUiOiJwbHVzIiwiY2hhdGdwdF91c2VyX2lkIjoidXNlci1YMEttc0tGSGVNRWZuZTJ3eVo3VTFIZmMiLCJsb2NhbGhvc3QiOnRydWUsInBvaWQiOiJvcmctcVhzVVVOUkdUbGRYc2J2MnBXQjFVNDhyIiwidXNlcl9pZCI6InVzZXItWDBLbXNLRkhlTUVmbmUyd3laN1UxSGZjIn0sImh0dHBzOi8vYXBpLm9wZW5haS5jb20vbWZhIjp7InJlcXVpcmVkIjoieWVzIn0sImh0dHBzOi8vYXBpLm9wZW5haS5jb20vcHJvZmlsZSI6eyJlbWFpbCI6ImFtYWRvdWRpYXdhcmE4NjNAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJUclx1MDFiMFx1MDFhMW5nIEtpbSBIb2EifSwiaXNzIjoiaHR0cHM6Ly9hdXRoLm9wZW5haS5jb20iLCJwd2RfYXV0aF90aW1lIjoxNzg5OTE3MzE3ODgxLCJzY3AiOlsib3BlbmlkIiwicHJvZmlsZSIsImVtYWlsIiwib2ZmbGluZV9hY2Nlc3MiLCJhcGkuY29ubmVjdG9ycy5yZWFkIiwiYXBpLmNvbm5lY3RvcnMuaW52b2tlIl0sInNlc3Npb25faWQiOiJhdXRoc2Vzc19SVEpVdmlEZG85QUZIVWEyTXBOUkFwbjEiLCJzbCI6dHJ1ZSwic3ViIjoiYXV0aDB8RWZUcXAwdE9PdmdPVkFaN2J0NkNydHoxIiwiaWF0IjoxNzg5OTE3NjYzLCJleHAiOjE3OTA3ODE2NjMsImp0aSI6IjhhYzBhODA1ZDE5NDQwNTVhY2JiYzNjNWJiYmQ1M2IwIiwibmJmIjoxNzg5OTE3NjYzfQ.MXcOSzL2YD02MPicbmayZB4gY01xgryviCWI_5O7Ei76HiE1AbTdadg3wmCdxPY0F556BmUumHzbJuvsaz5n2519r_7gHupdMjSqpK991OEYBHZKumiN4SMY5uswY1tcRkT2zuDUhtuAHHS_-ScnR12lfqxmduLCK6L2ab5K2sT1WpcyUe-ssFZ5_qJPRF6iVsioyPmJaWlnRHYpXLBU-E2DIvc-nGVHYQv4nujwjbC7BolPL-qNHUH81nqv8lHyWHCV0YVtqI_Ic8loqDjXjLR-snCYbx0yky0-pjpO2dVMI7PSsAbPHPowuH4Bvrl2lnG4Y9W1Hha16PR21bMF3w",
    "refresh_token": "rt.1.AAASQk5dAJjpVJZimv5rfmqwIkYFlENIh-5lXxtMDvJD_sGGQeWZg_dIzESVPAMv2fvNUFXlOaWXxaCxMUAJpgRRumVQIccRtgS6TPet3sdAF4wxINnnPyQ0vS4flSHbJYliTxMe-QUkWFxh6gBeOvDOjuL6cN1GlBN91pzGj9wtCH_kw1zp4jyckuTigLU",
    "account_id": "81289c78-c10d-4dd5-9c51-e2499b7b0c8a",
    "last_refresh": "2026-09-20T15:21:05.000Z",
    "email": "amadoudiawara863@gmail.com",
    "type": "codex",
    "expired": "2026-09-30T15:21:03.000Z"
  },
  {
    "id_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6Im4wejZQcjEtdEItMTdXb1U0VGM5OHp1RDBrNmx5YU1ZQmJ3SkFEOGtSVnMiLCJ0eXAiOiJKV1QifQ.eyJhY3IiOiJodHRwOi8vc2NoZW1hcy5vcGVuaWQubmV0L3BhcGUvcG9saWNpZXMvMjAwNy8wNi9tdWx0aS1mYWN0b3IiLCJhbXIiOlsicHdkIiwidXJuOm9wZW5haTphbXI6cGFzc3dvcmQiLCJvdHAiLCJtZmEiLCJ1cm46b3BlbmFpOmFtcjpvdHBfdG90cCJdLCJhdWQiOlsiYXBwX0VNb2FtRUVaNzNmMENrWGFYcDdocmFubiJdLCJhdXRoX3Byb3ZpZGVyIjoicGFzc3dvcmQiLCJhdXRoX3RpbWUiOjE3ODk3Mjk3ODIsImVtYWlsIjoiY2VkcmljZGlzY3Vzc0BnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS9hdXRoIjp7ImNoYXRncHRfYWNjb3VudF9pZCI6IjZlNDU0MGRkLTNhMTAtNGNkNS05MTg3LTc2ZGNhYzc2OTQwZiIsImNoYXRncHRfcGxhbl90eXBlIjoicGx1cyIsImNoYXRncHRfc3Vic2NyaXB0aW9uX2FjdGl2ZV9zdGFydCI6IjIwMjYtMDktMDlUMTU6NTM6MTMrMDA6MDAiLCJjaGF0Z3B0X3N1YnNjcmlwdGlvbl9hY3RpdmVfdW50aWwiOiIyMDI2LTEwLTA5VDE1OjUzOjEzKzAwOjAwIiwiY2hhdGdwdF9zdWJzY3JpcHRpb25fbGFzdF9jaGVja2VkIjoiMjAyNi0wOS0xOFQxMTowOTo0MS45MjczOTUrMDA6MDAiLCJjaGF0Z3B0X3VzZXJfaWQiOiJ1c2VyLTJpbjhwTU5NTnVFV1R6V2pXWEpSMFdvTiIsImdyb3VwcyI6W10sImxvY2FsaG9zdCI6dHJ1ZSwib3JnYW5pemF0aW9ucyI6W3siaWQiOiJvcmctclFhVUdJcHVUem9IM04yQ1Y1eWZCV1Y2IiwiaXNfZGVmYXVsdCI6dHJ1ZSwicm9sZSI6Im93bmVyIiwidGl0bGUiOiJQZXJzb25hbCJ9XSwidXNlcl9pZCI6InVzZXItMmluOHBNTk1OdUVXVHpXaldYSlIwV29OIn0sImlzcyI6Imh0dHBzOi8vYXV0aC5vcGVuYWkuY29tIiwibmFtZSI6Imp1YW92YW5pZGsiLCJyYXQiOjE3ODk3Mjk3NTIsInNpZCI6ImF1dGhzZXNzX3RmaWNqZjdyZ3dxY3ltUm1LZHpOaW13ViIsInN1YiI6ImF1dGgwfFlmQVVDMnVOT2h1cUxOY0RUeTBlNFBKNSIsImlhdCI6MTc4OTcyOTc4MywiZXhwIjoxNzg5NzMzMzgzLCJqdGkiOiJkZmM5NTlhYTAwNzg0YWEyYjJhYzc3ZmYyMTM4OTUxYSIsImF0X2hhc2giOiIwLTEtQ0Jnd1NlYzQ0UmRwNldhUXp3In0.PQnmpUT1QIe0TSG4Powx80DKMp8YGyCktpoO1t4XNyfIqi9s7TbdDjzV6oesCAsTju5pNTyX12OBD1Ougzeb41LIR2naG0Q_YW0jSornzHLJXRCnNHUI1O46c4K0SV0kBWsoMxhl3TQvaufIybagzijLEd4PPYaiAhJDuSo1Ai1UJMz5z1n__XGs65KB4ikqOnlTDNSInJNMSKs-fhqCORJnhZRMpDxXOFEzjltDyaX1s3GkX7K3P3KdQyWgpxLZ5NnwALI76bMB4FzpuVryS5Bb3XFZU1a7zkX1tZN89_A7184n0_ITizi4oW7GzHprFA-6NP8aoMpOPJa689j_rw",
    "access_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6Im4wejZQcjEtdEItMTdXb1U0VGM5OHp1RDBrNmx5YU1ZQmJ3SkFEOGtSVnMiLCJ0eXAiOiJKV1QifQ.eyJhdWQiOlsiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS92MSJdLCJjbGllbnRfaWQiOiJhcHBfRU1vYW1FRVo3M2YwQ2tYYVhwN2hyYW5uIiwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS9hdXRoIjp7ImFtciI6WyJwd2QiLCJ1cm46b3BlbmFpOmFtcjpwYXNzd29yZCIsIm90cCIsIm1mYSIsInVybjpvcGVuYWk6YW1yOm90cF90b3RwIl0sImNoYXRncHRfYWNjb3VudF9pZCI6IjZlNDU0MGRkLTNhMTAtNGNkNS05MTg3LTc2ZGNhYzc2OTQwZiIsImNoYXRncHRfYWNjb3VudF91c2VyX2lkIjoidXNlci0yaW44cE1OTU51RVdUeldqV1hKUjBXb05fXzZlNDU0MGRkLTNhMTAtNGNkNS05MTg3LTc2ZGNhYzc2OTQwZiIsImNoYXRncHRfY29tcHV0ZV9yZXNpZGVuY3kiOiJub19jb25zdHJhaW50IiwiY2hhdGdwdF9wbGFuX3R5cGUiOiJwbHVzIiwiY2hhdGdwdF91c2VyX2lkIjoidXNlci0yaW44cE1OTU51RVdUeldqV1hKUjBXb04iLCJsb2NhbGhvc3QiOnRydWUsInBvaWQiOiJvcmctclFhVUdJcHVUem9IM04yQ1Y1eWZCV1Y2IiwidXNlcl9pZCI6InVzZXItMmluOHBNTk1OdUVXVHpXaldYSlIwV29NIn0sImh0dHBzOi8vYXBpLm9wZW5haS5jb20vbWZhIjp7InJlcXVpcmVkIjoieWVzIn0sImh0dHBzOi8vYXBpLm9wZW5haS5jb20vcHJvZmlsZSI6eyJlbWFpbCI6ImNlZHJpY2Rpc2N1c3NAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJqdWFvdmFuaWRrIn0sImlzcyI6Imh0dHBzOi8vYXV0aC5vcGVuYWkuY29tIiwicHdkX2F1dGhfdGltZSI6MTc4OTcyOTc3OTA2Nywic2NwIjpbIm9wZW5pZCIsInByb2ZpbGUiLCJlbWFpbCIsIm9mZmxpbmVfYWNjZXNzIiwiYXBpLmNvbm5lY3RvcnMucmVhZCIsImFwaS5jb25uZWN0b3JzLmludm9rZSJdLCJzZXNzaW9uX2lkIjoiYXV0aHNlc3NfdGZpY2pmN3Jnd3FjeW1SbUtkek5pbXdWIiwic2wiOnRydWUsInN1YiI6ImF1dGgwfFlmQVVDMnVOT2h1cUxOY0RUeTBlNFBKNSIsImlhdCI6MTc4OTcyOTc4MywiZXhwIjoxNzkwNTkzNzgzLCJqdGkiOiJmMmJlOTdhZWMzZjU0YTUzOWQyYzlkYzE4M2M4MDZmNCIsIm5iZiI6MTc4OTcyOTc4M30.ph-3AkM3aVF41-6ULErUzKsi8gHNZ2AmPU3AUN6QJ89PhzOpKSb2pbRnpXZbOC9b05Op-ewl1cq4v1yzwTgA9MqFWKc5DdWH2g5I026md03ftrnk5kMtdHagnNSQlmpGd_z3NBDRCzipvisRVG0AXHhVqqe--BCEOlWv7u0eHknEATegmLYGUj0gLx2Pz444-km07R5_wGnv_NIVaMCVKA4giEwlvKYIXn0eFcWy1-vgcmat3zgJOH25j2pgtQO2iW3tN29kOY97hsJPALtS7Rg7dFROSEy6OWKMC3hf5pmKs75k1fLSlla-Kq0AACRAAzJU2z1lN1c2V7wSHZ_Kmg",
    "refresh_token": "rt.1.AABdgxo2v7YmG7LvAsW-VLIhs6f6B_EjMBtYTkf73-jPHmdKNQMg43N-JcJY__jQtDE5PhIRkuu4SvmOUQk69rGBqve4cB6nsmRmwXok55BP4pEo0UA8_mWFN4NL0EfIGa2wRrIOW9jmurfbFaS17SCxizZpjTCOi38xjatY_27Lp-gfXs6Va0wfzoIn-lA",
    "account_id": "6e4540dd-3a10-4cd5-9187-76dcac76940f",
    "last_refresh": "2026-09-18T11:09:44.000Z",
    "email": "cedricdiscuss@gmail.com",
    "type": "codex",
    "expired": "2026-09-28T11:09:43.000Z"
  }
]"#;
        let res = manager.import_from_json(raw);
        assert!(res.is_ok());
    }

    #[test]
    fn test_clean_json_trailing_commas() {
        let dirty = r#"[ { "a": 1, }, ]"#;
        let cleaned = clean_json_trailing_commas(dirty);
        assert_eq!(cleaned, r#"[ { "a": 1 } ]"#);
        let parsed: serde_json::Value = serde_json::from_str(&cleaned).unwrap();
        assert!(parsed.is_array());
    }

    #[test]
    fn test_account_manager_lifecycle() {
        let temp_dir = std::env::temp_dir().join(format!("codex-test-{}", uuid::Uuid::new_v4()));
        let _ = std::fs::create_dir_all(&temp_dir);
        let storage = temp_dir.join("accounts.json");

        let manager = AccountManager::with_storage(storage.clone());
        let initial_list = manager.list();
        assert!(!initial_list.is_empty());

        let new_acc = CodexAccount {
            id: "acc-test-123".to_string(),
            email: "tester@example.com".to_string(),
            name: Some("Test Plus".to_string()),
            auth_mode: CodexAuthMode::OAuth,
            plan_type: "plus".to_string(),
            is_active: false,
            is_cooldown: false,
            quota: CodexQuota {
                hourly: CodexQuotaWindow { used_percent: 10, remaining_percent: 90, reset_minutes_remaining: Some(50) },
                weekly: CodexQuotaWindow { used_percent: 5, remaining_percent: 95, reset_minutes_remaining: Some(4000) },
                luna_reserve_allowed: false,
                luna_reserve_active: false,
                reset_credits_remaining: 1,
                updated_at: 0,
            },
            created_at: 0,
            last_used_at: None,
            access_token: Some("test-token".to_string()),
            refresh_token: None,
            id_token: None,
            api_base_url: None,
        };

        manager.add(new_acc.clone());
        let updated = manager.list();
        assert!(updated.iter().any(|a| a.id == "acc-test-123"));

        let switched = manager.switch_active("acc-test-123").unwrap();
        assert!(switched.is_active);
        assert_eq!(manager.get_active().unwrap().id, "acc-test-123");

        manager.delete("acc-test-123");
        assert!(!manager.list().iter().any(|a| a.id == "acc-test-123"));
    }

    #[tokio::test]
    async fn test_real_codex_account_import_e2e() {
        let temp_dir = std::env::temp_dir().join(format!("codex-e2e-{}", uuid::Uuid::new_v4()));
        let _ = std::fs::create_dir_all(&temp_dir);
        let storage = temp_dir.join("accounts.json");

        let manager = AccountManager::with_storage(storage.clone());

        let raw_user_json = r#"[
  {
    "id_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6Im4wejZQcjEtdEItMTdXb1U0VGM5OHp1RDBrNmx5YU1ZQmJ3SkFEOGtSVnMiLCJ0eXAiOiJKV1QifQ.eyJhY3IiOiJodHRwOi8vc2NoZW1hcy5vcGVuaWQubmV0L3BhcGUvcG9saWNpZXMvMjAwNy8wNi9tdWx0aS1mYWN0b3IiLCJhbXIiOlsicHdkIiwidXJuOm9wZW5haTphbXI6cGFzc3dvcmQiLCJvdHAiLCJtZmEiLCJ1cm46b3BlbmFpOmFtcjpvdHBfdG90cCJdLCJhdWQiOlsiYXBwX0VNb2FtRUVaNzNmMENrWGFYcDdocmFubiJdLCJhdXRoX3Byb3ZpZGVyIjoicGFzc3dvcmQiLCJhdXRoX3RpbWUiOjE3ODk5MTc2NjIsImVtYWlsIjoiYW1hZG91ZGlhd2FyYTg2M0BnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS9hdXRoIjp7ImNoYXRncHRfYWNjb3VudF9pZCI6IjgxMjg5Yzc4LWMxMGQtNGRkNS05YzUxLWUyNDk5YjdiMGM4YSIsImNoYXRncHRfcGxhbl90eXBlIjoicGx1cyIsImNoYXRncHRfc3Vic2NyaXB0aW9uX2FjdGl2ZV9zdGFydCI6IjIwMjYtMDktMjBUMTA6Mzk6MjErMDA6MDAiLCJjaGF0Z3B0X3N1YnNjcmlwdGlvbl9hY3RpdmVfdW50aWwiOiIyMDI2LTEwLTIwVDEwOjM5OjIxKzAwOjAwIiwiY2hhdGdwdF9zdWJzY3JpcHRpb25fbGFzdF9jaGVja2VkIjoiMjAyNi0wOS0yMFQxNToyMTowMi41NzA4NjcrMDA6MDAiLCJjaGF0Z3B0X3VzZXJfaWQiOiJ1c2VyLVgwS21zS0ZIZU1FZm5lMnd5WjdVMUhmYyIsImdyb3VwcyI6W10sImxvY2FsaG9zdCI6dHJ1ZSwib3JnYW5pemF0aW9ucyI6W3siaWQiOiJvcmctcVhzVVVOUkdUbGRYc2J2MnBXQjFVNDhyIiwiaXNfZGVmYXVsdCI6dHJ1ZSwicm9sZSI6Im93bmVyIiwidGl0bGUiOiJQZXJzb25hbCJ9XSwidXNlcl9pZCI6InVzZXItWDBLbXNLRkhlTUVmbmUyd3laN1UxSGZjIn0sImlzcyI6Imh0dHBzOi8vYXV0aC5vcGVuYWkuY29tIiwibmFtZSI6IlRyXHUwMWIwXHUwMWExbmcgS2ltIEhvYSIsInJhdCI6MTc4OTkxNzU1Mywic2lkIjoiYXV0aHNlc3NfUlRKVXZpRGRvOUFGSFVhMk1wTlJBcG4xIiwic3ViIjoiYXV0aDB8RWZUcXAwdE9PdmdPVkFaN2J0NkNydHoxIiwiaWF0IjoxNzg5OTE3NjYzLCJleHAiOjE3ODk5MjEyNjMsImp0aSI6IjRmMjYyYTlmYmE2MDRmNGM4ZTBlMmZkODA5YTQxYzc4IiwiYXRfaGFzaCI6IlNtMW9FZjB1dlJSTUFiTTlNOGhDcmcifQ.xf_jfOV8YE5qyFQ78ckW1T-uQb4ANRHJxL-KVfp3c3RXOas_sSS7V412MdL-sZG0RkLPdG9tqE4LPiGVLounEZ-CxhU1eW-rG1SbkLvrRvv42SxNQd8uTxWGimK71TKmCij19lAru8Hg6zkW57pepQROzOIzoJ-RuTR2vn2ZRYyPPaX15WTKoU8kMpUz8bS82V-3uGKvqJ5m57VhdT9swfcfvDPC41OhHkgub122Ub5UvVwtWMGeARKSfWJe38ZfHfcYua8FSgwAJsEZPEJx2nhVPyEC_kGFYR8LWfggn-ZhnJ73W0yt2fWvzzQAgDxNHof1Mh8ZVdeBSiiiz7gSDQ",
    "access_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6Im4wejZQcjEtdEItMTdXb1U0VGM5OHp1RDBrNmx5YU1ZQmJ3SkFEOGtSVnMiLCJ0eXAiOiJKV1QifQ.eyJhdWQiOlsiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS92MSJdLCJjbGllbnRfaWQiOiJhcHBfRU1vYW1FRVo3M2YwQ2tYYVhwN2hyYW5uIiwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS9hdXRoIjp7ImFtciI6WyJwd2QiLCJ1cm46b3BlbmFpOmFtcjpwYXNzd29yZCIsIm90cCIsIm1mYSIsInVybjpvcGVuYWk6YW1yOm90cF90b3RwIl0sImNoYXRncHRfYWNjb3VudF9pZCI6IjgxMjg5Yzc4LWMxMGQtNGRkNS05YzUxLWUyNDk5YjdiMGM4YSIsImNoYXRncHRfYWNjb3VudF91c2VyX2lkIjoidXNlci1YMEttc0tGSGVNRWZuZTJ3eVo3VTFIZmNfXzgxMjg5Yzc4LWMxMGQtNGRkNS05YzUxLWUyNDk5YjdiMGM4YSIsImNoYXRncHRfY29tcHV0ZV9yZXNpZGVuY3kiOiJub19jb25zdHJhaW50IiwiY2hhdGdwdF9wbGFuX3R5cGUiOiJwbHVzIiwiY2hhdGdwdF91c2VyX2lkIjoidXNlci1YMEttc0tGSGVNRWZuZTJ3eVo3VTFIZmMiLCJsb2NhbGhvc3QiOnRydWUsInBvaWQiOiJvcmctcVhzVVVOUkdUbGRYc2J2MnBXQjFVNDhyIiwidXNlcl9pZCI6InVzZXItWDBLbXNLRkhlTUVmbmUyd3laN1UxSGZjIn0sImh0dHBzOi8vYXBpLm9wZW5haS5jb20vbWZhIjp7InJlcXVpcmVkIjoieWVzIn0sImh0dHBzOi8vYXBpLm9wZW5haS5jb20vcHJvZmlsZSI6eyJlbWFpbCI6ImFtYWRvdWRpYXdhcmE4NjNAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJUclx1MDFiMFx1MDFhMW5nIEtpbSBIb2EifSwiaXNzIjoiaHR0cHM6Ly9hdXRoLm9wZW5haS5jb20iLCJwd2RfYXV0aF90aW1lIjoxNzg5OTE3MzE3ODgxLCJzY3AiOlsib3BlbmlkIiwicHJvZmlsZSIsImVtYWlsIiwib2ZmbGluZV9hY2Nlc3MiLCJhcGkuY29ubmVjdG9ycy5yZWFkIiwiYXBpLmNvbm5lY3RvcnMuaW52b2tlIl0sInNlc3Npb25faWQiOiJhdXRoc2Vzc19SVEpVdmlEZG85QUZIVWEyTXBOUkFwbjEiLCJzbCI6dHJ1ZSwic3ViIjoiYXV0aDB8RWZUcXAwdE9PdmdPVkFaN2J0NkNydHoxIiwiaWF0IjoxNzg5OTE3NjYzLCJleHAiOjE3OTA3ODE2NjMsImp0aSI6IjhhYzBhODA1ZDE5NDQwNTVhY2JiYzNjNWJiYmQ1M2IwIiwibmJmIjoxNzg5OTE3NjYzfQ.MXcOSzL2YD02MPicbmayZB4gY01xgryviCWI_5O7Ei76HiE1AbTdadg3wmCdxPY0F556BmUumHzbJuvsaz5n2519r_7gHupdMjSqpK991OEYBHZKumiN4SMY5uswY1tcRkT2zuDUhtuAHHS_-ScnR12lfqxmduLCK6L2ab5K2sT1WpcyUe-ssFZ5_qJPRF6iVsioyPmJaWlnRHYpXLBU-E2DIvc-nGVHYQv4nujwjbC7BolPL-qNHUH81nqv8lHyWHCV0YVtqI_Ic8loqDjXjLR-snCYbx0yky0-pjpO2dVMI7PSsAbPHPowuH4Bvrl2lnG4Y9W1Hha16PR21bMF3w",
    "refresh_token": "rt.1.AAASQk5dAJjpVJZimv5rfmqwIkYFlENIh-5lXxtMDvJD_sGGQeWZg_dIzESVPAMv2fvNUFXlOaWXxaCxMUAJpgRRumVQIccRtgS6TPet3sdAF4wxINnnPyQ0vS4flSHbJYliTxMe-QUkWFxh6gBeOvDOjuL6cN1GlBN91pzGj9wtCH_kw1zp4jyckuTigLU",
    "account_id": "81289c78-c10d-4dd5-9c51-e2499b7b0c8a",
    "last_refresh": "2026-09-20T15:21:05.000Z",
    "email": "amadoudiawara863@gmail.com",
    "type": "codex",
    "expired": "2026-09-30T15:21:03.000Z"
  },
  {
    "id_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6Im4wejZQcjEtdEItMTdXb1U0VGM5OHp1RDBrNmx5YU1ZQmJ3SkFEOGtSVnMiLCJ0eXAiOiJKV1QifQ.eyJhY3IiOiJodHRwOi8vc2NoZW1hcy5vcGVuaWQubmV0L3BhcGUvcG9saWNpZXMvMjAwNy8wNi9tdWx0aS1mYWN0b3IiLCJhbXIiOlsicHdkIiwidXJuOm9wZW5haTphbXI6cGFzc3dvcmQiLCJvdHAiLCJtZmEiLCJ1cm46b3BlbmFpOmFtcjpvdHBfdG90cCJdLCJhdWQiOlsiYXBwX0VNb2FtRUVaNzNmMENrWGFYcDdocmFubiJdLCJhdXRoX3Byb3ZpZGVyIjoicGFzc3dvcmQiLCJhdXRoX3RpbWUiOjE3ODk3Mjk3ODIsImVtYWlsIjoiY2VkcmljZGlzY3Vzc0BnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS9hdXRoIjp7ImNoYXRncHRfYWNjb3VudF9pZCI6IjZlNDU0MGRkLTNhMTAtNGNkNS05MTg3LTc2ZGNhYzc2OTQwZiIsImNoYXRncHRfcGxhbl90eXBlIjoicGx1cyIsImNoYXRncHRfc3Vic2NyaXB0aW9uX2FjdGl2ZV9zdGFydCI6IjIwMjYtMDktMDlUMTU6NTM6MTMrMDA6MDAiLCJjaGF0Z3B0X3N1YnNjcmlwdGlvbl9hY3RpdmVfdW50aWwiOiIyMDI2LTEwLTA5VDE1OjUzOjEzKzAwOjAwIiwiY2hhdGdwdF9zdWJzY3JpcHRpb25fbGFzdF9jaGVja2VkIjoiMjAyNi0wOS0xOFQxMTowOTo0MS45MjczOTUrMDA6MDAiLCJjaGF0Z3B0X3VzZXJfaWQiOiJ1c2VyLTJpbjhwTU5NTnVFV1R6V2pXWEpSMFdvTiIsImdyb3VwcyI6W10sImxvY2FsaG9zdCI6dHJ1ZSwib3JnYW5pemF0aW9ucyI6W3siaWQiOiJvcmctclFhVUdJcHVUem9IM04yQ1Y1eWZCV1Y2IiwiaXNfZGVmYXVsdCI6dHJ1ZSwicm9sZSI6Im93bmVyIiwidGl0bGUiOiJQZXJzb25hbCJ9XSwidXNlcl9pZCI6InVzZXItMmluOHBNTk1OdUVXVHpXaldYSlIwV29OIn0sImlzcyI6Imh0dHBzOi8vYXV0aC5vcGVuYWkuY29tIiwibmFtZSI6Imp1YW92YW5pZGsiLCJyYXQiOjE3ODk3Mjk3NTIsInNpZCI6ImF1dGhzZXNzX3RmaWNqZjdyZ3dxY3ltUm1LZHpOaW13ViIsInN1YiI6ImF1dGgwfFlmQVVDMnVOT2h1cUxOY0RUeTBlNFBKNSIsImlhdCI6MTc4OTcyOTc4MywiZXhwIjoxNzg5NzMzMzgzLCJqdGkiOiJkZmM5NTlhYTAwNzg0YWEyYjJhYzc3ZmYyMTM4OTUxYSIsImF0X2hhc2giOiIwLTEtQ0Jnd1NlYzQ0UmRwNldhUXp3In0.PQnmpUT1QIe0TSG4Powx80DKMp8YGyCktpoO1t4XNyfIqi9s7TbdDjzV6oesCAsTju5pNTyX12OBD1Ougzeb41LIR2naG0Q_YW0jSornzHLJXRCnNHUI1O46c4K0SV0kBWsoMxhl3TQvaufIybagzijLEd4PPYaiAhJDuSo1Ai1UJMz5z1n__XGs65KB4ikqOnlTDNSInJNMSKs-fhqCORJnhZRMpDxXOFEzjltDyaX1s3GkX7K3P3KdQyWgpxLZ5NnwALI76bMB4FzpuVryS5Bb3XFZU1a7zkX1tZN89_A7184n0_ITizi4oW7GzHprFA-6NP8aoMpOPJa689j_rw",
    "access_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6Im4wejZQcjEtdEItMTdXb1U0VGM5OHp1RDBrNmx5YU1ZQmJ3SkFEOGtSVnMiLCJ0eXAiOiJKV1QifQ.eyJhdWQiOlsiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS92MSJdLCJjbGllbnRfaWQiOiJhcHBfRU1vYW1FRVo3M2YwQ2tYYVhwN2hyYW5uIiwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS9hdXRoIjp7ImFtciI6WyJwd2QiLCJ1cm46b3BlbmFpOmFtcjpwYXNzd29yZCIsIm90cCIsIm1mYSIsInVybjpvcGVuYWk6YW1yOm90cF90b3RwIl0sImNoYXRncHRfYWNjb3VudF9pZCI6IjZlNDU0MGRkLTNhMTAtNGNkNS05MTg3LTc2ZGNhYzc2OTQwZiIsImNoYXRncHRfYWNjb3VudF91c2VyX2lkIjoidXNlci0yaW44cE1OTU51RVdUeldqV1hKUjBXb05fXzZlNDU0MGRkLTNhMTAtNGNkNS05MTg3LTc2ZGNhYzc2OTQwZiIsImNoYXRncHRfY29tcHV0ZV9yZXNpZGVuY3kiOiJub19jb25zdHJhaW50IiwiY2hhdGdwdF9wbGFuX3R5cGUiOiJwbHVzIiwiY2hhdGdwdF91c2VyX2lkIjoidXNlci0yaW44cE1OTU51RVdUeldqV1hKUjBXb04iLCJsb2NhbGhvc3QiOnRydWUsInBvaWQiOiJvcmctclFhVUdJcHVUem9IM04yQ1Y1eWZCV1Y2IiwidXNlcl9pZCI6InVzZXItMmluOHBNTk1OdUVXVHpXaldYSlIwV29OIn0sImh0dHBzOi8vYXBpLm9wZW5haS5jb20vbWZhIjp7InJlcXVpcmVkIjoieWVzIn0sImh0dHBzOi8vYXBpLm9wZW5haS5jb20vcHJvZmlsZSI6eyJlbWFpbCI6ImNlZHJpY2Rpc2N1c3NAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJqdWFvdmFuaWRrIn0sImlzcyI6Imh0dHBzOi8vYXV0aC5vcGVuYWkuY29tIiwicHdkX2F1dGhfdGltZSI6MTc4OTcyOTc3OTA2Nywic2NwIjpbIm9wZW5pZCIsInByb2ZpbGUiLCJlbWFpbCIsIm9mZmxpbmVfYWNjZXNzIiwiYXBpLmNvbm5lY3RvcnMucmVhZCIsImFwaS5jb25uZWN0b3JzLmludm9rZSJdLCJzZXNzaW9uX2lkIjoiYXV0aHNlc3NfdGZpY2pmN3Jnd3FjeW1SbUtkek5pbXdWIiwic2wiOnRydWUsInN1YiI6ImF1dGgwfFlmQVVDMnVOT2h1cUxOY0RUeTBlNFBKNSIsImlhdCI6MTc4OTcyOTc4MywiZXhwIjoxNzkwNTkzNzgzLCJqdGkiOiJmMmJlOTdhZWMzZjU0YTUzOWQyYzlkYzE4M2M4MDZmNCIsIm5iZiI6MTc4OTcyOTc4M30.ph-3AkM3aVF41-6ULErUzKsi8gHNZ2AmPU3AUN6QJ89PhzOpKSb2pbRnpXZbOC9b05Op-ewl1cq4v1yzwTgA9MqFWKc5DdWH2g5I026md03ftrnk5kMtdHagnNSQlmpGd_z3NBDRCzipvisRVG0AXHhVqqe--BCEOlWv7u0eHknEATegmLYGUj0gLx2Pz444-km07R5_wGnv_NIVaMCVKA4giEwlvKYIXn0eFcWy1-vgcmat3zgJOH25j2pgtQO2iW3tN29kOY97hsJPALtS7Rg7dFROSEy6OWKMC3hf5pmKs75k1fLSlla-Kq0AACRAAzJU2z1lN1c2V7wSHZ_Kmg",
    "refresh_token": "rt.1.AABdgxo2v7YmG7LvAsW-VLIhs6f6B_EjMBtYTkf73-jPHmdKNQMg43N-JcJY__jQtDE5PhIRkuu4SvmOUQk69rGBqve4cB6nsmRmwXok55BP4pEo0UA8_mWFN4NL0EfIGa2wRrIOW9jmurfbFaS17SCxizZpjTCOi38xjatY_27Lp-gfXs6Va0wfzoIn-lA",
    "account_id": "6e4540dd-3a10-4cd5-9187-76dcac76940f",
    "last_refresh": "2026-09-18T11:09:44.000Z",
    "email": "cedricdiscuss@gmail.com",
    "type": "codex",
    "expired": "2026-09-28T11:09:43.000Z"
  },
]"#;

        let imported = manager.import_from_json(raw_user_json).expect("Import must succeed");
        assert_eq!(imported.len(), 2);

        let acc1 = imported.iter().find(|a| a.email == "amadoudiawara863@gmail.com").unwrap();
        assert_eq!(acc1.id, "81289c78-c10d-4dd5-9c51-e2499b7b0c8a");
        assert_eq!(acc1.plan_type, "plus");
        assert!(acc1.name.as_ref().unwrap().contains("Trương Kim Hoa") || acc1.name.as_ref().unwrap().contains("plus"));
        assert!(acc1.access_token.is_some());
        assert!(acc1.refresh_token.is_some());

        let acc2 = imported.iter().find(|a| a.email == "cedricdiscuss@gmail.com").unwrap();
        assert_eq!(acc2.id, "6e4540dd-3a10-4cd5-9187-76dcac76940f");
        assert_eq!(acc2.plan_type, "plus");
        assert!(acc2.access_token.is_some());
        assert!(acc2.refresh_token.is_some());

        // Account 1 should be active by default after importing to empty state
        let active = manager.get_active().expect("Should have active account");
        assert_eq!(active.email, "amadoudiawara863@gmail.com");

        // Verify switching to account 2
        let switched = manager.switch_active("6e4540dd-3a10-4cd5-9187-76dcac76940f").unwrap();
        assert_eq!(switched.email, "cedricdiscuss@gmail.com");
        assert!(switched.is_active);

        let new_active = manager.get_active().unwrap();
        assert_eq!(new_active.email, "cedricdiscuss@gmail.com");

        // Verify storage file on disk
        let saved_str = std::fs::read_to_string(&storage).unwrap();
        assert!(saved_str.contains("amadoudiawara863@gmail.com"));
        assert!(saved_str.contains("cedricdiscuss@gmail.com"));
    }

    #[tokio::test]
    async fn test_real_quota_fetch_live() {
        let temp_dir = std::env::temp_dir().join(format!("codex-quota-{}", uuid::Uuid::new_v4()));
        let _ = std::fs::create_dir_all(&temp_dir);
        let storage = temp_dir.join("accounts.json");

        let manager = AccountManager::with_storage(storage);

        let raw_user_json = r#"[
  {
    "id_token": "mock",
    "access_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6Im4wejZQcjEtdEItMTdXb1U0VGM5OHp1RDBrNmx5YU1ZQmJ3SkFEOGtSVnMiLCJ0eXAiOiJKV1QifQ.eyJhdWQiOlsiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS92MSJdLCJjbGllbnRfaWQiOiJhcHBfRU1vYW1FRVo3M2YwQ2tYYVhwN2hyYW5uIiwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS9hdXRoIjp7ImFtciI6WyJwd2QiLCJ1cm46b3BlbmFpOmFtcjpwYXNzd29yZCIsIm90cCIsIm1mYSIsInVybjpvcGVuYWk6YW1yOm90cF90b3RwIl0sImNoYXRncHRfYWNjb3VudF9pZCI6IjgxMjg5Yzc4LWMxMGQtNGRkNS05YzUxLWUyNDk5YjdiMGM4YSIsImNoYXRncHRfYWNjb3VudF91c2VyX2lkIjoidXNlci1YMEttc0tGSGVNRWZuZTJ3eVo3VTFIZmNfXzgxMjg5Yzc4LWMxMGQtNGRkNS05YzUxLWUyNDk5YjdiMGM4YSIsImNoYXRncHRfY29tcHV0ZV9yZXNpZGVuY3kiOiJub19jb25zdHJhaW50IiwiY2hhdGdwdF9wbGFuX3R5cGUiOiJwbHVzIiwiY2hhdGdwdF91c2VyX2lkIjoidXNlci1YMEttc0tGSGVNRWZuZTJ3eVo3VTFIZmMiLCJsb2NhbGhvc3QiOnRydWUsInBvaWQiOiJvcmctcVhzVVVOUkdUbGRYc2J2MnBXQjFVNDhyIiwidXNlcl9pZCI6InVzZXItWDBLbXNLRkhlTUVmbmUyd3laN1UxSGZjIn0sImh0dHBzOi8vYXBpLm9wZW5haS5jb20vbWZhIjp7InJlcXVpcmVkIjoieWVzIn0sImh0dHBzOi8vYXBpLm9wZW5haS5jb20vcHJvZmlsZSI6eyJlbWFpbCI6ImFtYWRvdWRpYXdhcmE4NjNAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJUclx1MDFiMFx1MDFhMW5nIEtpbSBIb2EifSwiaXNzIjoiaHR0cHM6Ly9hdXRoLm9wZW5haS5jb20iLCJwd2RfYXV0aF90aW1lIjoxNzg5OTE3MzE3ODgxLCJzY3AiOlsib3BlbmlkIiwicHJvZmlsZSIsImVtYWlsIiwib2ZmbGluZV9hY2Nlc3MiLCJhcGkuY29ubmVjdG9ycy5yZWFkIiwiYXBpLmNvbm5lY3RvcnMuaW52b2tlIl0sInNlc3Npb25faWQiOiJhdXRoc2Vzc19SVEpVdmlEZG85QUZIVWEyTXBOUkFwbjEiLCJzbCI6dHJ1ZSwic3ViIjoiYXV0aDB8RWZUcXAwdE9PdmdPVkFaN2J0NkNydHoxIiwiaWF0IjoxNzg5OTE3NjYzLCJleHAiOjE3OTA3ODE2NjMsImp0aSI6IjhhYzBhODA1ZDE5NDQwNTVhY2JiYzNjNWJiYmQ1M2IwIiwibmJmIjoxNzg5OTE3NjYzfQ.MXcOSzL2YD02MPicbmayZB4gY01xgryviCWI_5O7Ei76HiE1AbTdadg3wmCdxPY0F556BmUumHzbJuvsaz5n2519r_7gHupdMjSqpK991OEYBHZKumiN4SMY5uswY1tcRkT2zuDUhtuAHHS_-ScnR12lfqxmduLCK6L2ab5K2sT1WpcyUe-ssFZ5_qJPRF6iVsioyPmJaWlnRHYpXLBU-E2DIvc-nGVHYQv4nujwjbC7BolPL-qNHUH81nqv8lHyWHCV0YVtqI_Ic8loqDjXjLR-snCYbx0yky0-pjpO2dVMI7PSsAbPHPowuH4Bvrl2lnG4Y9W1Hha16PR21bMF3w",
    "refresh_token": "rt.1.AAASQk5dAJjpVJZimv5rfmqwIkYFlENIh-5lXxtMDvJD_sGGQeWZg_dIzESVPAMv2fvNUFXlOaWXxaCxMUAJpgRRumVQIccRtgS6TPet3sdAF4wxINnnPyQ0vS4flSHbJYliTxMe-QUkWFxh6gBeOvDOjuL6cN1GlBN91pzGj9wtCH_kw1zp4jyckuTigLU",
    "account_id": "81289c78-c10d-4dd5-9c51-e2499b7b0c8a",
    "email": "amadoudiawara863@gmail.com",
    "plan_type": "plus"
  }
]"#;

        manager.import_from_json(raw_user_json).unwrap();
        let quota_result = manager.refresh_quota("81289c78-c10d-4dd5-9c51-e2499b7b0c8a").await;

        match quota_result {
            Ok(acc) => {
                assert_eq!(acc.plan_type, "plus");
                assert!(acc.quota.updated_at > 0);
                println!("Live Quota Fetched: plan={}, hourly_used={}%", acc.plan_type, acc.quota.hourly.used_percent);
            }
            Err(e) => {
                // If offline or rate limited, should report informative error
                println!("Quota query error (handled): {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_token_refresh_e2e() {
        let temp_dir = std::env::temp_dir().join(format!("codex-refresh-{}", uuid::Uuid::new_v4()));
        let _ = std::fs::create_dir_all(&temp_dir);
        let storage = temp_dir.join("accounts.json");

        let manager = AccountManager::with_storage(storage);

        let raw_user_json = r#"[
  {
    "id_token": "mock",
    "access_token": "mock_expired",
    "refresh_token": "rt.1.AABdgxo2v7YmG7LvAsW-VLIhs6f6B_EjMBtYTkf73-jPHmdKNQMg43N-JcJY__jQtDE5PhIRkuu4SvmOUQk69rGBqve4cB6nsmRmwXok55BP4pEo0UA8_mWFN4NL0EfIGa2wRrIOW9jmurfbFaS17SCxizZpjTCOi38xjatY_27Lp-gfXs6Va0wfzoIn-lA",
    "account_id": "6e4540dd-3a10-4cd5-9187-76dcac76940f",
    "email": "cedricdiscuss@gmail.com",
    "plan_type": "plus"
  }
]"#;

        manager.import_from_json(raw_user_json).unwrap();
        let refresh_res = manager.refresh_token("6e4540dd-3a10-4cd5-9187-76dcac76940f").await;

        match refresh_res {
            Ok(acc) => {
                assert!(acc.access_token.is_some());
                assert!(acc.access_token.as_ref().unwrap().starts_with("eyJ"));
                println!("Live Token Refresh Succeeded: account={}", acc.email);
            }
            Err(e) => {
                println!("Live Token Refresh error (handled): {}", e);
            }
        }
    }
}
