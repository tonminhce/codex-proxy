use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CodexAuthMode {
    OAuth,
    ApiKey,
    Pat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexQuotaWindow {
    pub used_percent: u32,
    pub remaining_percent: u32,
    pub reset_minutes_remaining: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexQuota {
    pub hourly: CodexQuotaWindow,
    pub weekly: CodexQuotaWindow,
    pub luna_reserve_allowed: bool,
    pub luna_reserve_active: bool,
    pub reset_credits_remaining: u32,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexAccount {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub auth_mode: CodexAuthMode,
    pub plan_type: String,
    pub is_active: bool,
    pub is_cooldown: bool,
    pub quota: CodexQuota,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub id_token: Option<String>,
    pub api_base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientApiKey {
    pub id: String,
    pub name: String,
    pub key: String,
    pub enabled: bool,
    pub total_tokens_used: u64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayConfig {
    pub running: bool,
    pub port: u16,
    pub host: String,
    pub scope: String,
    pub routing_strategy: String,
    pub session_affinity: bool,
    pub session_affinity_ttl_seconds: u32,
    pub quota_reserve_percent: u32,
    pub api_keys: Vec<ClientApiKey>,
}

impl Default for GatewayConfig {
    fn default() -> Self {
        Self {
            running: true,
            port: 8080,
            host: "127.0.0.1".to_string(),
            scope: "localhost".to_string(),
            routing_strategy: "auto".to_string(),
            session_affinity: true,
            session_affinity_ttl_seconds: 1800,
            quota_reserve_percent: 15,
            api_keys: vec![ClientApiKey {
                id: "key-default".to_string(),
                name: "Default Local Key".to_string(),
                key: "sk-codex-local-default".to_string(),
                enabled: true,
                total_tokens_used: 0,
                created_at: chrono::Utc::now().timestamp_millis(),
            }],
        }
    }
}
