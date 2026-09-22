use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CodexAuthMode {
    OAuth,
    ApiKey,
    Pat,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexQuotaWindow {
    pub used_percent: u32,
    pub remaining_percent: u32,
    pub reset_minutes_remaining: Option<u32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
    #[serde(default, skip_deserializing)]
    pub total_tokens_used: u64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
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
    pub request_timeout_seconds: u64,
    pub max_retries: usize,
    pub requests_per_minute: u32,
}

impl Default for GatewayConfig {
    fn default() -> Self {
        Self {
            running: false,
            port: 8080,
            host: "127.0.0.1".to_string(),
            scope: "localhost".to_string(),
            routing_strategy: "auto".to_string(),
            session_affinity: true,
            session_affinity_ttl_seconds: 1800,
            quota_reserve_percent: 15,
            api_keys: vec![],
            request_timeout_seconds: 300,
            max_retries: 2,
            requests_per_minute: 0,
        }
    }
}

impl GatewayConfig {
    pub fn validate(&self) -> Result<(), String> {
        if self.port == 0 {
            return Err("Port must be between 1 and 65535".into());
        }
        if !matches!(
            (self.scope.as_str(), self.host.as_str()),
            ("localhost", "127.0.0.1") | ("lan", "0.0.0.0")
        ) {
            return Err("Invalid network scope or host".into());
        }
        if self.scope == "lan" && !self.api_keys.iter().any(|k| k.enabled) {
            return Err("LAN access requires an enabled client API key".into());
        }
        if !matches!(
            self.routing_strategy.as_str(),
            "auto"
                | "random"
                | "single_account"
                | "quota_high_first"
                | "quota_low_first"
                | "plan_high_first"
        ) {
            return Err("Unsupported routing strategy".into());
        }
        if self.quota_reserve_percent > 100
            || !(1..=86400).contains(&self.session_affinity_ttl_seconds)
            || !(5..=3600).contains(&self.request_timeout_seconds)
            || self.max_retries > 5
        {
            return Err("Invalid routing limits or timeout".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayStats {
    pub total_requests: u64,
    pub successful_requests: u64,
    pub failed_requests: u64,
    pub total_tokens: u64,
    pub requests_per_second: f64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestLogEntry {
    pub id: String,
    pub timestamp: i64,
    pub method: String,
    pub path: String,
    pub client_model: String,
    pub upstream_model: String,
    pub route_kind: String,
    pub account_id: Option<String>,
    pub account_email: Option<String>,
    pub api_key_id: Option<String>,
    pub status: u16,
    pub duration_ms: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cached_tokens: u64,
    pub reasoning_tokens: u64,
    pub total_tokens: u64,
    pub error: Option<String>,
}
