//! Tauri transport adapter; model ownership lives in dndrom-local-runtime.
pub use dndrom_local_runtime::{LocalRuntimeState, RuntimeFeature, RuntimeStatus, TrainedWorld};
use tauri::{AppHandle, Emitter, Manager, State};

pub fn context(app: &AppHandle) -> Result<dndrom_local_runtime::RuntimeContext, String> {
    let data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let events = app.clone();
    Ok(dndrom_local_runtime::RuntimeContext::new(
        data_dir,
        move |progress| {
            let _ = events.emit("local-runtime-progress", progress);
        },
    ))
}
#[tauri::command]
pub async fn local_runtime_status(
    app: AppHandle,
    feature: RuntimeFeature,
) -> Result<RuntimeStatus, String> {
    let ctx = context(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        dndrom_local_runtime::local_runtime_status(ctx, feature)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn ensure_local_runtime(
    app: AppHandle,
    state: State<'_, LocalRuntimeState>,
    feature: RuntimeFeature,
    vram_reserve_gb: Option<f32>,
) -> Result<RuntimeStatus, String> {
    let ctx = context(&app)?;
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        dndrom_local_runtime::ensure_local_runtime(ctx, &manager, feature, vram_reserve_gb)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn restart_local_runtime(
    app: AppHandle,
    state: State<'_, LocalRuntimeState>,
    feature: RuntimeFeature,
    vram_reserve_gb: Option<f32>,
) -> Result<RuntimeStatus, String> {
    let ctx = context(&app)?;
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        dndrom_local_runtime::restart_local_runtime(ctx, &manager, feature, vram_reserve_gb)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn provision_local_creation_suite(
    app: AppHandle,
    state: State<'_, LocalRuntimeState>,
    vram_reserve_gb: Option<f32>,
) -> Result<RuntimeStatus, String> {
    let ctx = context(&app)?;
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        dndrom_local_runtime::provision_local_creation_suite(ctx, &manager, vram_reserve_gb)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn find_latest_local_world_dataset(app: AppHandle) -> Result<Option<String>, String> {
    dndrom_local_runtime::find_latest_local_world_dataset(context(&app)?)
}
#[tauri::command]
pub fn find_latest_local_trained_world(app: AppHandle) -> Result<Option<TrainedWorld>, String> {
    dndrom_local_runtime::find_latest_local_trained_world(context(&app)?)
}
#[tauri::command]
pub async fn train_local_world(
    app: AppHandle,
    state: State<'_, LocalRuntimeState>,
    dataset_path: String,
    total_steps: Option<u32>,
    max_splats: Option<u32>,
    max_frames: Option<u32>,
) -> Result<TrainedWorld, String> {
    let ctx = context(&app)?;
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        dndrom_local_runtime::train_local_world(
            ctx,
            &manager,
            dataset_path,
            total_steps,
            max_splats,
            max_frames,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn read_local_runtime_file(
    app: AppHandle,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    dndrom_local_runtime::read_local_runtime_file(context(&app)?, path)
        .map(tauri::ipc::Response::new)
}
