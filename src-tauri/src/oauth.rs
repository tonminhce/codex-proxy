use crate::account::{decode_jwt_payload_value, AccountManager};
use crate::models::{CodexAccount, CodexAuthMode, CodexQuota};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_URL: &str = "https://auth.openai.com/authorize";
const TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const SCOPES: &str =
    "openid profile email offline_access api.connectors.read api.connectors.invoke";

pub async fn perform_pkce_oauth_login(
    account_manager: Arc<AccountManager>,
) -> Result<CodexAccount, String> {
    // 1. Generate code_verifier (32 bytes random base64url)
    let random_bytes: Vec<u8> = (0..32)
        .map(|_| (uuid::Uuid::new_v4().as_u128() & 0xFF) as u8)
        .collect();
    let code_verifier = URL_SAFE_NO_PAD.encode(&random_bytes);

    // 2. Generate code_challenge (S256)
    let mut hasher = Sha256::new();
    hasher.update(code_verifier.as_bytes());
    let hash = hasher.finalize();
    let code_challenge = URL_SAFE_NO_PAD.encode(hash);

    // 3. Generate state
    let state_token = uuid::Uuid::new_v4().to_string();

    // 4. Bind local TCP listener on available loopback port
    let listener = TcpListener::bind("127.0.0.1:1455")
        .await
        .map_err(|e| format!("Failed to bind local loopback listener: {}", e))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://localhost:{}/auth/callback", port);

    // 5. Build Auth URL
    let encoded_redirect = url_encode(&redirect_uri);
    let encoded_scope = url_encode(SCOPES);
    let full_auth_url = format!(
        "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&code_challenge={}&code_challenge_method=S256&id_token_add_organizations=true&codex_cli_simplified_flow=true&state={}&originator=codex_cli_rs",
        AUTH_URL, CLIENT_ID, encoded_redirect, encoded_scope, code_challenge, state_token
    );

    tracing::info!("Starting OpenAI OAuth login on port {}", port);

    // 6. Open the browser
    open_browser(&full_auth_url)?;

    // 7. Wait for callback with a 180s timeout
    let timeout = tokio::time::Duration::from_secs(180);
    let auth_code = tokio::select! {
        res = wait_for_callback(listener, &state_token) => {
            res?
        }
        _ = tokio::time::sleep(timeout) => {
            return Err("OAuth login timed out waiting for browser authorization".to_string());
        }
    };

    tracing::info!("Received authorization code, exchanging for tokens...");

    // 8. Exchange code for tokens
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let exchange_params = [
        ("grant_type", "authorization_code"),
        ("code", auth_code.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("client_id", CLIENT_ID),
        ("code_verifier", code_verifier.as_str()),
    ];

    let resp = client
        .post(TOKEN_URL)
        .form(&exchange_params)
        .send()
        .await
        .map_err(|e| format!("Token exchange request failed: {}", e))?;

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Token exchange rejected (HTTP {})",
            status.as_u16()
        ));
    }

    let token_data: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse token response JSON: {}", e))?;

    let access_token = token_data
        .get("access_token")
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty())
        .ok_or("Token response omitted access_token")?
        .to_string();
    let refresh_token = token_data
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let id_token = token_data
        .get("id_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    if id_token.as_deref().is_none_or(|v| v.is_empty()) {
        return Err("Token response omitted id_token".into());
    }

    // 9. Extract user info from id_token / access_token
    let claims = id_token
        .as_deref()
        .and_then(decode_jwt_payload_value)
        .or_else(|| decode_jwt_payload_value(&access_token));

    let email = claims
        .as_ref()
        .and_then(|c| c.get("email").and_then(|e| e.as_str()))
        .unwrap_or("user@openai.com")
        .to_string();

    let account_id = claims
        .as_ref()
        .and_then(|c| c.get("https://api.openai.com/auth"))
        .and_then(|a| a.get("chatgpt_account_id").and_then(|id| id.as_str()))
        .map(|s| s.to_string())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let plan_type = claims
        .as_ref()
        .and_then(|c| c.get("https://api.openai.com/auth"))
        .and_then(|a| a.get("chatgpt_plan_type").and_then(|p| p.as_str()))
        .unwrap_or("unknown")
        .to_string();

    let name = claims
        .as_ref()
        .and_then(|c| c.get("https://api.openai.com/profile"))
        .and_then(|p| p.get("name").and_then(|n| n.as_str()))
        .map(|s| s.to_string())
        .or_else(|| {
            claims
                .as_ref()
                .and_then(|c| c.get("name").and_then(|n| n.as_str()))
                .map(|s| s.to_string())
        });

    let new_account = CodexAccount {
        id: account_id,
        email,
        name,
        auth_mode: CodexAuthMode::OAuth,
        plan_type,
        is_active: false,
        is_cooldown: false,
        quota: CodexQuota::default(),
        created_at: chrono::Utc::now().timestamp_millis(),
        last_used_at: None,
        access_token: Some(access_token),
        refresh_token,
        id_token,
        api_base_url: None,
    };

    account_manager.add(new_account.clone())?;

    // Trigger initial quota fetch in background
    let acc_id = new_account.id.clone();
    let mgr = account_manager.clone();
    tauri::async_runtime::spawn(async move {
        let _ = mgr.refresh_quota(&acc_id).await;
    });

    tracing::info!("Successfully connected an OpenAI Codex account");
    account_manager.get(&new_account.id)
}

fn callback_code(target: &str, expected_state: &str) -> Result<Option<String>, String> {
    let url = reqwest::Url::parse(&format!("http://localhost{target}"))
        .map_err(|_| "Invalid callback URL")?;
    if url.path() != "/auth/callback" {
        return Ok(None);
    }
    let pairs: Vec<_> = url.query_pairs().collect();
    let states: Vec<_> = pairs.iter().filter(|(k, _)| k == "state").collect();
    if states.len() != 1 || states[0].1 != expected_state {
        return Ok(None);
    }
    if pairs.iter().any(|(k, _)| k == "error") {
        return Err("Authorization was declined; try signing in again".into());
    }
    let codes: Vec<_> = pairs.iter().filter(|(k, _)| k == "code").collect();
    if codes.len() != 1 || codes[0].1.is_empty() {
        return Err("Authorization callback omitted a valid code".into());
    }
    Ok(Some(codes[0].1.to_string()))
}
async fn wait_for_callback(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    loop {
        let (mut socket, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let read = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            let mut bytes = Vec::new();
            let mut buffer = [0; 1024];
            loop {
                let n = socket
                    .read(&mut buffer)
                    .await
                    .map_err(|_| "Callback read failed")?;
                if n == 0 {
                    return Err("Incomplete callback");
                }
                bytes.extend_from_slice(&buffer[..n]);
                if bytes.len() > 16384 {
                    return Err("Callback too large");
                }
                if bytes.windows(4).any(|w| w == b"\r\n\r\n") {
                    return Ok(bytes);
                }
            }
        })
        .await;
        let Ok(Ok(bytes)) = read else {
            continue;
        };
        let request = String::from_utf8_lossy(&bytes);
        let mut parts = request.lines().next().unwrap_or("").split_whitespace();
        let method = parts.next().unwrap_or("");
        let target = parts.next().unwrap_or("");
        let result = if method == "GET" {
            callback_code(target, expected_state)
        } else {
            Ok(None)
        };
        let (status, message) = match &result {
            Ok(Some(_)) => (
                "200 OK",
                "Authorization received. Return to CodexProxy to confirm token exchange completed.",
            ),
            Err(_) => (
                "400 Bad Request",
                "Authorization failed. Return to CodexProxy and try again.",
            ),
            _ => ("404 Not Found", "Invalid authorization callback."),
        };
        let response=format!("HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{message}",message.len());
        let _ = socket.write_all(response.as_bytes()).await;
        match result {
            Ok(Some(code)) => return Ok(code),
            Err(e) => return Err(e),
            _ => {}
        }
    }
}

fn open_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", url])
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
        Ok(())
    }
}

fn url_encode(input: &str) -> String {
    let mut out = String::new();
    for b in input.bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pkce_challenge_generation() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let mut hasher = Sha256::new();
        hasher.update(verifier.as_bytes());
        let hash = hasher.finalize();
        let challenge = URL_SAFE_NO_PAD.encode(hash);
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        assert!(!challenge.contains('='));
        assert!(!challenge.contains('+'));
        assert!(!challenge.contains('/'));
    }

    #[test]
    fn callback_validates_state_path_and_decodes_code() {
        assert_eq!(
            callback_code("/auth/callback?state=expected&code=a%2Bb", "expected").unwrap(),
            Some("a+b".into())
        );
        assert!(
            callback_code("/auth/callback?state=wrong&code=x", "expected")
                .unwrap()
                .is_none()
        );
        assert!(
            callback_code("/auth/callback-evil?state=expected&code=x", "expected")
                .unwrap()
                .is_none()
        );
        assert!(callback_code(
            "/auth/callback?state=expected&error=access_denied",
            "expected"
        )
        .is_err());
        assert!(callback_code(
            "/auth/callback?state=expected&state=expected&code=x",
            "expected"
        )
        .unwrap()
        .is_none());
    }
    #[test]
    fn test_url_encoding() {
        assert_eq!(
            url_encode("http://localhost:8080/callback"),
            "http%3A%2F%2Flocalhost%3A8080%2Fcallback"
        );
        assert_eq!(url_encode("hello world"), "hello%20world");
    }
}
