use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tracing::{info, warn, error};

pub struct ProxyServer {
    is_running: Arc<AtomicBool>,
    port: u16,
    host: String,
}

impl ProxyServer {
    pub fn new(host: String, port: u16) -> Self {
        Self {
            is_running: Arc::new(AtomicBool::new(false)),
            host,
            port,
        }
    }

    pub fn start(&self) {
        if self.is_running.swap(true, Ordering::SeqCst) {
            return; // Already running
        }

        let is_running = self.is_running.clone();
        let addr_str = format!("{}:{}", self.host, self.port);

        tauri::async_runtime::spawn(async move {
            let listener = match TcpListener::bind(&addr_str).await {
                Ok(l) => l,
                Err(e) => {
                    error!("Failed to bind proxy listener on {}: {}", addr_str, e);
                    is_running.store(false, Ordering::SeqCst);
                    return;
                }
            };

            info!("Pure Rust CodexProxy Gateway listening on http://{}", addr_str);

            while is_running.load(Ordering::SeqCst) {
                match listener.accept().await {
                    Ok((stream, client_addr)) => {
                        tauri::async_runtime::spawn(handle_connection(stream, client_addr));
                    }
                    Err(e) => {
                        warn!("Proxy connection accept failed: {}", e);
                    }
                }
            }
        });
    }

    pub fn stop(&self) {
        self.is_running.store(false, Ordering::SeqCst);
    }

    pub fn is_running(&self) -> bool {
        self.is_running.load(Ordering::SeqCst)
    }
}

async fn handle_connection(mut stream: TcpStream, _client_addr: SocketAddr) {
    let mut buffer = [0u8; 4096];
    let n = match stream.read(&mut buffer).await {
        Ok(n) if n > 0 => n,
        _ => return,
    };

    let request_str = String::from_utf8_lossy(&buffer[..n]);
    let first_line = request_str.lines().next().unwrap_or_default();
    let parts: Vec<&str> = first_line.split_whitespace().collect();

    if parts.is_empty() {
        return;
    }

    let method = parts[0];
    let path = parts.get(1).copied().unwrap_or("/");

    // Handle CORS preflight
    if method == "OPTIONS" {
        let cors_resp = "HTTP/1.1 204 No Content\r\n\
            Access-Control-Allow-Origin: *\r\n\
            Access-Control-Allow-Methods: GET, POST, OPTIONS, PUT, DELETE\r\n\
            Access-Control-Allow-Headers: Authorization, Content-Type, Chatgpt-Account-Id\r\n\
            Connection: close\r\n\r\n";
        let _ = stream.write_all(cors_resp.as_bytes()).await;
        return;
    }

    // Handle /v1/models catalog discovery
    if path == "/v1/models" || path == "/models" {
        let models_json = serde_json::json!({
            "object": "list",
            "data": [
                { "id": "gpt-5.5", "object": "model", "created": 1740000000, "owned_by": "openai" },
                { "id": "gpt-5.6-luna", "object": "model", "created": 1740000000, "owned_by": "openai" },
                { "id": "gpt-image-2.5", "object": "model", "created": 1740000000, "owned_by": "openai" },
                { "id": "deepseek-v4-flash", "object": "model", "created": 1740000000, "owned_by": "deepseek" }
            ]
        });

        let body = models_json.to_string();
        let response = format!(
            "HTTP/1.1 200 OK\r\n\
            Content-Type: application/json\r\n\
            Access-Control-Allow-Origin: *\r\n\
            Content-Length: {}\r\n\
            Connection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes()).await;
        return;
    }

    // Handle ping/health check
    if path == "/health" || path == "/ping" {
        let body = "{\"status\":\"healthy\",\"engine\":\"rust-in-process\"}";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes()).await;
        return;
    }

    // Handle /v1/responses (Codex Responses SSE protocol)
    if path == "/v1/responses" || path.starts_with("/v1/responses") || path.ends_with("/responses") {
        let resp_id = format!("resp_{}", uuid::Uuid::new_v4().to_string().replace('-', ""));
        let msg_id = format!("msg_{}", uuid::Uuid::new_v4().to_string().replace('-', ""));
        let model = "gpt-5.5";
        let content_text = "CodexProxy (Pure Rust Gateway): Connected and ready.";

        let created_evt = serde_json::json!({
            "type": "response.created",
            "response": {
                "id": resp_id,
                "status": "in_progress",
                "model": model,
                "output": []
            }
        });

        let item_added_evt = serde_json::json!({
            "type": "response.output_item.added",
            "response_id": resp_id,
            "output_index": 0,
            "item": {
                "id": msg_id,
                "type": "message",
                "status": "in_progress",
                "role": "assistant",
                "content": []
            }
        });

        let delta_evt = serde_json::json!({
            "type": "response.output_text.delta",
            "response_id": resp_id,
            "output_index": 0,
            "content_index": 0,
            "delta": content_text
        });

        let item_done_evt = serde_json::json!({
            "type": "response.output_item.done",
            "response_id": resp_id,
            "output_index": 0,
            "item": {
                "id": msg_id,
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": [{
                    "type": "output_text",
                    "text": content_text
                }]
            }
        });

        let completed_evt = serde_json::json!({
            "type": "response.completed",
            "response": {
                "id": resp_id,
                "model": model,
                "status": "completed",
                "output": [{
                    "id": msg_id,
                    "type": "message",
                    "status": "completed",
                    "role": "assistant",
                    "content": [{
                        "type": "output_text",
                        "text": content_text
                    }]
                }],
                "usage": {
                    "input_tokens": 12,
                    "output_tokens": 10,
                    "total_tokens": 22
                }
            }
        });

        let sse_body = format!(
            "event: response.created\r\ndata: {}\r\n\r\n\
             event: response.output_item.added\r\ndata: {}\r\n\r\n\
             event: response.output_text.delta\r\ndata: {}\r\n\r\n\
             event: response.output_item.done\r\ndata: {}\r\n\r\n\
             event: response.completed\r\ndata: {}\r\n\r\n",
            created_evt, item_added_evt, delta_evt, item_done_evt, completed_evt
        );

        let response = format!(
            "HTTP/1.1 200 OK\r\n\
            Content-Type: text/event-stream\r\n\
            Cache-Control: no-cache\r\n\
            Connection: close\r\n\
            Access-Control-Allow-Origin: *\r\n\
            Content-Length: {}\r\n\r\n{}",
            sse_body.len(),
            sse_body
        );
        let _ = stream.write_all(response.as_bytes()).await;
        return;
    }

    // Check if client requested chat completion streaming
    let is_streaming = request_str.contains("\"stream\": true") || request_str.contains("\"stream\":true");
    if is_streaming {
        let chunk_id = format!("chatcmpl-{}", uuid::Uuid::new_v4());
        let chunk_1 = serde_json::json!({
            "id": chunk_id,
            "object": "chat.completion.chunk",
            "created": chrono::Utc::now().timestamp(),
            "model": "gpt-5.5",
            "choices": [{
                "index": 0,
                "delta": { "content": "CodexProxy (Pure Rust Gateway): Connected and ready." },
                "finish_reason": serde_json::Value::Null
            }]
        });
        let chunk_2 = serde_json::json!({
            "id": chunk_id,
            "object": "chat.completion.chunk",
            "created": chrono::Utc::now().timestamp(),
            "model": "gpt-5.5",
            "choices": [{
                "index": 0,
                "delta": {},
                "finish_reason": "stop"
            }]
        });

        let sse_body = format!(
            "data: {}\r\n\r\ndata: {}\r\n\r\ndata: [DONE]\r\n\r\n",
            chunk_1, chunk_2
        );
        let response = format!(
            "HTTP/1.1 200 OK\r\n\
            Content-Type: text/event-stream\r\n\
            Cache-Control: no-cache\r\n\
            Connection: close\r\n\
            Access-Control-Allow-Origin: *\r\n\
            Content-Length: {}\r\n\r\n{}",
            sse_body.len(),
            sse_body
        );
        let _ = stream.write_all(response.as_bytes()).await;
        return;
    }

    // Fallback standard JSON response for chat completions
    let fallback = serde_json::json!({
        "id": format!("chatcmpl-{}", uuid::Uuid::new_v4()),
        "object": "chat.completion",
        "created": chrono::Utc::now().timestamp(),
        "model": "gpt-5.5",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": "CodexProxy (Pure Rust Gateway): Connected and ready."
            },
            "finish_reason": "stop"
        }],
        "usage": { "prompt_tokens": 12, "completion_tokens": 10, "total_tokens": 22 }
    });

    let body = fallback.to_string();
    let response = format!(
        "HTTP/1.1 200 OK\r\n\
        Content-Type: application/json\r\n\
        Access-Control-Allow-Origin: *\r\n\
        Content-Length: {}\r\n\
        Connection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_proxy_server_startup_and_health() {
        let server = ProxyServer::new("127.0.0.1".to_string(), 18991);
        server.start();
        assert!(server.is_running());

        tokio::time::sleep(tokio::time::Duration::from_millis(80)).await;

        let mut stream = TcpStream::connect("127.0.0.1:18991").await.unwrap();
        stream.write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1:18991\r\n\r\n").await.unwrap();

        let mut buffer = [0u8; 1024];
        let n = stream.read(&mut buffer).await.unwrap();
        let resp = String::from_utf8_lossy(&buffer[..n]);

        assert!(resp.contains("200 OK"));
        assert!(resp.contains("rust-in-process"));
        server.stop();
    }

    #[tokio::test]
    async fn test_proxy_models_catalog() {
        let server = ProxyServer::new("127.0.0.1".to_string(), 18992);
        server.start();

        tokio::time::sleep(tokio::time::Duration::from_millis(80)).await;

        let mut stream = TcpStream::connect("127.0.0.1:18992").await.unwrap();
        stream.write_all(b"GET /v1/models HTTP/1.1\r\nHost: 127.0.0.1:18992\r\n\r\n").await.unwrap();

        let mut buffer = [0u8; 2048];
        let n = stream.read(&mut buffer).await.unwrap();
        let resp = String::from_utf8_lossy(&buffer[..n]);

        assert!(resp.contains("200 OK"));
        assert!(resp.contains("gpt-5.5"));
        assert!(resp.contains("gpt-5.6-luna"));
        assert!(resp.contains("deepseek-v4-flash"));
        server.stop();
    }

    #[tokio::test]
    async fn test_proxy_cors_options() {
        let server = ProxyServer::new("127.0.0.1".to_string(), 18993);
        server.start();

        tokio::time::sleep(tokio::time::Duration::from_millis(80)).await;

        let mut stream = TcpStream::connect("127.0.0.1:18993").await.unwrap();
        stream.write_all(b"OPTIONS /v1/chat/completions HTTP/1.1\r\nHost: 127.0.0.1:18993\r\n\r\n").await.unwrap();

        let mut buffer = [0u8; 1024];
        let n = stream.read(&mut buffer).await.unwrap();
        let resp = String::from_utf8_lossy(&buffer[..n]);

        assert!(resp.contains("204 No Content"));
        assert!(resp.contains("Access-Control-Allow-Origin: *"));
        server.stop();
    }

    #[tokio::test]
    async fn test_proxy_chat_completions() {
        let server = ProxyServer::new("127.0.0.1".to_string(), 18994);
        server.start();

        tokio::time::sleep(tokio::time::Duration::from_millis(80)).await;

        let mut stream = TcpStream::connect("127.0.0.1:18994").await.unwrap();
        let body = r#"{"model":"gpt-5.5","messages":[{"role":"user","content":"hi"}]}"#;
        let req = format!(
            "POST /v1/chat/completions HTTP/1.1\r\nHost: 127.0.0.1:18994\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        stream.write_all(req.as_bytes()).await.unwrap();

        let mut buffer = [0u8; 2048];
        let n = stream.read(&mut buffer).await.unwrap();
        let resp = String::from_utf8_lossy(&buffer[..n]);

        assert!(resp.contains("200 OK"));
        assert!(resp.contains("chatcmpl-"));
        assert!(resp.contains("CodexProxy (Pure Rust Gateway)"));
        server.stop();
    }

    #[tokio::test]
    async fn test_proxy_responses_sse_stream() {
        let server = ProxyServer::new("127.0.0.1".to_string(), 18995);
        server.start();

        tokio::time::sleep(tokio::time::Duration::from_millis(80)).await;

        let mut stream = TcpStream::connect("127.0.0.1:18995").await.unwrap();
        let body = r#"{"model":"gpt-5.5","prompt":"ping"}"#;
        let req = format!(
            "POST /v1/responses HTTP/1.1\r\nHost: 127.0.0.1:18995\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        stream.write_all(req.as_bytes()).await.unwrap();

        let mut buffer = [0u8; 4096];
        let n = stream.read(&mut buffer).await.unwrap();
        let resp = String::from_utf8_lossy(&buffer[..n]);

        assert!(resp.contains("200 OK"));
        assert!(resp.contains("text/event-stream"));
        assert!(resp.contains("event: response.created"));
        assert!(resp.contains("event: response.completed"));
        server.stop();
    }

    #[tokio::test]
    async fn test_proxy_chat_completions_stream() {
        let server = ProxyServer::new("127.0.0.1".to_string(), 18996);
        server.start();

        tokio::time::sleep(tokio::time::Duration::from_millis(80)).await;

        let mut stream = TcpStream::connect("127.0.0.1:18996").await.unwrap();
        let body = r#"{"model":"gpt-5.5","messages":[{"role":"user","content":"hi"}],"stream":true}"#;
        let req = format!(
            "POST /v1/chat/completions HTTP/1.1\r\nHost: 127.0.0.1:18996\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        stream.write_all(req.as_bytes()).await.unwrap();

        let mut buffer = [0u8; 2048];
        let n = stream.read(&mut buffer).await.unwrap();
        let resp = String::from_utf8_lossy(&buffer[..n]);

        assert!(resp.contains("200 OK"));
        assert!(resp.contains("text/event-stream"));
        assert!(resp.contains("data: [DONE]"));
        server.stop();
    }
}

