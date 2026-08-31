use dndrom_domain::{
    CheckRequest, DamageProfile, DamageResolution, DamageType, ResourcePool, RollResult,
};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedCampaign {
    name: String,
    path: String,
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
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            roll_check,
            damage_resource,
            heal_resource,
            resolve_damage,
            save_campaign,
            list_campaigns
        ])
        .run(tauri::generate_context!())
        .expect("error while running DnDRom");
}
