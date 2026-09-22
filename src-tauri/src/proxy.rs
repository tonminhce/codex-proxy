use crate::{
    account::AccountManager,
    models::{CodexAccount, CodexAuthMode, GatewayConfig, GatewayStats, RequestLogEntry},
    protocol::{self, SseDecoder},
    storage,
};
use axum::{
    body::{to_bytes, Body, Bytes},
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Router,
};
use futures::StreamExt;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tokio::{net::TcpListener, sync::oneshot};

const MAX_BODY: usize = 16 * 1024 * 1024;
const MAX_LOGS: usize = 500;

struct Runtime {
    shutdown: oneshot::Sender<()>,
    task: tauri::async_runtime::JoinHandle<()>,
}
#[derive(Default)]
struct RoutingState {
    affinity: HashMap<String, (String, Instant)>,
    cooldown: HashMap<String, Instant>,
    rate: HashMap<String, (Instant, u32)>,
}
pub struct ProxyServer {
    engine: Arc<Engine>,
    runtime: tokio::sync::Mutex<Option<Runtime>>,
    storage_path: PathBuf,
}
struct Engine {
    accounts: Arc<AccountManager>,
    config: Mutex<GatewayConfig>,
    running: AtomicBool,
    client: reqwest::Client,
    routing: Mutex<RoutingState>,
    logs: Mutex<VecDeque<RequestLogEntry>>,
    stats: Mutex<GatewayStats>,
    started: Instant,
    instances: Mutex<Option<Arc<crate::instances::InstanceManager>>>,
    shutdown: Mutex<tokio::sync::watch::Sender<bool>>,
}
impl ProxyServer {
    pub fn new(accounts: Arc<AccountManager>, storage_path: PathBuf) -> Result<Self, String> {
        let mut config: GatewayConfig = storage::read_or_default(&storage_path)?;
        config.running = false;
        config.validate()?;
        Ok(Self {
            engine: Arc::new(Engine {
                accounts,
                config: Mutex::new(config),
                running: AtomicBool::new(false),
                client: reqwest::Client::builder()
                    .connect_timeout(Duration::from_secs(10))
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .map_err(|e| e.to_string())?,
                routing: Mutex::new(RoutingState::default()),
                logs: Mutex::new(VecDeque::new()),
                stats: Mutex::new(GatewayStats::default()),
                started: Instant::now(),
                instances: Mutex::new(None),
                shutdown: Mutex::new(tokio::sync::watch::channel(false).0),
            }),
            runtime: tokio::sync::Mutex::new(None),
            storage_path,
        })
    }
    pub fn config(&self) -> GatewayConfig {
        let mut config = self.engine.config.lock().unwrap().clone();
        config.running = self.is_running();
        config
    }
    pub fn set_instances(&self, instances: Arc<crate::instances::InstanceManager>) {
        *self.engine.instances.lock().unwrap() = Some(instances);
    }
    pub fn is_running(&self) -> bool {
        self.engine.running.load(Ordering::SeqCst)
    }
    async fn start_inner(&self, runtime: &mut Option<Runtime>) -> Result<(), String> {
        if self.is_running() {
            return Ok(());
        }
        let config = self.config();
        let listener = TcpListener::bind((config.host.as_str(), config.port))
            .await
            .map_err(|e| format!("Cannot bind gateway: {e}"))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        self.engine.config.lock().unwrap().port = port;
        let (tx, rx) = oneshot::channel();
        *self.engine.shutdown.lock().unwrap() = tokio::sync::watch::channel(false).0;
        let engine = self.engine.clone();
        let router = Router::new().fallback(handle).with_state(engine.clone());
        self.engine.running.store(true, Ordering::SeqCst);
        let task = tauri::async_runtime::spawn(async move {
            if let Err(error) = axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = rx.await;
                })
                .await
            {
                tracing::error!("Gateway server stopped: {error}");
            }
            engine.running.store(false, Ordering::SeqCst);
        });
        *runtime = Some(Runtime { shutdown: tx, task });
        Ok(())
    }
    async fn stop_inner(&self, runtime: &mut Option<Runtime>) {
        self.engine.shutdown.lock().unwrap().send_replace(true);
        if let Some(mut active) = runtime.take() {
            let _ = active.shutdown.send(());
            if tokio::time::timeout(Duration::from_secs(2), &mut active.task)
                .await
                .is_err()
            {
                active.task.abort();
                let _ = active.task.await;
            }
        }
        self.engine.running.store(false, Ordering::SeqCst);
    }
    pub async fn start(&self) -> Result<(), String> {
        let mut runtime = self.runtime.lock().await;
        self.start_inner(&mut runtime).await
    }
    pub async fn stop(&self) {
        let mut runtime = self.runtime.lock().await;
        self.stop_inner(&mut runtime).await;
    }
    pub async fn toggle(&self) -> Result<GatewayConfig, String> {
        let mut runtime = self.runtime.lock().await;
        if self.is_running() {
            self.stop_inner(&mut runtime).await;
        } else {
            self.start_inner(&mut runtime).await?;
        }
        Ok(self.config())
    }
    pub async fn update(&self, mut config: GatewayConfig) -> Result<GatewayConfig, String> {
        config.validate()?;
        let mut runtime = self.runtime.lock().await;
        let old = self.config();
        // Counters are backend-owned; a stale UI must not reset them.
        for key in &mut config.api_keys {
            if let Some(existing) = old.api_keys.iter().find(|k| k.id == key.id) {
                key.total_tokens_used = existing.total_tokens_used;
            }
            if key.key.len() < 24 || key.name.trim().is_empty() {
                return Err("Client keys must have a label and at least 24 characters".into());
            }
        }
        let rebind = old.running && (old.host != config.host || old.port != config.port);
        if rebind {
            self.stop_inner(&mut runtime).await;
        }
        config.running = false;
        *self.engine.config.lock().unwrap() = config.clone();
        let result = async {
            if rebind {
                self.start_inner(&mut runtime).await?;
            }
            storage::write_json(&self.storage_path, &config)
        }
        .await;
        if let Err(error) = result {
            if rebind {
                self.stop_inner(&mut runtime).await;
            }
            *self.engine.config.lock().unwrap() = old.clone();
            if rebind {
                if let Err(restart) = self.start_inner(&mut runtime).await {
                    return Err(format!(
                        "{error}; previous listener could not restart: {restart}"
                    ));
                }
            }
            return Err(error);
        }
        self.engine.routing.lock().unwrap().affinity.clear();
        Ok(self.config())
    }
    pub fn logs(&self) -> Vec<RequestLogEntry> {
        self.engine.logs.lock().unwrap().iter().cloned().collect()
    }
    pub fn clear_logs(&self) {
        self.engine.logs.lock().unwrap().clear();
    }
    pub fn stats(&self) -> GatewayStats {
        let mut stats = self.engine.stats.lock().unwrap().clone();
        stats.requests_per_second =
            stats.total_requests as f64 / self.engine.started.elapsed().as_secs_f64().max(1.0);
        stats
    }
}
fn error(status: u16, message: &str) -> Response {
    (
        StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
        axum::Json(json!({"error":{"message":message,"type":"gateway_error","code":status}})),
    )
        .into_response()
}
fn json_response(value: Value) -> Response {
    axum::Json(value).into_response()
}

struct Record {
    engine: Arc<Engine>,
    entry: RequestLogEntry,
    start: Instant,
}
impl Record {
    fn new(engine: Arc<Engine>, method: &str, path: &str) -> Self {
        Self {
            engine,
            start: Instant::now(),
            entry: RequestLogEntry {
                id: uuid::Uuid::new_v4().to_string(),
                timestamp: chrono::Utc::now().timestamp_millis(),
                method: method.into(),
                path: path.into(),
                status: 499,
                route_kind: "oauth".into(),
                ..Default::default()
            },
        }
    }
    fn fail(&mut self, status: u16, message: &str) -> Response {
        self.entry.status = status;
        self.entry.error = Some(message.into());
        error(status, message)
    }
    fn usage(&mut self, value: &Value) {
        let u = value.get("usage").unwrap_or(value);
        self.entry.input_tokens = u["input_tokens"]
            .as_u64()
            .or_else(|| u["prompt_tokens"].as_u64())
            .unwrap_or(self.entry.input_tokens);
        self.entry.output_tokens = u["output_tokens"]
            .as_u64()
            .or_else(|| u["completion_tokens"].as_u64())
            .unwrap_or(self.entry.output_tokens);
        self.entry.total_tokens = u["total_tokens"]
            .as_u64()
            .unwrap_or(self.entry.input_tokens + self.entry.output_tokens);
        self.entry.cached_tokens = u["input_tokens_details"]["cached_tokens"]
            .as_u64()
            .or_else(|| u["prompt_tokens_details"]["cached_tokens"].as_u64())
            .unwrap_or(self.entry.cached_tokens);
        self.entry.reasoning_tokens = u["output_tokens_details"]["reasoning_tokens"]
            .as_u64()
            .or_else(|| u["completion_tokens_details"]["reasoning_tokens"].as_u64())
            .unwrap_or(self.entry.reasoning_tokens);
    }
}
impl Drop for Record {
    fn drop(&mut self) {
        self.entry.duration_ms = self.start.elapsed().as_millis() as u64;
        let mut stats = self.engine.stats.lock().unwrap();
        stats.total_requests += 1;
        if (200..300).contains(&self.entry.status) {
            stats.successful_requests += 1;
        } else {
            stats.failed_requests += 1;
        }
        stats.total_tokens += self.entry.total_tokens;
        drop(stats);
        if let Some(id) = &self.entry.api_key_id {
            if let Some(key) = self
                .engine
                .config
                .lock()
                .unwrap()
                .api_keys
                .iter_mut()
                .find(|k| &k.id == id)
            {
                key.total_tokens_used += self.entry.total_tokens;
            }
        }
        let mut logs = self.engine.logs.lock().unwrap();
        logs.push_front(self.entry.clone());
        logs.truncate(MAX_LOGS);
    }
}
fn authorize(config: &GatewayConfig, headers: &HeaderMap) -> Result<Option<String>, &'static str> {
    // The gateway is a native client endpoint, not a cross-origin browser service.
    if headers.contains_key("origin") {
        return Err("Browser-origin requests are not allowed");
    }
    if headers.contains_key("sec-fetch-site") {
        return Err("Browser requests are not allowed");
    }
    let supplied = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    if config.api_keys.is_empty() && config.scope == "localhost" && supplied.is_none() {
        return Ok(None);
    }
    config
        .api_keys
        .iter()
        .find(|k| k.enabled && Some(k.key.as_str()) == supplied)
        .map(|k| Some(k.id.clone()))
        .ok_or("Missing or invalid gateway API key")
}
fn quota_remaining(account: &CodexAccount) -> u32 {
    if account.quota.updated_at == 0 || account.auth_mode != CodexAuthMode::OAuth {
        return 100;
    }
    account
        .quota
        .hourly
        .remaining_percent
        .min(account.quota.weekly.remaining_percent)
}
fn candidates(
    engine: &Engine,
    config: &GatewayConfig,
    session: Option<&str>,
    key: &str,
) -> Vec<CodexAccount> {
    let now = Instant::now();
    let mut routing = engine.routing.lock().unwrap();
    routing.cooldown.retain(|_, until| *until > now);
    routing.affinity.retain(|_, (_, until)| *until > now);
    let mut accounts: Vec<_> = engine
        .accounts
        .list()
        .into_iter()
        .filter(|a| {
            a.access_token.as_deref().is_some_and(|v| !v.is_empty())
                && !a.is_cooldown
                && !routing.cooldown.contains_key(&a.id)
                && quota_remaining(a) > config.quota_reserve_percent
                && (config.routing_strategy != "single_account" || a.is_active)
        })
        .collect();
    match config.routing_strategy.as_str() {
        "random" => accounts.sort_by_cached_key(|_| uuid::Uuid::new_v4()),
        "quota_low_first" => accounts.sort_by_key(quota_remaining),
        "plan_high_first" => accounts.sort_by_key(|a| {
            std::cmp::Reverse(match a.plan_type.as_str() {
                "enterprise" => 5,
                "pro" => 4,
                "team" | "business" => 3,
                "plus" => 2,
                _ => 1,
            })
        }),
        _ => accounts.sort_by_key(|a| std::cmp::Reverse((quota_remaining(a), a.is_active))),
    }
    if config.session_affinity {
        if let Some(session) = session {
            if let Some((id, _)) = routing.affinity.get(&format!("{key}:{session}")) {
                if let Some(index) = accounts.iter().position(|a| &a.id == id) {
                    let account = accounts.remove(index);
                    accounts.insert(0, account);
                }
            }
        }
    }
    accounts
}
async fn handle(State(engine): State<Arc<Engine>>, request: Request) -> Response {
    let mut shutdown = engine.shutdown.lock().unwrap().subscribe();
    if *shutdown.borrow() {
        return error(503, "Gateway is stopping");
    }
    tokio::select! {
        response = handle_request(engine, request) => response,
        _ = shutdown.changed() => error(503, "Gateway stopped"),
    }
}
async fn handle_request(engine: Arc<Engine>, request: Request) -> Response {
    let method = request.method().as_str().to_owned();
    let path = request.uri().path().to_owned();
    if method == "GET" && matches!(path.as_str(), "/health" | "/ping") {
        return json_response(json!({"status":"healthy","engine":"rust-in-process"}));
    }
    let mut record = Record::new(engine.clone(), &method, &path);
    if !matches!(
        path.as_str(),
        "/v1/models"
            | "/models"
            | "/v1/responses"
            | "/responses"
            | "/v1/responses/compact"
            | "/responses/compact"
            | "/v1/chat/completions"
            | "/chat/completions"
    ) {
        return record.fail(404, "Unknown gateway endpoint");
    }
    let models = path.ends_with("/models");
    if (models && method != "GET") || (!models && method != "POST") {
        return record.fail(405, "Method not allowed");
    }
    let config = engine.config.lock().unwrap().clone();
    let host = request
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if config.scope == "localhost"
        && ![
            format!("127.0.0.1:{}", config.port),
            format!("localhost:{}", config.port),
        ]
        .contains(&host.to_ascii_lowercase())
    {
        return record.fail(403, "Invalid loopback Host header");
    }
    let key_id = match authorize(&config, request.headers()) {
        Ok(id) => id,
        Err(message) => return record.fail(401, message),
    };
    record.entry.api_key_id = key_id.clone();
    if !models
        && !request
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| {
                v.split(';')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .eq_ignore_ascii_case("application/json")
            })
    {
        return record.fail(415, "Content-Type must be application/json");
    }
    let key = key_id.as_deref().unwrap_or("loopback");
    if config.requests_per_minute > 0 {
        let mut routing = engine.routing.lock().unwrap();
        routing
            .rate
            .retain(|_, (since, _)| since.elapsed() < Duration::from_secs(60));
        let limit = routing
            .rate
            .entry(key.into())
            .or_insert((Instant::now(), 0));
        if limit.1 >= config.requests_per_minute {
            return record.fail(429, "Gateway request rate limit reached");
        }
        limit.1 += 1;
    }
    let session = request
        .headers()
        .get("session_id")
        .or_else(|| request.headers().get("x-session-id"))
        .and_then(|v| v.to_str().ok())
        .filter(|s| s.len() <= 256)
        .map(str::to_owned);
    let headers = request.headers().clone();
    let body = match tokio::time::timeout(
        Duration::from_secs(30),
        to_bytes(request.into_body(), MAX_BODY),
    )
    .await
    {
        Ok(Ok(bytes)) => bytes,
        Ok(Err(_)) => return record.fail(413, "Request exceeds the 16 MiB body limit"),
        Err(_) => return record.fail(408, "Request body timed out"),
    };
    let mut payload: Value = if models {
        Value::Null
    } else {
        match serde_json::from_slice::<Value>(&body) {
            Ok(value) if value.is_object() => value,
            _ => return record.fail(400, "Expected a JSON object"),
        }
    };
    let client_model = payload["model"].as_str().unwrap_or("").to_owned();
    let model = client_model.as_str();
    if !models && (model.is_empty() || model.len() > 256) {
        return record.fail(400, "A valid model is required");
    }
    record.entry.client_model = model.into();
    record.entry.upstream_model = model.into();
    let stream_requested = payload["stream"].as_bool().unwrap_or(false);
    if payload.get("stream").is_some_and(|v| !v.is_boolean()) {
        return record.fail(400, "stream must be a boolean");
    }
    let chat = path.ends_with("/chat/completions");
    let compact = path.ends_with("/responses/compact");
    if compact && stream_requested {
        return record.fail(400, "Compaction is a non-streaming endpoint");
    }
    if !models && !chat && payload.get("input").is_none() {
        return record.fail(400, "Responses input is required");
    }
    if chat && !payload["messages"].is_array() {
        return record.fail(400, "messages must be an array");
    }
    let instance_id = headers
        .get("x-codex-proxy-instance")
        .and_then(|v| v.to_str().ok());
    let route = {
        let instances = engine.instances.lock().unwrap();
        match instances.as_ref() {
            Some(instances) => match instances.resolve(model, instance_id) {
                Ok(route) => route,
                Err(message) => return record.fail(400, &message),
            },
            None if model.contains('/') || instance_id.is_some() => {
                return record.fail(400, "Unknown model namespace or instance")
            }
            _ => None,
        }
    };
    let mut routing_config = config.clone();
    if route.is_some() {
        routing_config.routing_strategy = "auto".into();
    }
    let mut pool = candidates(&engine, &routing_config, session.as_deref(), key);
    if let Some((account_id, upstream_model)) = route {
        pool.retain(|account| account.id == account_id);
        payload["model"] = json!(upstream_model);
        record.entry.upstream_model = upstream_model;
    }
    if pool.is_empty() {
        return record.fail(
            503,
            "No eligible upstream accounts; add an account or refresh quota",
        );
    }
    let mut last_status = 502;
    for (attempt, candidate) in pool.into_iter().take(config.max_retries + 1).enumerate() {
        let account = match engine.accounts.ready_account(&candidate.id).await {
            Ok(a) => a,
            Err(_) => {
                last_status = 401;
                continue;
            }
        };
        let oauth = account.auth_mode == CodexAuthMode::OAuth;
        let mut forwarded = if chat && oauth {
            match protocol::chat_to_responses(&payload) {
                Ok(value) => value,
                Err(message) => return record.fail(400, &message),
            }
        } else {
            payload.clone()
        };
        if !models && oauth && !compact {
            forwarded["stream"] = json!(true);
            forwarded["store"] = json!(false);
            if forwarded.get("instructions").is_none() {
                forwarded["instructions"] = json!("");
            }
            if let Some(input) = forwarded["input"].as_str().map(str::to_owned) {
                forwarded["input"] = json!([{"role":"user","content":input}]);
            }
        } else if !models && !compact {
            forwarded["store"] = json!(false);
        }
        let suffix = if models {
            "models"
        } else if compact {
            "responses/compact"
        } else if chat && !oauth {
            "chat/completions"
        } else {
            "responses"
        };
        let base = if oauth {
            "https://chatgpt.com/backend-api/codex"
        } else {
            account
                .api_base_url
                .as_deref()
                .unwrap_or("https://api.openai.com/v1")
        };
        let url = format!("{}/{suffix}", base.trim_end_matches('/'));
        // Never send credentials back into this gateway.
        if let Ok(parsed) = reqwest::Url::parse(&url) {
            if matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
                && parsed.port_or_known_default() == Some(config.port)
            {
                return record.fail(400, "Upstream URL points back to this gateway");
            }
        }
        let send = |account: &CodexAccount| {
            let mut req = if models {
                engine.client.get(&url)
            } else {
                engine.client.post(&url).json(&forwarded)
            };
            req = req
                .bearer_auth(account.access_token.as_deref().unwrap_or(""))
                .timeout(Duration::from_secs(config.request_timeout_seconds));
            if oauth {
                req = req
                    .header("ChatGPT-Account-Id", &account.id)
                    .header("originator", "codex_cli_rs");
                if models {
                    req = req.query(&[("client_version", "0.115.0")]);
                }
            }
            for name in ["session_id", "x-codex-turn-metadata", "openai-beta"] {
                if let Some(value) = headers.get(name) {
                    req = req.header(name, value);
                }
            }
            req
        };
        let mut response = match send(&account).send().await {
            Ok(response) => response,
            Err(e) => {
                last_status = if e.is_timeout() { 504 } else { 502 };
                continue;
            }
        };
        if response.status() == StatusCode::UNAUTHORIZED && oauth {
            if let Ok(refreshed) = engine
                .accounts
                .refresh_after_rejection(&account.id, account.access_token.as_deref().unwrap_or(""))
                .await
            {
                response = match send(&refreshed).send().await {
                    Ok(response) => response,
                    Err(_) => {
                        last_status = 502;
                        continue;
                    }
                };
            }
        }
        let status = response.status();
        if !status.is_success() {
            last_status = status.as_u16();
            if status == StatusCode::TOO_MANY_REQUESTS {
                let retry = response
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(60)
                    .clamp(1, 3600);
                engine.routing.lock().unwrap().cooldown.insert(
                    account.id.clone(),
                    Instant::now() + Duration::from_secs(retry),
                );
            }
            if status == StatusCode::UNAUTHORIZED
                || status == StatusCode::TOO_MANY_REQUESTS
                || status.is_server_error()
            {
                continue;
            }
            record.entry.account_id = Some(account.id.clone());
            return record.fail(
                status.as_u16(),
                "Upstream rejected the request; check model, account access and parameters",
            );
        }
        record.entry.account_id = Some(account.id.clone());
        record.entry.account_email = Some(account.email);
        record.entry.route_kind = if oauth { "oauth" } else { "provider_gateway" }.into();
        if config.session_affinity {
            if let Some(session) = &session {
                let mut routing = engine.routing.lock().unwrap();
                if routing.affinity.len() >= 4096 {
                    routing.affinity.clear();
                }
                routing.affinity.insert(
                    format!("{key}:{session}"),
                    (
                        account.id,
                        Instant::now()
                            + Duration::from_secs(config.session_affinity_ttl_seconds as u64),
                    ),
                );
            }
        }
        let is_sse = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with("text/event-stream"));
        if models || !is_sse {
            let bytes = match read_limited(response).await {
                Ok(v) => v,
                Err(_) => return record.fail(502, "Invalid or oversized upstream response"),
            };
            let mut value: Value = match serde_json::from_slice(&bytes) {
                Ok(v) => v,
                Err(_) => return record.fail(502, "Upstream did not return JSON"),
            };
            if models && oauth {
                let Some(models) = value["models"].as_array() else {
                    return record.fail(502, "Invalid upstream model catalog");
                };
                value = json!({"object":"list","data":models.iter().filter_map(|m|m["slug"].as_str()).map(|id|json!({"id":id,"object":"model","owned_by":"openai"})).collect::<Vec<_>>()});
            }
            if stream_requested && !models {
                return record.fail(502, "Upstream did not provide the requested event stream");
            }
            record.usage(&value);
            record.entry.status = status.as_u16();
            return json_response(value);
        }
        if !stream_requested {
            let mut decoder = SseDecoder::default();
            let mut upstream = response.bytes_stream();
            while let Some(chunk) = upstream.next().await {
                let bytes = match chunk {
                    Ok(v) => v,
                    Err(_) => return record.fail(502, "Upstream stream interrupted"),
                };
                for event in decoder.push(&bytes) {
                    match event["type"].as_str().unwrap_or("") {
                        "response.completed" | "response.incomplete" => {
                            record.usage(&event["response"]);
                            record.entry.status = 200;
                            return json_response(if chat {
                                protocol::response_to_chat(&event["response"])
                            } else {
                                event["response"].clone()
                            });
                        }
                        "response.failed" | "error" => {
                            return record.fail(502, "Upstream generation failed")
                        }
                        _ => {}
                    }
                }
                if decoder.overflow {
                    return record.fail(502, "Upstream event exceeds size limit");
                }
            }
            return record.fail(502, "Upstream stream ended without a terminal event");
        }
        let mut upstream = response.bytes_stream();
        let mut decoder = SseDecoder::default();
        let mut shutdown = engine.shutdown.lock().unwrap().subscribe();
        let mut adapter = (chat && oauth).then(|| {
            protocol::ChatStream::new(model, payload["stream_options"]["include_usage"] == true)
        });
        let stream = async_stream::stream! {
            let mut record = record;
            let mut terminal = false;
            loop {
                if *shutdown.borrow() {record.entry.status=503; record.entry.error=Some("Gateway stopped".into()); break;}
                let chunk = tokio::select! {
                    chunk = upstream.next() => chunk,
                    _ = shutdown.changed() => {record.entry.status=503; record.entry.error=Some("Gateway stopped".into()); break;}
                };
                let Some(chunk) = chunk else {break;};
                let bytes = match chunk { Ok(v)=>v, Err(_)=>{record.entry.status=502; record.entry.error=Some("Upstream stream interrupted".into()); break;} };
                let events = decoder.push(&bytes);
                let mut converted = String::new();
                for event in events {
                    record.usage(event.get("response").unwrap_or(&event));
                    match event["type"].as_str().unwrap_or("") {
                        "response.completed" | "response.incomplete" | "chat.done" => {terminal=true; record.entry.status=200;},
                        "response.failed" | "error" => {terminal=true; record.entry.status=502; record.entry.error=Some("Upstream generation failed".into());},
                        _=>{}
                    }
                    if let Some(adapter) = &mut adapter { converted.push_str(&adapter.event(&event)); }
                }
                if decoder.overflow {record.entry.status=502; record.entry.error=Some("Upstream event exceeds size limit".into()); break;}
                let output = if adapter.is_some() {Bytes::from(converted)} else {bytes};
                if !output.is_empty() { yield Ok::<Bytes, std::io::Error>(output); }
                if terminal { break; }
            }
            if !terminal {
                if record.entry.status != 503 {record.entry.status=502; record.entry.error=Some("Upstream stream ended before completion".into());}
                yield Err(std::io::Error::other("Upstream stream ended before completion"));
            }
            let _ = attempt;
        };
        return Response::builder()
            .status(status)
            .header("content-type", "text/event-stream")
            .header("cache-control", "no-cache")
            .header("x-accel-buffering", "no")
            .body(Body::from_stream(stream))
            .unwrap();
    }
    record.fail(
        last_status,
        "No upstream request succeeded; check account credentials, quota and connectivity",
    )
}
async fn read_limited(response: reqwest::Response) -> Result<Vec<u8>, ()> {
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|_| ())?;
        if body.len() + bytes.len() > MAX_BODY {
            return Err(());
        }
        body.extend_from_slice(&bytes);
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    async fn server() -> (tempfile::TempDir, Arc<AccountManager>, ProxyServer) {
        let dir = tempfile::tempdir().unwrap();
        let accounts = Arc::new(AccountManager::with_storage(
            dir.path().join("accounts.json"),
        ));
        let proxy = ProxyServer::new(accounts.clone(), dir.path().join("gateway.json")).unwrap();
        proxy.engine.config.lock().unwrap().port = 0;
        proxy.start().await.unwrap();
        (dir, accounts, proxy)
    }
    fn url(proxy: &ProxyServer, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", proxy.config().port)
    }
    #[tokio::test]
    async fn health_stop_restart_and_bind_failure() {
        let (_dir, _, proxy) = server().await;
        let client = reqwest::Client::new();
        assert_eq!(
            client
                .get(url(&proxy, "/health"))
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        let port = proxy.config().port;
        let other = TcpListener::bind(("127.0.0.1", port)).await;
        assert!(other.is_err());
        proxy.stop().await;
        let listener = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
        assert!(proxy.start().await.is_err());
        assert!(!proxy.is_running());
        drop(listener);
        proxy.start().await.unwrap();
        proxy.stop().await;
    }
    #[tokio::test]
    async fn no_canned_responses_and_strict_endpoints() {
        let (_dir, _, proxy) = server().await;
        let client = reqwest::Client::new();
        assert_eq!(
            client
                .get(url(&proxy, "/unknown"))
                .send()
                .await
                .unwrap()
                .status(),
            404
        );
        assert_eq!(
            client
                .get(url(&proxy, "/v1/responses"))
                .send()
                .await
                .unwrap()
                .status(),
            405
        );
        assert_eq!(
            client
                .post(url(&proxy, "/v1/responses"))
                .json(&json!({"model":"test","input":"hi"}))
                .send()
                .await
                .unwrap()
                .status(),
            503
        );
        assert_eq!(proxy.stats().total_requests, 3);
        proxy.stop().await;
    }
    #[tokio::test]
    async fn fragmented_large_body_stream_and_usage_forwarding() {
        let (_dir, accounts, proxy) = server().await;
        let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let upstream_port = upstream.local_addr().unwrap().port();
        accounts.import_from_json(&json!({"apiKey":"synthetic-key","apiBaseUrl":format!("http://127.0.0.1:{upstream_port}/v1")}).to_string()).unwrap();
        let worker = tokio::spawn(async move {
            let (mut socket, _) = upstream.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0; 2048];
            loop {
                let n = socket.read(&mut buffer).await.unwrap();
                assert!(n > 0);
                request.extend_from_slice(&buffer[..n]);
                if let Some(pos) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..pos]);
                    let length = headers
                        .lines()
                        .find_map(|l| {
                            l.to_lowercase()
                                .strip_prefix("content-length: ")
                                .and_then(|v| v.parse::<usize>().ok())
                        })
                        .unwrap();
                    if request.len() >= pos + 4 + length {
                        break;
                    }
                }
            }
            assert!(request.len() > 4096);
            let request = String::from_utf8(request).unwrap();
            assert!(request.contains("Bearer synthetic-key"));
            assert!(!request.contains("local-client-secret"));
            let body="event: response.created\ndata: {\"type\":\"response.created\",\"response\":{\"id\":\"real\"}}\n\nevent: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"id\":\"real\",\"usage\":{\"input_tokens\":7,\"output_tokens\":5,\"total_tokens\":12}}}\n\n";
            socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len()).as_bytes()).await.unwrap();
            for chunk in body.as_bytes().chunks(7) {
                socket.write_all(chunk).await.unwrap();
                tokio::task::yield_now().await;
            }
        });
        let body = json!({"model":"test-model","input":"x".repeat(20000),"stream":true});
        let response = reqwest::Client::new()
            .post(url(&proxy, "/v1/responses"))
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert!(response
            .text()
            .await
            .unwrap()
            .contains("response.completed"));
        worker.await.unwrap();
        assert_eq!(proxy.stats().total_tokens, 12);
        assert_eq!(proxy.logs()[0].client_model, "test-model");
        proxy.stop().await;
    }
    #[tokio::test]
    async fn keys_are_enforced_and_origins_rejected() {
        let (_dir, _, proxy) = server().await;
        let mut config = proxy.config();
        config.api_keys.push(crate::models::ClientApiKey {
            id: "key".into(),
            name: "Test".into(),
            key: "synthetic-local-client-secret".into(),
            enabled: true,
            total_tokens_used: 0,
            created_at: 0,
        });
        proxy.update(config).await.unwrap();
        let client = reqwest::Client::new();
        assert_eq!(
            client
                .get(url(&proxy, "/v1/models"))
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
        assert_eq!(
            client
                .get(url(&proxy, "/v1/models"))
                .bearer_auth("synthetic-local-client-secret")
                .send()
                .await
                .unwrap()
                .status(),
            503
        );
        assert_eq!(
            client
                .get(url(&proxy, "/v1/models"))
                .bearer_auth("synthetic-local-client-secret")
                .header("origin", "https://example.com")
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
        proxy.stop().await;
    }
    #[test]
    fn routing_respects_affinity_quota_and_single_account() {
        let dir = tempfile::tempdir().unwrap();
        let accounts = Arc::new(AccountManager::with_storage(
            dir.path().join("accounts.json"),
        ));
        accounts
            .import_from_json(r#"[{"apiKey":"synthetic-a"},{"apiKey":"synthetic-b"}]"#)
            .unwrap();
        let proxy = ProxyServer::new(accounts.clone(), dir.path().join("gateway.json")).unwrap();
        let mut config = proxy.config();
        config.routing_strategy = "single_account".into();
        assert_eq!(candidates(&proxy.engine, &config, None, "local").len(), 1);
        config.routing_strategy = "auto".into();
        let id = accounts.list()[1].id.clone();
        proxy.engine.routing.lock().unwrap().affinity.insert(
            "local:session".into(),
            (id.clone(), Instant::now() + Duration::from_secs(60)),
        );
        assert_eq!(
            candidates(&proxy.engine, &config, Some("session"), "local")[0].id,
            id
        );
    }

    async fn mock_upstream(
        status: u16,
        content_type: &'static str,
        body: &'static str,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/v1", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            let app = Router::new().fallback(move || async move {
                (
                    StatusCode::from_u16(status).unwrap(),
                    [("content-type", content_type)],
                    body,
                )
            });
            axum::serve(listener, app).await.unwrap();
        });
        (base, task)
    }
    fn add_upstream(accounts: &AccountManager, base: &str, key: &str) {
        accounts
            .import_from_json(&json!({"apiKey":key,"apiBaseUrl":base}).to_string())
            .unwrap();
    }
    #[tokio::test]
    async fn nonstream_responses_and_chat_passthrough() {
        let (_dir, accounts, proxy) = server().await;
        let (base,upstream)=mock_upstream(200,"application/json",r#"{"id":"upstream-result","usage":{"total_tokens":9},"choices":[{"message":{"content":"actual"}}]}"#).await;
        add_upstream(&accounts, &base, "synthetic");
        let response = reqwest::Client::new()
            .post(url(&proxy, "/v1/chat/completions"))
            .json(&json!({"model":"test","messages":[{"role":"user","content":"hi"}]}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(
            response.json::<Value>().await.unwrap()["id"],
            "upstream-result"
        );
        assert_eq!(proxy.stats().total_tokens, 9);
        proxy.stop().await;
        upstream.abort();
    }
    #[tokio::test]
    async fn rate_limit_rotates_once_and_records_the_actual_account() {
        let (_dir, accounts, proxy) = server().await;
        let (first, a) = mock_upstream(429, "application/json", r#"{"error":"limited"}"#).await;
        let (second, b) =
            mock_upstream(200, "application/json", r#"{"id":"second","output":[]}"#).await;
        add_upstream(&accounts, &first, "synthetic-a");
        add_upstream(&accounts, &second, "synthetic-b");
        let response = reqwest::Client::new()
            .post(url(&proxy, "/v1/responses"))
            .json(&json!({"model":"test","input":"hi"}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.json::<Value>().await.unwrap()["id"], "second");
        assert_eq!(
            proxy.logs()[0].account_id,
            Some(accounts.list()[1].id.clone())
        );
        assert!(proxy
            .engine
            .routing
            .lock()
            .unwrap()
            .cooldown
            .contains_key(&accounts.list()[0].id));
        proxy.stop().await;
        a.abort();
        b.abort();
    }
    #[tokio::test]
    async fn truncated_sse_is_an_error_not_a_fabricated_completion() {
        let (_dir, accounts, proxy) = server().await;
        let (base, upstream) = mock_upstream(
            200,
            "text/event-stream",
            "data: {\"type\":\"response.created\"}\n\n",
        )
        .await;
        add_upstream(&accounts, &base, "synthetic");
        let client = reqwest::Client::new();
        let response = client
            .post(url(&proxy, "/v1/responses"))
            .json(&json!({"model":"test","input":"hi"}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 502);
        let response = client
            .post(url(&proxy, "/v1/responses"))
            .json(&json!({"model":"test","input":"hi","stream":true}))
            .send()
            .await;
        if let Ok(response) = response {
            assert!(response.text().await.is_err());
        }
        assert_eq!(proxy.stats().successful_requests, 0);
        proxy.stop().await;
        upstream.abort();
    }
    #[tokio::test]
    async fn config_rebind_failure_restores_old_listener_and_disk() {
        let (dir, _, proxy) = server().await;
        let before = proxy.config();
        proxy.update(before.clone()).await.unwrap();
        let occupied = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut config = before.clone();
        config.port = occupied.local_addr().unwrap().port();
        assert!(proxy.update(config).await.is_err());
        assert!(proxy.is_running());
        assert_eq!(proxy.config().port, before.port);
        let saved: GatewayConfig =
            storage::read_or_default(&dir.path().join("gateway.json")).unwrap();
        assert_eq!(saved.port, before.port);
        assert_eq!(
            reqwest::get(url(&proxy, "/health")).await.unwrap().status(),
            200
        );
        proxy.stop().await;
    }
    #[tokio::test]
    async fn invalid_json_oversized_body_rate_and_browser_requests_are_rejected() {
        let (_dir, _, proxy) = server().await;
        let client = reqwest::Client::new();
        let endpoint = url(&proxy, "/v1/responses");
        assert_eq!(
            client
                .post(&endpoint)
                .header("content-type", "application/json")
                .body("{")
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
        assert_eq!(
            client
                .post(&endpoint)
                .body("plain")
                .send()
                .await
                .unwrap()
                .status(),
            415
        );
        assert_eq!(
            client
                .post(&endpoint)
                .header("content-type", "application/json")
                .body(vec![b'x'; MAX_BODY + 1])
                .send()
                .await
                .unwrap()
                .status(),
            413
        );
        assert_eq!(
            client
                .get(url(&proxy, "/v1/models"))
                .header("host", "attacker.invalid")
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
        let mut config = proxy.config();
        config.requests_per_minute = 1;
        proxy.update(config).await.unwrap();
        assert_eq!(
            client
                .get(url(&proxy, "/v1/models"))
                .send()
                .await
                .unwrap()
                .status(),
            503
        );
        assert_eq!(
            client
                .get(url(&proxy, "/v1/models"))
                .send()
                .await
                .unwrap()
                .status(),
            429
        );
        proxy.stop().await;
    }
    #[tokio::test]
    async fn stop_cancels_an_inflight_stream_and_releases_port() {
        let (_dir, accounts, proxy) = server().await;
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        add_upstream(
            &accounts,
            &format!("http://{}/v1", listener.local_addr().unwrap()),
            "synthetic",
        );
        let upstream = tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new().fallback(|| async {
                    let chunks = futures::stream::once(async {
                        Ok::<_, std::io::Error>(Bytes::from_static(
                            b"data: {\"type\":\"response.created\"}\n\n",
                        ))
                    })
                    .chain(futures::stream::pending());
                    Response::builder()
                        .header("content-type", "text/event-stream")
                        .body(Body::from_stream(chunks))
                        .unwrap()
                }),
            )
            .await
            .unwrap();
        });
        let response = reqwest::Client::new()
            .post(url(&proxy, "/v1/responses"))
            .json(&json!({"model":"test","input":"hi","stream":true}))
            .send()
            .await
            .unwrap();
        let port = proxy.config().port;
        tokio::time::timeout(Duration::from_secs(3), proxy.stop())
            .await
            .unwrap();
        assert!(
            tokio::time::timeout(Duration::from_secs(2), response.text())
                .await
                .unwrap()
                .is_err()
        );
        let _available = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
        upstream.abort();
    }
}
