//! Opt-in real CLI checks against an isolated, synthetic loopback upstream.
//! CODEX_PROXY_TEST_CODEX=/path/to/codex cargo test --test cli_smoke -- --ignored
use axum::{body::Bytes, http::HeaderMap, routing::post, Router};
use codex_proxy_lib::{
    account::AccountManager,
    instances::{CodexInstance, InstanceManager},
    proxy::ProxyServer,
    settings::SettingsManager,
};
use serde_json::json;
use std::{sync::Arc, time::Duration};

#[tokio::test]
#[ignore = "Requires CODEX_PROXY_TEST_CODEX; uses only isolated profiles and synthetic credentials"]
async fn installed_codex_exec_and_managed_instance_smoke() {
    let binary = std::env::var("CODEX_PROXY_TEST_CODEX")
        .expect("Set CODEX_PROXY_TEST_CODEX to an installed Codex CLI");
    let dir = tempfile::tempdir().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_base = format!("http://{}/v1", listener.local_addr().unwrap());
    let upstream = tokio::spawn(async move {
        axum::serve(listener,Router::new().route("/v1/responses",post(|headers:HeaderMap,body:Bytes|async move {
            assert_eq!(headers["authorization"],"Bearer synthetic-smoke-key");
            let request:serde_json::Value=serde_json::from_slice(&body).unwrap();
            assert!(request["input"].is_array());
            let item=json!({"id":"msg_smoke","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"gateway-smoke-ok","annotations":[]}]});
            let response=json!({"id":"resp_smoke","object":"response","created_at":1,"status":"completed","model":request["model"],"output":[item],"usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}});
            let events=[json!({"type":"response.created","response":{"id":"resp_smoke","status":"in_progress","output":[]}}),
                json!({"type":"response.output_item.added","output_index":0,"item":{"id":"msg_smoke","type":"message","role":"assistant","status":"in_progress","content":[]}}),
                json!({"type":"response.output_text.delta","item_id":"msg_smoke","output_index":0,"content_index":0,"delta":"gateway-smoke-ok"}),
                json!({"type":"response.output_item.done","output_index":0,"item":item}),
                json!({"type":"response.completed","response":response})];
            let stream=events.iter().map(|event|format!("event: {}\ndata: {}\n\n",event["type"].as_str().unwrap(),event)).collect::<String>();
            ([("content-type","text/event-stream")],stream)
        }))).await.unwrap();
    });
    let accounts = Arc::new(
        AccountManager::with_paths(
            dir.path().join("accounts.json"),
            dir.path().join("unused-profile"),
        )
        .unwrap(),
    );
    accounts
        .import_from_json(
            &json!({"apiKey":"synthetic-smoke-key","apiBaseUrl":upstream_base}).to_string(),
        )
        .unwrap();
    let proxy = ProxyServer::new(accounts.clone(), dir.path().join("gateway.json")).unwrap();
    let reservation = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = reservation.local_addr().unwrap().port();
    drop(reservation);
    let mut config = proxy.config();
    config.port = port;
    proxy.update(config).await.unwrap();
    proxy.start().await.unwrap();
    let cli_home = dir.path().join("cli-home");
    std::fs::create_dir(&cli_home).unwrap();
    let base =
        format!("model_providers.codex_local_access.base_url=\"http://127.0.0.1:{port}/v1\"");
    let output = tokio::time::timeout(
        Duration::from_secs(45),
        tokio::process::Command::new(&binary)
            .current_dir(dir.path())
            .env("CODEX_HOME", &cli_home)
            .env_remove("OPENAI_API_KEY")
            .env_remove("CODEX_API_KEY")
            .env_remove("CODEX_ACCESS_TOKEN")
            .args([
                "exec",
                "--ephemeral",
                "--skip-git-repo-check",
                "--sandbox",
                "read-only",
                "-m",
                "gpt-5.5",
                "-c",
                "model_provider=\"codex_local_access\"",
                "-c",
                "model_providers.codex_local_access.name=\"Local smoke\"",
                "-c",
                &base,
                "-c",
                "model_providers.codex_local_access.wire_api=\"responses\"",
                "-c",
                "model_providers.codex_local_access.requires_openai_auth=false",
                "-c",
                "model_providers.codex_local_access.supports_websockets=false",
                "-c",
                "analytics.enabled=false",
                "-c",
                "feedback.enabled=false",
                "Reply with gateway-smoke-ok; do not run any tools.",
            ])
            .kill_on_drop(true)
            .output(),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(
        output.status.success(),
        "CLI failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("gateway-smoke-ok"));
    assert_eq!(proxy.stats().total_tokens, 5);

    let settings = Arc::new(SettingsManager::new(dir.path().join("settings.json")).unwrap());
    let mut app_settings = settings.get();
    app_settings.codex_binary = binary;
    settings.save(app_settings).unwrap();
    let instances = Arc::new(
        InstanceManager::new(dir.path().join("instances.json"), accounts, settings).unwrap(),
    );
    proxy.set_instances(instances.clone());
    let instance = instances
        .save(CodexInstance {
            id: String::new(),
            name: "Smoke".into(),
            profile_path: String::new(),
            is_running: false,
            pid: None,
            endpoint: None,
            bound_account_id: None,
            mixed_routing_enabled: false,
            routes: vec![],
            created_at: 0,
            last_launched_at: None,
        })
        .await
        .unwrap();
    instances
        .toggle(&instance.id, &proxy.config())
        .await
        .unwrap();
    let running = instances.list().await;
    assert!(running[0].is_running);
    assert!(running[0].pid.is_some());
    assert!(running[0].endpoint.is_some());
    instances
        .toggle(&instance.id, &proxy.config())
        .await
        .unwrap();
    assert!(!instances.list().await[0].is_running);
    proxy.stop().await;
    upstream.abort();
    assert!(!dir.path().join("unused-profile/auth.json").exists());
}
