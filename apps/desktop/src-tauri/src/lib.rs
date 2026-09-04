use dndrom_domain::{
    CheckRequest, DamageProfile, DamageResolution, DamageType, ResourcePool, RollResult,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager, RunEvent};

mod local_runtime;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedCampaign {
    name: String,
    path: String,
}

const KREA_SERVICE: &str = "com.dndrom.desktop.krea";
const KREA_ACCOUNT: &str = "prop-api-token";

fn krea_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KREA_SERVICE, KREA_ACCOUNT).map_err(|error| error.to_string())
}

#[tauri::command]
fn has_krea_api_token() -> bool {
    krea_entry().and_then(|entry| entry.get_password().map_err(|error| error.to_string())).map(|value| !value.trim().is_empty()).unwrap_or(false)
}

#[tauri::command]
fn set_krea_api_token(token: String) -> Result<(), String> {
    let entry = krea_entry()?;
    if token.trim().is_empty() { return entry.delete_credential().map_err(|error| error.to_string()); }
    if token.len() > 4096 { return Err("The Krea token is unexpectedly long".into()); }
    entry.set_password(token.trim()).map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
struct KreaCreatedJob { job_id: String }

#[derive(Debug, Deserialize)]
struct KreaJobResult { urls: Vec<String> }

#[derive(Debug, Deserialize)]
struct KreaJob { status: String, result: Option<KreaJobResult>, error: Option<String> }

#[tauri::command]
fn generate_krea_prop_image(prompt: String) -> Result<Vec<u8>, String> {
    let prompt = prompt.trim();
    if prompt.is_empty() || prompt.len() > 2000 { return Err("The Krea prompt must be between 1 and 2,000 characters".into()); }
    let lowered = prompt.to_ascii_lowercase();
    if ["child sexual", "sexual minor", "csam", "terrorist propaganda"].iter().any(|term| lowered.contains(term)) { return Err("That prompt cannot be sent to Krea".into()); }
    let token = krea_entry()?.get_password().map_err(|_| "No Krea token is stored. Add one under Settings -> AI Providers.".to_string())?;
    let client = reqwest::blocking::Client::builder().timeout(Duration::from_secs(45)).build().map_err(|error| error.to_string())?;
    let created = client.post("https://api.krea.ai/generate/image/krea/krea-2/medium").bearer_auth(&token).json(&serde_json::json!({ "prompt": prompt, "aspect_ratio": "1:1", "resolution": "1K", "creativity": "low" })).send().map_err(|error| error.to_string())?;
    if !created.status().is_success() { return Err(format!("Krea rejected the generation request ({})", created.status())); }
    let job: KreaCreatedJob = created.json().map_err(|error| format!("Krea returned an invalid job: {error}"))?;
    for _ in 0..100 {
        std::thread::sleep(Duration::from_secs(3));
        let response = client.get(format!("https://api.krea.ai/jobs/{}", job.job_id)).bearer_auth(&token).send().map_err(|error| error.to_string())?;
        if !response.status().is_success() { return Err(format!("Krea job lookup failed ({})", response.status())); }
        let state: KreaJob = response.json().map_err(|error| format!("Krea returned an invalid job status: {error}"))?;
        match state.status.as_str() {
            "completed" => {
                let url = state.result.and_then(|value| value.urls.into_iter().next()).ok_or("Krea completed without an image URL")?;
                let image = client.get(url).send().map_err(|error| error.to_string())?;
                if !image.status().is_success() { return Err("Krea's generated image could not be downloaded".into()); }
                let bytes = image.bytes().map_err(|error| error.to_string())?;
                if bytes.is_empty() || bytes.len() > 20 * 1024 * 1024 { return Err("Krea returned an invalid image payload".into()); }
                return Ok(bytes.to_vec());
            }
            "failed" | "canceled" | "cancelled" => return Err(state.error.unwrap_or_else(|| format!("Krea job {}", state.status))),
            _ => {}
        }
    }
    Err("Krea generation timed out after five minutes".into())
}

fn campaigns_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("campaigns");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn safe_campaign_name(name: &str) -> String {
    let filtered: String = name
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .take(80)
        .collect();
    if filtered.is_empty() {
        "campaign".to_string()
    } else {
        filtered
    }
}

#[tauri::command]
fn roll_check(request: CheckRequest) -> Result<RollResult, String> {
    dndrom_domain::perform_check(&request).map_err(|error| error.to_string())
}

#[tauri::command]
fn damage_resource(pool: ResourcePool, amount: i32) -> Result<ResourcePool, String> {
    dndrom_domain::apply_damage(&pool, amount).map_err(|error| error.to_string())
}

#[tauri::command]
fn heal_resource(pool: ResourcePool, amount: i32) -> Result<ResourcePool, String> {
    dndrom_domain::apply_healing(&pool, amount).map_err(|error| error.to_string())
}

#[tauri::command]
fn resolve_damage(
    amount: i32,
    damage_type: DamageType,
    profile: DamageProfile,
) -> DamageResolution {
    dndrom_domain::resolve_typed_damage(amount, damage_type, &profile)
}

#[tauri::command]
fn save_campaign(app: AppHandle, name: String, contents: String) -> Result<SavedCampaign, String> {
    serde_json::from_str::<serde_json::Value>(&contents)
        .map_err(|error| format!("Campaign is not valid JSON: {error}"))?;
    let file_name = format!("{}.dndrom", safe_campaign_name(&name));
    let path = campaigns_dir(&app)?.join(&file_name);
    let temporary = path.with_extension("dndrom.tmp");
    fs::write(&temporary, contents).map_err(|error| error.to_string())?;
    fs::rename(&temporary, &path).map_err(|error| error.to_string())?;
    Ok(SavedCampaign {
        name: file_name,
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn list_campaigns(app: AppHandle) -> Result<Vec<SavedCampaign>, String> {
    let mut campaigns = Vec::new();
    for entry in fs::read_dir(campaigns_dir(&app)?).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) == Some("dndrom") {
            campaigns.push(SavedCampaign {
                name: entry.file_name().to_string_lossy().to_string(),
                path: path.to_string_lossy().to_string(),
            });
        }
    }
    campaigns.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(campaigns)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let runtime = local_runtime::LocalRuntimeState::new()
        .expect("could not initialize DnDRom's managed local AI process group");
    let app = tauri::Builder::default()
        .manage(runtime)
        .invoke_handler(tauri::generate_handler![
            roll_check,
            damage_resource,
            heal_resource,
            resolve_damage,
            save_campaign,
            list_campaigns,
            has_krea_api_token,
            set_krea_api_token,
            generate_krea_prop_image,
            local_runtime::local_runtime_status,
            local_runtime::ensure_local_runtime,
            local_runtime::restart_local_runtime,
            local_runtime::provision_local_creation_suite,
            local_runtime::find_latest_local_world_dataset,
            local_runtime::find_latest_local_trained_world,
            local_runtime::train_local_world,
            local_runtime::read_local_runtime_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building DnDRom");
    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            app_handle.state::<local_runtime::LocalRuntimeState>().shutdown(app_handle);
        }
    });
}
