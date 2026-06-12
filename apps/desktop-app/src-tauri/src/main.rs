#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FirstRunPayload {
    provider: serde_json::Value,
    interview: serde_json::Value,
    profile: serde_json::Value,
    cluster_config: serde_json::Value,
    agents: Vec<AgentFile>,
}

#[derive(Deserialize)]
struct AgentFile {
    path: String,
    contents: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderPayload {
    provider_name: String,
    base_url: String,
    model: String,
    api_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderConnectionResult {
    ok: bool,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    openclaw_manifest_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentModelConfigPayload {
    agent_id: String,
    provider_name: String,
    base_url: String,
    model: String,
    api_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SuggestionPayload {
    provider: ProviderPayload,
    industry: String,
    role: String,
    daily_work: String,
    language: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InterviewSuggestions {
    role_examples: Vec<String>,
    work_options: Vec<String>,
    quality_examples: Vec<String>,
}

fn safe_join(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let normalized = relative.replace('\\', "/");
    if normalized.starts_with('/') || normalized.contains("..") {
        return Err(format!("Unsafe relative path: {relative}"));
    }
    Ok(root.join(normalized))
}

fn chat_completions_url(base_url: &str) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() || !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("provider_endpoint".to_string());
    }
    if trimmed.ends_with("/chat/completions") {
        Ok(trimmed.to_string())
    } else {
        Ok(format!("{trimmed}/chat/completions"))
    }
}

fn clean_items(items: Vec<String>, fallback: &[&str], limit: usize) -> Vec<String> {
    let mut output: Vec<String> = Vec::new();
    for item in items.into_iter().chain(fallback.iter().map(|item| item.to_string())) {
        let cleaned = item
            .trim()
            .trim_matches(|value: char| value == '"' || value == '\'' || value == '。' || value == '.' || value == '…')
            .to_string();
        if cleaned.is_empty() || cleaned.chars().count() > 28 || output.iter().any(|existing| existing == &cleaned) {
            continue;
        }
        output.push(cleaned);
        if output.len() >= limit {
            break;
        }
    }
    output
}

async fn call_chat_completion(
    provider: &ProviderPayload,
    messages: Vec<serde_json::Value>,
    max_tokens: u32,
) -> Result<String, String> {
    if provider.model.trim().is_empty() || provider.api_key.trim().is_empty() {
        return Err("provider_missing".to_string());
    }
    let url = chat_completions_url(&provider.base_url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|_| "provider_client".to_string())?;
    let mut body = serde_json::json!({
        "model": provider.model.trim(),
        "messages": messages,
        "max_tokens": max_tokens,
        "stream": false
    });
    if provider.base_url.contains("deepseek.com") {
        body["thinking"] = serde_json::json!({ "type": "disabled" });
    }
    let response = client
        .post(url)
        .bearer_auth(provider.api_key.trim())
        .json(&body)
        .send()
        .await
        .map_err(|_| "provider_network".to_string())?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("provider_status:{}", status.as_u16()));
    }
    let parsed: serde_json::Value = serde_json::from_str(&body)
        .map_err(|_| "provider_response".to_string())?;
    let content = parsed
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(|content| content.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if content.is_empty() {
        return Err("provider_empty".to_string());
    }
    Ok(content)
}

fn parse_suggestions(content: &str) -> Result<InterviewSuggestions, String> {
    let start = content.find('{').ok_or_else(|| "provider_json".to_string())?;
    let end = content.rfind('}').ok_or_else(|| "provider_json".to_string())?;
    let json_slice = &content[start..=end];
    let parsed: InterviewSuggestions = serde_json::from_str(json_slice)
        .map_err(|_| "provider_json".to_string())?;
    Ok(InterviewSuggestions {
        role_examples: clean_items(parsed.role_examples, &["业务负责人", "一线执行人员", "技术/运营人员"], 4),
        work_options: clean_items(parsed.work_options, &["资料整理", "方案执行", "问题跟进", "交付复盘"], 4),
        quality_examples: clean_items(parsed.quality_examples, &["准确可追溯", "能直接交付", "符合实际场景", "便于复盘"], 4),
    })
}

fn timestamp_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn first_run_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|error| error.to_string())?;
    Ok(app_data.join("desktop-first-run"))
}

fn provider_api_key_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(first_run_dir(app)?.join("provider-api-key.txt"))
}

fn safe_storage_name(input: &str) -> String {
    let mut output = String::new();
    for value in input.trim().chars() {
        if value.is_ascii_alphanumeric() || value == '-' || value == '_' || value == '.' {
            output.push(value);
        } else {
            output.push('_');
        }
    }
    if output.is_empty() {
        "agent".to_string()
    } else {
        output.chars().take(96).collect()
    }
}

fn agent_api_key_path(app: &AppHandle, agent_id: &str) -> Result<PathBuf, String> {
    Ok(first_run_dir(app)?
        .join("agent-api-keys")
        .join(format!("{}.key", safe_storage_name(agent_id))))
}

fn run_dpapi(action: &str, input: &str) -> Result<String, String> {
    let script = match action {
        "protect" => "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$plain=[Console]::In.ReadToEnd();$bytes=[Text.Encoding]::UTF8.GetBytes($plain);$protected=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($protected))",
        "unprotect" => "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$inputText=[Console]::In.ReadToEnd().Trim();$bytes=[Convert]::FromBase64String($inputText);$plain=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))",
        _ => return Err("unsupported_dpapi_action".to_string()),
    };

    let mut child = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(input.as_bytes())
            .map_err(|error| error.to_string())?;
    }

    let output = child.wait_with_output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn encrypt_provider_api_key(api_key: &str) -> Result<String, String> {
    if cfg!(windows) {
        let ciphertext = run_dpapi("protect", api_key)?;
        return serde_json::to_string_pretty(&serde_json::json!({
            "format": "dpapi-user-v1",
            "ciphertext": ciphertext
        }))
        .map_err(|error| error.to_string());
    }

    serde_json::to_string_pretty(&serde_json::json!({
        "format": "plaintext-local-v1",
        "value": api_key
    }))
    .map_err(|error| error.to_string())
}

fn decrypt_provider_api_key(raw: &str) -> Result<Option<String>, String> {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) {
        if value.get("format").and_then(|item| item.as_str()) == Some("dpapi-user-v1") {
            if let Some(ciphertext) = value.get("ciphertext").and_then(|item| item.as_str()) {
                return run_dpapi("unprotect", ciphertext).map(Some);
            }
        }
        if value.get("format").and_then(|item| item.as_str()) == Some("plaintext-local-v1") {
            return Ok(value
                .get("value")
                .and_then(|item| item.as_str())
                .map(|item| item.to_string()));
        }
    }

    let legacy = raw.trim().to_string();
    if legacy.is_empty() {
        Ok(None)
    } else {
        Ok(Some(legacy))
    }
}

fn save_encrypted_api_key(path: &Path, api_key: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, encrypt_provider_api_key(api_key.trim())?).map_err(|error| error.to_string())
}

fn load_encrypted_api_key(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let decrypted = decrypt_provider_api_key(&raw)?;
    if let Some(api_key) = decrypted.as_ref() {
        if !raw.trim_start().starts_with('{') {
            fs::write(path, encrypt_provider_api_key(api_key)?)
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(decrypted)
}

fn save_agent_api_key(app: &AppHandle, agent_id: &str, api_key: &str) -> Result<(), String> {
    let key_path = agent_api_key_path(app, agent_id)?;
    save_encrypted_api_key(&key_path, api_key)
}

fn read_json_object(path: &Path) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    if !path.exists() {
        return Ok(serde_json::Map::new());
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(&content).map_err(|error| error.to_string())?;
    Ok(parsed.as_object().cloned().unwrap_or_default())
}

fn copy_dir_all(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        let next_target = target.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all(&entry.path(), &next_target)?;
        } else {
            fs::copy(entry.path(), next_target).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn write_openclaw_runtime_manifest(app: &AppHandle) -> Result<String, String> {
    let app_data = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let first_run = app_data.join("desktop-first-run");
    let runtime_dir = app_data.join("openclaw-runtime");
    let source_cluster_path = first_run.join("cluster.config.json");
    let runtime_cluster_path = runtime_dir.join("cluster.config.json");
    let source_agent_model_config_path = first_run.join("agent-model-configs.json");
    let runtime_agent_model_config_path = runtime_dir.join("agent-model-configs.json");
    let source_agents_dir = first_run.join("agents");
    let runtime_agents_dir = runtime_dir.join("agents");
    let env_path = runtime_dir.join("openclaw.env");
    let manifest_path = runtime_dir.join("runtime-manifest.json");
    let applied_at = timestamp_string();

    fs::create_dir_all(&runtime_dir).map_err(|error| error.to_string())?;
    if source_cluster_path.exists() {
        fs::copy(&source_cluster_path, &runtime_cluster_path).map_err(|error| error.to_string())?;
    }
    if source_agent_model_config_path.exists() {
        fs::copy(&source_agent_model_config_path, &runtime_agent_model_config_path).map_err(|error| error.to_string())?;
    }
    if source_agents_dir.exists() {
        if runtime_agents_dir.exists() {
            fs::remove_dir_all(&runtime_agents_dir).map_err(|error| error.to_string())?;
        }
        copy_dir_all(&source_agents_dir, &runtime_agents_dir)?;
    }

    let env_contents = format!(
        "AGENT_CLUSTER_CONFIG_PATH={}\nHONEYCOMB_AGENT_MODEL_CONFIG_PATH={}\nHONEYCOMB_FIRST_RUN_AGENTS_DIR={}\n",
        runtime_cluster_path.to_string_lossy(),
        runtime_agent_model_config_path.to_string_lossy(),
        runtime_agents_dir.to_string_lossy()
    );
    fs::write(&env_path, env_contents).map_err(|error| error.to_string())?;

    let manifest = serde_json::json!({
        "schemaVersion": "honeycomb.openclaw.runtime.v1",
        "clusterConfigPath": runtime_cluster_path,
        "agentModelConfigPath": runtime_agent_model_config_path,
        "agentsDir": runtime_agents_dir,
        "openclawEnvPath": env_path,
        "appliedAt": applied_at
    });
    fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(manifest_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn verify_provider_connection(payload: ProviderPayload) -> Result<ProviderConnectionResult, String> {
    let provider_name = payload.provider_name.trim().to_string();
    call_chat_completion(
        &payload,
        vec![
            serde_json::json!({
                "role": "system",
                "content": "You verify that a model endpoint works. Reply with exactly OK."
            }),
            serde_json::json!({
                "role": "user",
                "content": "Reply OK if you can read this request."
            }),
        ],
        16,
    )
    .await?;
    Ok(ProviderConnectionResult {
        ok: true,
        message: format!("{} connection verified.", if provider_name.is_empty() { "Provider" } else { &provider_name }),
        openclaw_manifest_path: None,
    })
}

#[tauri::command]
async fn generate_first_run_suggestions(payload: SuggestionPayload) -> Result<InterviewSuggestions, String> {
    let language_name = if payload.language == "zh" { "Chinese" } else { "English" };
    let role_line = if payload.role.trim().is_empty() {
        "Role: unknown yet".to_string()
    } else {
        format!("Role: {}", payload.role.trim())
    };
    let work_line = if payload.daily_work.trim().is_empty() {
        "Daily work: unknown yet".to_string()
    } else {
        format!("Daily work: {}", payload.daily_work.trim())
    };
    let content = call_chat_completion(
        &payload.provider,
        vec![
            serde_json::json!({
                "role": "system",
                "content": "You generate concise onboarding UI suggestions for a local multi-agent work panel. Return strict JSON only. Do not include secrets."
            }),
            serde_json::json!({
                "role": "user",
                "content": format!(
                    "Language: {language_name}\nIndustry/domain: {}\n{role_line}\n{work_line}\nReturn JSON with exactly this shape: {{\"roleExamples\":[3 or 4 short role names],\"workOptions\":[4 concrete daily work options],\"qualityExamples\":[4 short examples of excellent output for this user's role and work]}}. Make every item specific to the domain. Keep each item short.",
                    payload.industry.trim()
                )
            }),
        ],
        260,
    )
    .await?;
    parse_suggestions(&content)
}

#[tauri::command]
fn save_first_run_setup(app: AppHandle, payload: String) -> Result<String, String> {
    let parsed: FirstRunPayload = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
    let app_data = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let out_dir = app_data.join("desktop-first-run");
    let agents_dir = out_dir.join("agents");
    let provider = parsed.provider.clone();

    fs::create_dir_all(&agents_dir).map_err(|error| error.to_string())?;
    fs::write(
        out_dir.join("first-run-profile.json"),
        serde_json::to_string_pretty(&serde_json::json!({
            "provider": provider,
            "interview": parsed.interview,
            "profile": parsed.profile
        }))
        .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    fs::write(
        out_dir.join("cluster.config.json"),
        serde_json::to_string_pretty(&parsed.cluster_config).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    for agent in parsed.agents {
        let target = safe_join(&out_dir, &agent.path)?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(target, agent.contents).map_err(|error| error.to_string())?;
    }

    if let Ok(Some(api_key)) = load_provider_api_key(app.clone()) {
        let model = parsed.provider.get("model").and_then(|value| value.as_str()).unwrap_or("").trim();
        if !model.is_empty() {
            save_agent_api_key(&app, "panel-supervisor-agent", &api_key)?;
            let config_path = out_dir.join("agent-model-configs.json");
            let mut configs = read_json_object(&config_path)?;
            let applied_at = timestamp_string();
            configs.insert(
                "panel-supervisor-agent".to_string(),
                serde_json::json!({
                    "providerName": parsed.provider.get("providerName").and_then(|value| value.as_str()).unwrap_or("DeepSeek"),
                    "baseUrl": parsed.provider.get("baseUrl").and_then(|value| value.as_str()).unwrap_or("https://api.deepseek.com"),
                    "model": model,
                    "apiKeyConfigured": true,
                    "verifiedAt": applied_at,
                    "appliedAt": applied_at
                }),
            );
            fs::write(
                &config_path,
                serde_json::to_string_pretty(&configs).map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
        }
    }

    let _ = write_openclaw_runtime_manifest(&app);

    Ok(out_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn load_first_run_setup(app: AppHandle) -> Result<Option<String>, String> {
    let app_data = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let profile_path = app_data.join("desktop-first-run").join("first-run-profile.json");
    if !profile_path.exists() {
        return Ok(None);
    }
    fs::read_to_string(profile_path)
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn load_agent_model_configs(app: AppHandle) -> Result<Option<String>, String> {
    let config_path = first_run_dir(&app)?.join("agent-model-configs.json");
    if !config_path.exists() {
        return Ok(None);
    }
    let mut persisted = read_json_object(&config_path)?;
    let mut response = persisted.clone();
    let mut changed = false;
    let agent_ids: Vec<String> = persisted.keys().cloned().collect();

    for agent_id in agent_ids {
        let mut configured_by_key_file = false;
        let legacy_key = persisted
            .get(&agent_id)
            .and_then(|value| value.as_object())
            .and_then(|object| object.get("apiKey"))
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        if !legacy_key.is_empty() {
            save_agent_api_key(&app, &agent_id, &legacy_key)?;
            configured_by_key_file = true;
        }

        if let Some(value) = persisted.get_mut(&agent_id) {
            if let Some(object) = value.as_object_mut() {
                if object.remove("apiKey").is_some() {
                    changed = true;
                }
                if configured_by_key_file {
                    object.insert("apiKeyConfigured".to_string(), serde_json::json!(true));
                }
            }
        }

        let key_path = agent_api_key_path(&app, &agent_id)?;
        let api_key = load_encrypted_api_key(&key_path)?;
        if let Some(value) = response.get_mut(&agent_id) {
            if let Some(object) = value.as_object_mut() {
                object.remove("apiKey");
                if let Some(api_key) = api_key {
                    object.insert("apiKey".to_string(), serde_json::json!(api_key));
                    object.insert("apiKeyConfigured".to_string(), serde_json::json!(true));
                } else if configured_by_key_file {
                    object.insert("apiKey".to_string(), serde_json::json!(legacy_key));
                    object.insert("apiKeyConfigured".to_string(), serde_json::json!(true));
                }
            }
        }
    }

    if changed {
        fs::write(
            &config_path,
            serde_json::to_string_pretty(&persisted).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
    }

    serde_json::to_string_pretty(&response)
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn save_agent_model_config(
    app: AppHandle,
    payload: AgentModelConfigPayload,
) -> Result<ProviderConnectionResult, String> {
    let provider = ProviderPayload {
        provider_name: payload.provider_name.trim().to_string(),
        base_url: payload.base_url.trim().to_string(),
        model: payload.model.trim().to_string(),
        api_key: payload.api_key.trim().to_string(),
    };
    let provider_name = provider.provider_name.clone();
    call_chat_completion(
        &provider,
        vec![
            serde_json::json!({
                "role": "system",
                "content": "You verify that a model endpoint works. Reply with exactly OK."
            }),
            serde_json::json!({
                "role": "user",
                "content": "Reply OK if this agent model configuration is valid."
            }),
        ],
        16,
    )
    .await?;

    let out_dir = first_run_dir(&app)?;
    fs::create_dir_all(&out_dir).map_err(|error| error.to_string())?;
    save_agent_api_key(&app, payload.agent_id.trim(), provider.api_key.trim())?;
    let config_path = out_dir.join("agent-model-configs.json");
    let mut configs = read_json_object(&config_path)?;
    let applied_at = timestamp_string();
    configs.insert(
        payload.agent_id.trim().to_string(),
        serde_json::json!({
            "providerName": provider.provider_name,
            "baseUrl": provider.base_url,
            "model": provider.model,
            "apiKeyConfigured": true,
            "verifiedAt": applied_at,
            "appliedAt": applied_at
        }),
    );
    fs::write(
        &config_path,
        serde_json::to_string_pretty(&configs).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let manifest_path = write_openclaw_runtime_manifest(&app)?;
    Ok(ProviderConnectionResult {
        ok: true,
        message: format!("{} connection verified.", if provider_name.is_empty() { "Provider" } else { &provider_name }),
        openclaw_manifest_path: Some(manifest_path),
    })
}

#[tauri::command]
fn apply_openclaw_agent_setup(app: AppHandle) -> Result<String, String> {
    write_openclaw_runtime_manifest(&app)
}

#[tauri::command]
fn save_provider_api_key(app: AppHandle, payload: String) -> Result<(), String> {
    let key_path = provider_api_key_path(&app)?;
    save_encrypted_api_key(&key_path, payload.trim())
}

#[tauri::command]
fn load_provider_api_key(app: AppHandle) -> Result<Option<String>, String> {
    let key_path = provider_api_key_path(&app)?;
    if !key_path.exists() {
        return Ok(None);
    }
    load_encrypted_api_key(&key_path)
}

#[tauri::command]
fn load_api_auth_token(app: AppHandle) -> Result<Option<String>, String> {
    let app_data = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let token_path = app_data.join("honeycomb-api-token.txt");
    if !token_path.exists() {
        return Ok(None);
    }
    fs::read_to_string(token_path)
        .map(|token| {
            let trimmed = token.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
        .map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            verify_provider_connection,
            generate_first_run_suggestions,
            save_first_run_setup,
            load_first_run_setup,
            load_agent_model_configs,
            save_agent_model_config,
            apply_openclaw_agent_setup,
            save_provider_api_key,
            load_provider_api_key,
            load_api_auth_token
        ])
        .run(tauri::generate_context!())
        .expect("error while running Honeycomb desktop shell");
}
