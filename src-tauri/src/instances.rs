//! Owned Codex app-server processes and isolated profile definitions (not proxy sidecars).
use crate::{
    account::{validate_base_url, AccountManager},
    models::{CodexAuthMode, GatewayConfig},
    settings::{expand_path, SettingsManager},
    storage,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRoute {
    pub id: String,
    pub namespace: String,
    pub provider_name: String,
    pub provider_base_url: String,
    pub upstream_model: String,
    pub enabled: bool,
    #[serde(default)]
    pub account_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexInstance {
    pub id: String,
    pub name: String,
    pub profile_path: String,
    #[serde(default, skip_deserializing)]
    pub is_running: bool,
    #[serde(default, skip_deserializing)]
    pub pid: Option<u32>,
    #[serde(default, skip_deserializing)]
    pub endpoint: Option<String>,
    pub bound_account_id: Option<String>,
    pub mixed_routing_enabled: bool,
    pub routes: Vec<ModelRoute>,
    pub created_at: i64,
    pub last_launched_at: Option<i64>,
}
struct ManagedChild {
    child: tokio::process::Child,
    endpoint: String,
}
pub struct InstanceManager {
    instances: Mutex<Vec<CodexInstance>>,
    children: tokio::sync::Mutex<HashMap<String, ManagedChild>>,
    path: PathBuf,
    accounts: Arc<AccountManager>,
    settings: Arc<SettingsManager>,
}
impl InstanceManager {
    pub fn new(
        path: PathBuf,
        accounts: Arc<AccountManager>,
        settings: Arc<SettingsManager>,
    ) -> Result<Self, String> {
        Ok(Self {
            instances: Mutex::new(storage::read_or_default(&path)?),
            children: Default::default(),
            path,
            accounts,
            settings,
        })
    }
    pub async fn list(&self) -> Vec<CodexInstance> {
        let mut children = self.children.lock().await;
        children.retain(|_, managed| matches!(managed.child.try_wait(), Ok(None)));
        let mut instances = self.instances.lock().unwrap().clone();
        for instance in &mut instances {
            if let Some(managed) = children.get(&instance.id) {
                instance.is_running = true;
                instance.pid = managed.child.id();
                instance.endpoint = Some(managed.endpoint.clone());
            }
        }
        instances
    }
    pub async fn save(&self, mut instance: CodexInstance) -> Result<CodexInstance, String> {
        let children = self.children.lock().await;
        if children.contains_key(&instance.id) {
            return Err("Stop this instance before editing its profile or routes".into());
        }
        if instance.name.trim().is_empty() {
            return Err("Instance name is required".into());
        }
        if let Some(id) = &instance.bound_account_id {
            self.accounts.get(id)?;
        }
        if instance.id.is_empty() {
            instance.id = uuid::Uuid::new_v4().to_string();
            instance.created_at = chrono::Utc::now().timestamp_millis();
        }
        let root = self
            .path
            .parent()
            .ok_or("Invalid instance storage")?
            .join("profiles");
        if instance.profile_path.trim().is_empty() {
            instance.profile_path = root.join(&instance.id).to_string_lossy().into_owned();
        }
        let profile = expand_path(&instance.profile_path)?;
        if !profile.starts_with(&root) || profile == root {
            return Err(format!(
                "Isolated profiles must be inside {}",
                root.display()
            ));
        }
        // Canonicalize existing ancestors to prevent a symlink escaping the owned profile root.
        let mut ancestor = profile.as_path();
        while !ancestor.exists() {
            ancestor = ancestor.parent().ok_or("Invalid profile path")?;
        }
        if ancestor != root.parent().unwrap_or(&root)
            && ancestor.canonicalize().map_err(|e| e.to_string())? != ancestor
        {
            return Err("Symlinked profile directories are not supported".into());
        }
        instance.profile_path = profile.to_string_lossy().into_owned();
        instance.is_running = false;
        instance.pid = None;
        instance.endpoint = None;
        let mut lock = self.instances.lock().unwrap();
        let mut next = lock.clone();
        if next
            .iter()
            .any(|i| i.id != instance.id && i.profile_path == instance.profile_path)
        {
            return Err("Another instance owns this profile path".into());
        }
        let mut namespaces = std::collections::HashSet::new();
        for route in &mut instance.routes {
            if route.id.is_empty() {
                route.id = uuid::Uuid::new_v4().to_string();
            }
            if route.namespace.is_empty()
                || !route
                    .namespace
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
                || route.upstream_model.trim().is_empty()
            {
                return Err("Invalid namespace or upstream model".into());
            }
            if !namespaces.insert(route.namespace.clone())
                || next
                    .iter()
                    .filter(|i| i.id != instance.id)
                    .flat_map(|i| &i.routes)
                    .any(|r| r.namespace == route.namespace)
            {
                return Err("Route namespaces must be unique across instances".into());
            }
            validate_base_url(&route.provider_base_url)?;
            let account = self.accounts.get(&route.account_id)?;
            if account.auth_mode != CodexAuthMode::ApiKey
                || account
                    .api_base_url
                    .as_deref()
                    .unwrap_or("https://api.openai.com/v1")
                    .trim_end_matches('/')
                    != route.provider_base_url.trim_end_matches('/')
            {
                return Err("Select an API-key account registered for exactly this upstream URL; OAuth tokens cannot be forwarded to custom providers".into());
            }
        }
        instance.mixed_routing_enabled = instance.routes.iter().any(|r| r.enabled);
        if let Some(old) = next.iter_mut().find(|i| i.id == instance.id) {
            instance.created_at = old.created_at;
            instance.last_launched_at = old.last_launched_at;
            *old = instance.clone();
        } else {
            next.push(instance.clone());
        }
        storage::write_json(&self.path, &next)?;
        *lock = next;
        Ok(instance)
    }
    pub async fn delete(&self, id: &str) -> Result<(), String> {
        let children = self.children.lock().await;
        if children.contains_key(id) {
            return Err("Stop the instance before removing it".into());
        }
        let mut lock = self.instances.lock().unwrap();
        let mut next = lock.clone();
        next.retain(|i| i.id != id);
        storage::write_json(&self.path, &next)?;
        *lock = next;
        Ok(())
    }
    pub fn resolve(
        &self,
        model: &str,
        instance_id: Option<&str>,
    ) -> Result<Option<(String, String)>, String> {
        let lock = self.instances.lock().unwrap();
        let instance = if let Some(id) = instance_id {
            Some(
                lock.iter()
                    .find(|i| i.id == id)
                    .ok_or("Unknown Codex instance")?,
            )
        } else {
            None
        };
        if let Some((namespace, _)) = model.split_once('/') {
            let route = lock
                .iter()
                .filter(|i| instance.is_none_or(|selected| selected.id == i.id))
                .flat_map(|i| &i.routes)
                .find(|r| r.enabled && r.namespace == namespace)
                .ok_or("Unknown or disabled model namespace")?;
            let account = self.accounts.get(&route.account_id)?;
            if account.auth_mode != CodexAuthMode::ApiKey
                || account
                    .api_base_url
                    .as_deref()
                    .unwrap_or("https://api.openai.com/v1")
                    .trim_end_matches('/')
                    != route.provider_base_url.trim_end_matches('/')
            {
                return Err("Route credentials no longer match the configured provider".into());
            }
            Ok(Some((
                route.account_id.clone(),
                route.upstream_model.clone(),
            )))
        } else {
            Ok(instance
                .and_then(|i| i.bound_account_id.clone())
                .map(|id| (id, model.into())))
        }
    }
    pub async fn toggle(&self, id: &str, gateway: &GatewayConfig) -> Result<(), String> {
        let mut children = self.children.lock().await;
        if let Some(mut managed) = children.remove(id) {
            managed.child.kill().await.map_err(|e| e.to_string())?;
            return Ok(());
        }
        if !gateway.running {
            return Err("Start the gateway before launching an instance".into());
        }
        let instance = self
            .instances
            .lock()
            .unwrap()
            .iter()
            .find(|i| i.id == id)
            .cloned()
            .ok_or("Instance not found")?;
        let profile = expand_path(&instance.profile_path)?;
        let marker = profile.join(".codex-proxy-owner");
        let root = self
            .path
            .parent()
            .ok_or("Invalid instance storage")?
            .join("profiles");
        if !profile.starts_with(&root) || profile == root {
            return Err("Invalid isolated profile directory".into());
        }
        if profile.exists() && profile.canonicalize().map_err(|e| e.to_string())? != profile {
            return Err("Symlinked profile directories are not supported".into());
        }
        if profile.exists() && std::fs::read_to_string(&marker).ok().as_deref() != Some(id) {
            return Err(
                "Existing profile is not owned by this instance; choose an empty profile path"
                    .into(),
            );
        }
        storage::write_private(&marker, id.as_bytes())?;
        let existing = match std::fs::read_to_string(profile.join("config.toml")) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(e) => return Err(e.to_string()),
        };
        let mut doc = existing
            .parse::<toml_edit::DocumentMut>()
            .map_err(|_| "Invalid profile TOML; it was not modified")?;
        doc["model_provider"] = toml_edit::value("codex_local_access");
        doc["model_providers"]["codex_local_access"]["name"] = toml_edit::value("CodexProxy");
        doc["model_providers"]["codex_local_access"]["base_url"] =
            toml_edit::value(format!("http://127.0.0.1:{}/v1", gateway.port));
        doc["model_providers"]["codex_local_access"]["wire_api"] = toml_edit::value("responses");
        doc["model_providers"]["codex_local_access"]["requires_openai_auth"] =
            toml_edit::value(false);
        doc["model_providers"]["codex_local_access"]["supports_websockets"] =
            toml_edit::value(false);
        doc["model_providers"]["codex_local_access"]["http_headers"]["x-codex-proxy-instance"] =
            toml_edit::value(id);
        doc["analytics"]["enabled"] = toml_edit::value(false);
        doc["feedback"]["enabled"] = toml_edit::value(false);
        doc["cli_auth_credentials_store"] = toml_edit::value("file");
        let key = gateway.api_keys.iter().find(|k| k.enabled);
        if !gateway.api_keys.is_empty() && key.is_none() {
            return Err("Enable a gateway client API key before launching".into());
        }
        if key.is_some() {
            doc["model_providers"]["codex_local_access"]["env_key"] =
                toml_edit::value("CODEX_PROXY_CLIENT_KEY");
        } else if let Some(provider) = doc["model_providers"]["codex_local_access"].as_table_mut() {
            provider.remove("env_key");
        }
        storage::write_private(&profile.join("config.toml"), doc.to_string().as_bytes())?;
        // No shared auth.json is copied; gateway routing supplies upstream credentials.
        let reservation = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = reservation.local_addr().map_err(|e| e.to_string())?.port();
        drop(reservation);
        let endpoint = format!("ws://127.0.0.1:{port}");
        let mut command = tokio::process::Command::new(self.settings.get().codex_binary);
        command
            .args(["app-server", "--listen", &endpoint])
            .env("CODEX_HOME", &profile)
            .env_remove("OPENAI_API_KEY")
            .env_remove("CODEX_API_KEY")
            .env_remove("CODEX_ACCESS_TOKEN")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        if let Some(key) = key {
            command.env("CODEX_PROXY_CLIENT_KEY", &key.key);
        } else {
            command.env_remove("CODEX_PROXY_CLIENT_KEY");
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("Could not launch Codex: {e}"))?;
        let ready=tokio::time::timeout(Duration::from_secs(10),async{
            loop{
                if child.try_wait().map_err(|e|e.to_string())?.is_some(){return Err("Codex app-server exited during startup; check the binary and configuration".to_string());}
                if tokio::net::TcpStream::connect(("127.0.0.1",port)).await.is_ok(){return Ok(());}
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }).await.map_err(|_|"Codex startup timed out")?;
        ready?;
        {
            let mut lock = self.instances.lock().unwrap();
            let mut next = lock.clone();
            if let Some(i) = next.iter_mut().find(|i| i.id == id) {
                i.last_launched_at = Some(chrono::Utc::now().timestamp_millis());
            }
            storage::write_json(&self.path, &next)?;
            *lock = next;
        }
        children.insert(id.into(), ManagedChild { child, endpoint });
        Ok(())
    }
    pub async fn stop_all(&self) {
        let mut children = self.children.lock().await;
        for (_, mut managed) in children.drain() {
            let _ = managed.child.kill().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn profiles_and_routes_persist_without_fake_processes() {
        let dir = tempfile::tempdir().unwrap();
        let accounts = Arc::new(AccountManager::with_storage(
            dir.path().join("accounts.json"),
        ));
        let settings = Arc::new(SettingsManager::new(dir.path().join("settings.json")).unwrap());
        let mgr =
            InstanceManager::new(dir.path().join("instances.json"), accounts, settings).unwrap();
        let i = CodexInstance {
            id: String::new(),
            name: "Test".into(),
            profile_path: String::new(),
            is_running: true,
            pid: Some(123),
            endpoint: None,
            bound_account_id: None,
            mixed_routing_enabled: false,
            routes: vec![],
            created_at: 0,
            last_launched_at: None,
        };
        let saved = mgr.save(i).await.unwrap();
        assert!(!saved.is_running);
        assert!(saved.pid.is_none());
        assert!(mgr.resolve("missing/model", None).is_err());
        mgr.delete(&saved.id).await.unwrap();
        assert!(mgr.list().await.is_empty());
    }
}
