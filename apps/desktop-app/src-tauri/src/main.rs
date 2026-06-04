#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
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

fn safe_join(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let normalized = relative.replace('\\', "/");
    if normalized.starts_with('/') || normalized.contains("..") {
        return Err(format!("Unsafe relative path: {relative}"));
    }
    Ok(root.join(normalized))
}

#[tauri::command]
fn save_first_run_setup(app: AppHandle, payload: String) -> Result<String, String> {
    let parsed: FirstRunPayload = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
    let app_data = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let out_dir = app_data.join("desktop-first-run");
    let agents_dir = out_dir.join("agents");

    fs::create_dir_all(&agents_dir).map_err(|error| error.to_string())?;
    fs::write(
        out_dir.join("first-run-profile.json"),
        serde_json::to_string_pretty(&serde_json::json!({
            "provider": parsed.provider,
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

    Ok(out_dir.to_string_lossy().to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![save_first_run_setup])
        .run(tauri::generate_context!())
        .expect("error while running Honeycomb desktop shell");
}
