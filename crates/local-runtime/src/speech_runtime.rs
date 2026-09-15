use super::*;

const ENDPOINT: &str = "http://127.0.0.1:8191";
const ARCHIVE_URL: &str = "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.0/whisper-bin-x64.zip";
const ARCHIVE_SIZE: u64 = 5410599;
const ARCHIVE_HASH: &str = "00c4304b6be363a224a4b69829df49009f74131df8c3ce6a5878b89a11cd26ef";
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.bin";
const MODEL_SIZE: u64 = 147951465;
const MODEL_HASH: &str = "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe";
fn ready() -> bool {
    reqwest::blocking::Client::builder().timeout(Duration::from_secs(1)).build().ok()
        .and_then(|client| client.get(format!("{ENDPOINT}/health")).send().ok()).is_some_and(|response| response.status().is_success())
}
pub(super) fn status(app: &RuntimeContext) -> Result<RuntimeStatus, String> {
    let base = app.data_dir.join("runtime/whisper-1.9.0");
    let total = ARCHIVE_SIZE + MODEL_SIZE;
    let installed = if base.join("bin/Release/whisper-server.exe").exists() { ARCHIVE_SIZE } else { 0 }
        + if asset_is_installed(&base.join("ggml-base.bin"), MODEL_SIZE) { MODEL_SIZE } else { 0 };
    Ok(RuntimeStatus { state: if ready() { "ready" } else if installed == total { "needsStart" } else { "needsInstall" }, endpoint: ENDPOINT, feature: RuntimeFeature::Speech, installed_bytes: installed, total_bytes: total, required_bytes: total - installed, message: "Local multilingual speech recognition uses CPU memory, preserving GPU headroom".into() })
}
pub(super) fn ensure(app: &RuntimeContext, state: &LocalRuntimeState) -> Result<RuntimeStatus, String> {
    let mut slot = state.speech_child.lock().map_err(|_| "Speech runtime lock failed")?;
    if let Some(child) = slot.as_mut() { if child.try_wait().map_err(|e| e.to_string())?.is_none() && ready() { return status(app); } }
    if let Some(mut child) = slot.take() { let _ = child.kill(); let _ = child.wait(); }
    if std::net::TcpStream::connect("127.0.0.1:8191").is_ok() { return Err("DnDRom's speech port 8191 is occupied".into()); }
    let base = app.data_dir.join("runtime/whisper-1.9.0"); fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let total = ARCHIVE_SIZE + MODEL_SIZE;
    if !base.join("bin/Release/whisper-server.exe").exists() {
        download_verified(app, RuntimeFeature::Speech, ARCHIVE_URL, &base.join("engine.zip"), ARCHIVE_SIZE, ARCHIVE_HASH, 0, total, "Local speech engine")?;
        extract_zip(&base.join("engine.zip"), &base.join("bin"))?;
    }
    download_verified(app, RuntimeFeature::Speech, MODEL_URL, &base.join("ggml-base.bin"), MODEL_SIZE, MODEL_HASH, ARCHIVE_SIZE, total, "Multilingual speech model")?;
    let log = File::create(base.join("server.log")).map_err(|e| e.to_string())?;
    let mut child = hidden_command(&base.join("bin/Release/whisper-server.exe"))
        .current_dir(&base).args(["--host", "127.0.0.1", "--port", "8191", "--no-gpu", "--threads", "4", "--language", "auto", "--model"])
        .arg(base.join("ggml-base.bin")).stdout(log.try_clone().map_err(|e| e.to_string())?).stderr(log).spawn().map_err(|e| e.to_string())?;
    if let Err(error) = state.process_job.assign_child(&child) { let _ = child.kill(); let _ = child.wait(); return Err(error); }
    for _ in 0..60 {
        if ready() { *slot = Some(child); emit(app, RuntimeFeature::Speech, "ready", total, total, "Local speech recognition is ready"); return status(app); }
        if child.try_wait().map_err(|e| e.to_string())?.is_some() { return Err("Local speech engine stopped; inspect its server.log".into()); }
        thread::sleep(Duration::from_secs(1));
    }
    let _ = child.kill(); let _ = child.wait(); Err("Local speech engine startup timed out".into())
}
