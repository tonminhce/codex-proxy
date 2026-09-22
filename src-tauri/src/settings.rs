use crate::storage;
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub codex_home: String,
    pub codex_binary: String,
    pub start_gateway_on_launch: bool,
    pub close_to_tray: bool,
    pub context_window: Option<i64>,
    pub compact_limit: Option<i64>,
    pub service_tier: Option<String>,
}
impl Default for AppSettings {
    fn default() -> Self {
        Self {
            codex_home: dirs::home_dir()
                .unwrap_or_default()
                .join(".codex")
                .to_string_lossy()
                .into_owned(),
            codex_binary: if cfg!(target_os = "macos")
                && std::path::Path::new("/opt/homebrew/bin/codex").exists()
            {
                "/opt/homebrew/bin/codex".into()
            } else {
                "codex".into()
            },
            start_gateway_on_launch: false,
            close_to_tray: true,
            context_window: None,
            compact_limit: None,
            service_tier: None,
        }
    }
}
pub struct SettingsManager {
    settings: Mutex<AppSettings>,
    path: PathBuf,
}
impl SettingsManager {
    pub fn new(path: PathBuf) -> Result<Self, String> {
        Ok(Self {
            settings: Mutex::new(storage::read_or_default(&path)?),
            path,
        })
    }
    pub fn get(&self) -> AppSettings {
        self.settings.lock().unwrap().clone()
    }
    pub fn save(&self, settings: AppSettings) -> Result<AppSettings, String> {
        expand_path(&settings.codex_home)?;
        if settings.codex_binary.trim().is_empty() {
            return Err("Codex binary is required".into());
        }
        for value in [settings.context_window, settings.compact_limit]
            .into_iter()
            .flatten()
        {
            if !(1000..=2_000_000).contains(&value) {
                return Err("Token overrides must be between 1,000 and 2,000,000".into());
            }
        }
        if let (Some(context), Some(compact)) = (settings.context_window, settings.compact_limit) {
            if compact >= context {
                return Err("Compact threshold must be below the context window".into());
            }
        }
        if settings
            .service_tier
            .as_deref()
            .is_some_and(|v| v != "fast")
        {
            return Err("Use model default or the documented fast service tier".into());
        }
        let mut lock = self.settings.lock().unwrap();
        storage::write_json(&self.path, &settings)?;
        *lock = settings.clone();
        Ok(settings)
    }
    /// Explicitly requested from the UI. Never runs on startup or ordinary Save.
    pub fn apply_codex_overrides(&self) -> Result<(), String> {
        let settings = self.get();
        let path = expand_path(&settings.codex_home)?.join("config.toml");
        let previous = match std::fs::read_to_string(&path) {
            Ok(v) => v,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(e) => return Err(e.to_string()),
        };
        let mut doc = previous
            .parse::<toml_edit::DocumentMut>()
            .map_err(|_| "Existing Codex config is invalid TOML; it was not modified")?;
        for (key, value) in [
            ("model_context_window", settings.context_window),
            ("model_auto_compact_token_limit", settings.compact_limit),
        ] {
            if let Some(value) = value {
                doc[key] = toml_edit::value(value);
            }
        }
        if let Some(tier) = settings.service_tier {
            doc["service_tier"] = toml_edit::value(tier);
        }
        let backup = path.with_extension("toml.codex-proxy-backup");
        if path.exists() && !backup.exists() {
            storage::write_private(&backup, previous.as_bytes())?;
        }
        storage::write_private(&path, doc.to_string().as_bytes())
    }
}
pub fn expand_path(value: &str) -> Result<PathBuf, String> {
    let path = if let Some(tail) = value.strip_prefix("~/") {
        dirs::home_dir()
            .ok_or("Home directory unavailable")?
            .join(tail)
    } else {
        PathBuf::from(value)
    };
    if !path.is_absolute()
        || path.parent().is_none()
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("Choose an absolute profile directory, without '..'".into());
    }
    Ok(path)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn settings_persist_and_explicit_toml_edit_preserves_unrelated_data() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = SettingsManager::new(dir.path().join("settings.json")).unwrap();
        let mut s = mgr.get();
        s.codex_home = dir.path().join("profile").to_string_lossy().into_owned();
        s.context_window = Some(1000000);
        let profile = expand_path(&s.codex_home).unwrap();
        storage::write_private(
            &profile.join("config.toml"),
            b"# keep me\nmodel = 'test'\n[custom]\nvalue = 3\n",
        )
        .unwrap();
        mgr.save(s).unwrap();
        assert!(!std::fs::read_to_string(profile.join("config.toml"))
            .unwrap()
            .contains("model_context_window"));
        mgr.apply_codex_overrides().unwrap();
        let text = std::fs::read_to_string(profile.join("config.toml")).unwrap();
        assert!(text.contains("# keep me"));
        assert!(text.contains("value = 3"));
        assert!(text.contains("1000000"));
        assert!(profile.join("config.toml.codex-proxy-backup").exists());
    }
}
