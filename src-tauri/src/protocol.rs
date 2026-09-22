//! Streaming observation and the Chat Completions -> Responses compatibility adapter.
use serde_json::{json, Value};

const MAX_EVENT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Default)]
pub struct SseDecoder {
    pending: Vec<u8>,
    data: Vec<String>,
    pub overflow: bool,
}
impl SseDecoder {
    pub fn push(&mut self, bytes: &[u8]) -> Vec<Value> {
        let mut events = Vec::new();
        // Decode only complete lines so split UTF-8 code points are preserved.
        for byte in bytes {
            self.pending.push(*byte);
            if self.pending.len() + self.data.iter().map(String::len).sum::<usize>()
                > MAX_EVENT_BYTES
            {
                self.overflow = true;
                self.pending.clear();
                self.data.clear();
                break;
            }
            if *byte == b'\n' {
                let line = String::from_utf8_lossy(&self.pending)
                    .trim_end_matches(['\r', '\n'])
                    .to_owned();
                self.pending.clear();
                if line.is_empty() {
                    let data = self.data.join("\n");
                    self.data.clear();
                    if data == "[DONE]" {
                        events.push(json!({"type":"chat.done"}));
                    } else if let Ok(event) = serde_json::from_str(&data) {
                        events.push(event);
                    }
                } else if let Some(data) = line.strip_prefix("data:") {
                    self.data
                        .push(data.strip_prefix(' ').unwrap_or(data).into());
                }
            }
        }
        events
    }
}

pub fn chat_to_responses(chat: &Value) -> Result<Value, String> {
    let messages = chat["messages"]
        .as_array()
        .ok_or("messages must be an array")?;
    let mut input = Vec::new();
    for message in messages {
        let role = message["role"].as_str().ok_or("Message role is required")?;
        if role == "tool" {
            input.push(json!({"type":"function_call_output", "call_id":message["tool_call_id"], "output":message["content"]}));
            continue;
        }
        if !matches!(role, "user" | "assistant" | "system" | "developer") {
            return Err("Unsupported chat role".into());
        }
        if let Some(content) = message.get("content").filter(|v| !v.is_null()) {
            let content = if let Some(parts) = content.as_array() {
                parts.iter().map(|part| match part["type"].as_str() {
                    Some("text") => Ok(json!({"type":if role == "assistant" {"output_text"} else {"input_text"}, "text":part["text"]})),
                    Some("image_url") if role == "user" => Ok(json!({"type":"input_image", "image_url":part["image_url"]["url"], "detail":part["image_url"].get("detail").cloned().unwrap_or(json!("auto"))})),
                    _ => Err("Unsupported chat content type".to_string()),
                }).collect::<Result<Vec<_>, _>>()?.into()
            } else {
                content.clone()
            };
            input.push(
                json!({"role":if role == "system" {"developer"} else {role}, "content":content}),
            );
        }
        if let Some(calls) = message["tool_calls"].as_array() {
            for call in calls {
                input.push(json!({"type":"function_call", "call_id":call["id"], "name":call["function"]["name"], "arguments":call["function"]["arguments"]}));
            }
        }
    }
    let mut result = json!({"model":chat["model"], "input":input, "instructions":"", "stream":true, "store":false});
    if let Some(tools) = chat["tools"].as_array() {
        let mut converted = Vec::new();
        for tool in tools {
            if tool["type"] != "function" {
                return Err(
                    "Only function tools are supported by the Chat compatibility adapter".into(),
                );
            }
            let mut function = tool["function"].clone();
            function["type"] = json!("function");
            converted.push(function);
        }
        result["tools"] = converted.into();
    }
    for key in ["parallel_tool_calls", "metadata"] {
        if let Some(value) = chat.get(key) {
            result[key] = value.clone();
        }
    }
    if let Some(choice) = chat.get("tool_choice") {
        result["tool_choice"] = if choice.is_object() {
            json!({"type":"function", "name":choice["function"]["name"]})
        } else {
            choice.clone()
        };
    }
    if let Some(effort) = chat.get("reasoning_effort") {
        result["reasoning"] = json!({"effort":effort});
    }
    if let Some(format) = chat.get("response_format") {
        result["text"] = json!({"format":if format["type"] == "json_schema" {
            let mut schema = format["json_schema"].clone(); schema["type"] = json!("json_schema"); schema
        } else { format.clone() }});
    }
    // Reject rather than silently pretending these generation controls took effect.
    for key in [
        "temperature",
        "top_p",
        "max_tokens",
        "max_completion_tokens",
        "stop",
        "logprobs",
        "presence_penalty",
        "frequency_penalty",
        "seed",
        "audio",
    ] {
        if chat.get(key).is_some_and(|v| !v.is_null()) {
            return Err(format!(
                "{key} is not supported by the Codex OAuth chat adapter; use an API-key account"
            ));
        }
    }
    if chat.get("n").is_some_and(|v| v != 1) {
        return Err("Codex supports one completion per request".into());
    }
    Ok(result)
}

pub fn response_to_chat(response: &Value) -> Value {
    let mut text = String::new();
    let mut calls = Vec::new();
    if let Some(output) = response["output"].as_array() {
        for item in output {
            if item["type"] == "function_call" {
                calls.push(json!({"id":item["call_id"], "type":"function", "function":{"name":item["name"], "arguments":item["arguments"]}}));
            }
            if let Some(parts) = item["content"].as_array() {
                for part in parts {
                    if let Some(t) = part["text"].as_str() {
                        text.push_str(t);
                    }
                }
            }
        }
    }
    let mut message = json!({"role":"assistant", "content":text});
    let finish = if !calls.is_empty() {
        message["tool_calls"] = calls.into();
        "tool_calls"
    } else if response["status"] == "incomplete" {
        "length"
    } else {
        "stop"
    };
    json!({"id":response["id"], "object":"chat.completion", "created":response["created_at"], "model":response["model"],
        "choices":[{"index":0, "message":message, "finish_reason":finish}], "usage":chat_usage(&response["usage"])})
}

pub fn chat_usage(usage: &Value) -> Value {
    json!({"prompt_tokens":usage["input_tokens"], "completion_tokens":usage["output_tokens"], "total_tokens":usage["total_tokens"],
        "prompt_tokens_details":usage["input_tokens_details"], "completion_tokens_details":usage["output_tokens_details"]})
}

pub struct ChatStream {
    id: String,
    model: String,
    created: i64,
    calls: std::collections::HashMap<u64, usize>,
    include_usage: bool,
}
impl ChatStream {
    pub fn new(model: &str, include_usage: bool) -> Self {
        Self {
            id: format!("chatcmpl-{}", uuid::Uuid::new_v4()),
            model: model.into(),
            created: chrono::Utc::now().timestamp(),
            calls: Default::default(),
            include_usage,
        }
    }
    fn chunk(&self, delta: Value, finish: Value) -> String {
        format!(
            "data: {}\n\n",
            json!({"id":self.id,"object":"chat.completion.chunk","created":self.created,"model":self.model,
            "choices":[{"index":0,"delta":delta,"finish_reason":finish}]})
        )
    }
    pub fn event(&mut self, event: &Value) -> String {
        match event["type"].as_str().unwrap_or("") {
            "response.created" => self.chunk(json!({"role":"assistant","content":""}), Value::Null),
            "response.output_text.delta" => {
                self.chunk(json!({"content":event["delta"]}), Value::Null)
            }
            "response.refusal.delta" => self.chunk(json!({"refusal":event["delta"]}), Value::Null),
            "response.output_item.added" if event["item"]["type"] == "function_call" => {
                let index = self.calls.len();
                self.calls
                    .insert(event["output_index"].as_u64().unwrap_or(0), index);
                self.chunk(json!({"tool_calls":[{"index":index,"id":event["item"]["call_id"],"type":"function", "function":{"name":event["item"]["name"],"arguments":""}}]}), Value::Null)
            }
            "response.function_call_arguments.delta" => {
                let index = self
                    .calls
                    .get(&event["output_index"].as_u64().unwrap_or(0))
                    .copied()
                    .unwrap_or(0);
                self.chunk(
                    json!({"tool_calls":[{"index":index,"function":{"arguments":event["delta"]}}]}),
                    Value::Null,
                )
            }
            "response.completed" | "response.incomplete" => {
                let finish = if event["type"] == "response.incomplete" {
                    "length"
                } else if self.calls.is_empty() {
                    "stop"
                } else {
                    "tool_calls"
                };
                let mut output = self.chunk(json!({}), json!(finish));
                if self.include_usage {
                    output.push_str(&format!("data: {}\n\n", json!({"id":self.id,"object":"chat.completion.chunk","created":self.created,"model":self.model,"choices":[],"usage":chat_usage(&event["response"]["usage"])})));
                }
                output.push_str("data: [DONE]\n\n");
                output
            }
            "response.failed" | "error" => format!(
                "data: {}\n\n",
                json!({"error":{"type":"upstream_error","message":"Upstream generation failed"}})
            ),
            _ => String::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fragmented_utf8_and_crlf_events() {
        let text = "data: {\"type\":\"response.output_text.delta\",\"delta\":\"héllo\"}\r\n\r\n";
        let mut decoder = SseDecoder::default();
        let events: Vec<_> = text
            .as_bytes()
            .iter()
            .flat_map(|b| decoder.push(&[*b]))
            .collect();
        assert_eq!(events[0]["delta"], "héllo");
    }
    #[test]
    fn chat_tools_and_results_are_preserved() {
        let input = json!({"model":"test","messages":[{"role":"assistant","content":null,"tool_calls":[{"id":"call-1","function":{"name":"read","arguments":"{}"}}]},{"role":"tool","tool_call_id":"call-1","content":"ok"}]});
        let response = chat_to_responses(&input).unwrap();
        assert_eq!(response["input"][0]["type"], "function_call");
        assert_eq!(response["input"][1]["call_id"], "call-1");
    }
    #[test]
    fn chat_terminal_event_has_finish_and_done() {
        let mut adapter = ChatStream::new("test", true);
        let output = adapter.event(&json!({"type":"response.completed","response":{"usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}}));
        assert!(output.contains("[DONE]"));
        assert!(output.contains("prompt_tokens"));
    }
}
