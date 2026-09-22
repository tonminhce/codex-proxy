//! Local, atomic persistence. Never truncate the last good copy on failure.
use serde::{de::DeserializeOwned, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

pub fn data_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|p| p.join(".codex-proxy"))
        .ok_or("Home directory unavailable".into())
}

pub fn read_or_default<T: DeserializeOwned + Default>(path: &Path) -> Result<T, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| {
            format!(
                "Invalid local data in {}; restore or repair this file",
                path.display()
            )
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(format!("Cannot read {}: {e}", path.display())),
    }
}

pub fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    write_private(path, &bytes)
}

pub fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or("Storage path needs a parent directory")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = parent.join(format!(".codex-proxy-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp).map_err(|e| e.to_string())?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&tmp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn private_atomic_roundtrip_and_corruption_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        write_json(&path, &vec![1, 2]).unwrap();
        assert_eq!(read_or_default::<Vec<u32>>(&path).unwrap(), vec![1, 2]);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        write_private(&path, b"broken").unwrap();
        assert!(read_or_default::<Vec<u32>>(&path).is_err());
    }
}
