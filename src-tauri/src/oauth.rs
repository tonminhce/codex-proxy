use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Sha256, Digest};
use crate::models::{CodexAccount, CodexAuthMode, CodexQuota, CodexQuotaWindow};
use crate::account::{decode_jwt_payload_value, AccountManager};

const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_URL: &str = "https://auth.openai.com/authorize";
const TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const SCOPES: &str = "openid profile email offline_access api.connectors.read api.connectors.invoke";

pub async fn perform_pkce_oauth_login(account_manager: Arc<AccountManager>) -> Result<CodexAccount, String> {
    // 1. Generate code_verifier (32 bytes random base64url)
    let random_bytes: Vec<u8> = (0..32).map(|_| (uuid::Uuid::new_v4().as_u128() & 0xFF) as u8).collect();
    let code_verifier = URL_SAFE_NO_PAD.encode(&random_bytes);

    // 2. Generate code_challenge (S256)
    let mut hasher = Sha256::new();
    hasher.update(code_verifier.as_bytes());
    let hash = hasher.finalize();
    let code_challenge = URL_SAFE_NO_PAD.encode(&hash);

    // 3. Generate state
    let state_token = uuid::Uuid::new_v4().to_string();

    // 4. Bind local TCP listener on available loopback port
    let listener = TcpListener::bind("127.0.0.1:0")
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
    if let Err(e) = open_browser(&full_auth_url) {
        tracing::warn!("Failed to open system browser automatically: {}", e);
    }

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
    let client = reqwest::Client::new();
    let exchange_params = [
        ("grant_type", "authorization_code"),
        ("code", auth_code.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("client_id", CLIENT_ID),
        ("code_verifier", code_verifier.as_str()),
    ];

    let resp = client.post(TOKEN_URL)
        .form(&exchange_params)
        .send()
        .await
        .map_err(|e| format!("Token exchange request failed: {}", e))?;

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Token exchange rejected ({}): {}", status, body));
    }

    let token_data: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse token response JSON: {}", e))?;

    let access_token = token_data.get("access_token").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let refresh_token = token_data.get("refresh_token").and_then(|v| v.as_str()).map(|s| s.to_string());
    let id_token = token_data.get("id_token").and_then(|v| v.as_str()).map(|s| s.to_string());

    // 9. Extract user info from id_token / access_token
    let claims = id_token.as_deref()
        .and_then(decode_jwt_payload_value)
        .or_else(|| decode_jwt_payload_value(&access_token));

    let email = claims.as_ref()
        .and_then(|c| c.get("email").and_then(|e| e.as_str()))
        .unwrap_or("user@openai.com")
        .to_string();

    let account_id = claims.as_ref()
        .and_then(|c| c.get("https://api.openai.com/auth"))
        .and_then(|a| a.get("chatgpt_account_id").and_then(|id| id.as_str()))
        .map(|s| s.to_string())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let plan_type = claims.as_ref()
        .and_then(|c| c.get("https://api.openai.com/auth"))
        .and_then(|a| a.get("chatgpt_plan_type").and_then(|p| p.as_str()))
        .unwrap_or("plus")
        .to_string();

    let name = claims.as_ref()
        .and_then(|c| c.get("https://api.openai.com/profile"))
        .and_then(|p| p.get("name").and_then(|n| n.as_str()))
        .map(|s| s.to_string())
        .or_else(|| claims.as_ref().and_then(|c| c.get("name").and_then(|n| n.as_str())).map(|s| s.to_string()));

    let new_account = CodexAccount {
        id: account_id,
        email,
        name,
        auth_mode: CodexAuthMode::OAuth,
        plan_type,
        is_active: false,
        is_cooldown: false,
        quota: CodexQuota {
            hourly: CodexQuotaWindow { used_percent: 0, remaining_percent: 100, reset_minutes_remaining: Some(60) },
            weekly: CodexQuotaWindow { used_percent: 0, remaining_percent: 100, reset_minutes_remaining: Some(10080) },
            luna_reserve_allowed: true,
            luna_reserve_active: false,
            reset_credits_remaining: 5,
            updated_at: chrono::Utc::now().timestamp_millis(),
        },
        created_at: chrono::Utc::now().timestamp_millis(),
        last_used_at: None,
        access_token: Some(access_token),
        refresh_token,
        id_token,
        api_base_url: None,
    };

    account_manager.add(new_account.clone());

    // Trigger initial quota fetch in background
    let acc_id = new_account.id.clone();
    let mgr = account_manager.clone();
    tauri::async_runtime::spawn(async move {
        let _ = mgr.refresh_quota(&acc_id).await;
    });

    tracing::info!("Successfully connected OpenAI Codex account: {}", new_account.email);
    Ok(new_account)
}

async fn wait_for_callback(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    loop {
        let (mut socket, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let mut buf = [0u8; 4096];
        let n = socket.read(&mut buf).await.map_err(|e| e.to_string())?;
        let req_str = String::from_utf8_lossy(&buf[..n]);

        if let Some(first_line) = req_str.lines().next() {
            if first_line.starts_with("GET /auth/callback") {
                let query = first_line.split_whitespace().nth(1).unwrap_or("").split('?').nth(1).unwrap_or("");
                let mut code = None;
                let mut state = None;
                for part in query.split('&') {
                    let mut kv = part.splitn(2, '=');
                    match (kv.next(), kv.next()) {
                        (Some("code"), Some(c)) => code = Some(c.to_string()),
                        (Some("state"), Some(s)) => state = Some(s.to_string()),
                        _ => {}
                    }
                }

                if state.as_deref() == Some(expected_state) && code.is_some() {
                    let html = r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Authorization Successful</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0A0C13; color: #F3F4F6; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .box { text-align: center; padding: 2.5rem 3rem; background: #121624; border: 1px solid #1E2536; border-radius: 1rem; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }
        h1 { color: #10B981; font-size: 1.5rem; margin-bottom: 0.5rem; }
        p { color: #9CA3AF; font-size: 0.875rem; }
    </style>
</head>
<body>
    <div class="box">
        <h1>✅ Codex Account Connected</h1>
        <p>You can close this tab and return to CodexProxy desktop app.</p>
    </div>
</body>
</html>"#;
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        html.len(),
                        html
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                    let _ = socket.flush().await;
                    return Ok(code.unwrap());
                }
            }
        }

        let not_found = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        let _ = socket.write_all(not_found.as_bytes()).await;
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
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
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
        let challenge = URL_SAFE_NO_PAD.encode(&hash);
        assert!(!challenge.is_empty());
        assert!(!challenge.contains('='));
        assert!(!challenge.contains('+'));
        assert!(!challenge.contains('/'));
    }

    #[test]
    fn test_url_encoding() {
        assert_eq!(url_encode("http://localhost:8080/callback"), "http%3A%2F%2Flocalhost%3A8080%2Fcallback");
        assert_eq!(url_encode("hello world"), "hello%20world");
    }
}
