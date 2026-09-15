use super::*;

const ENDPOINT: &str = "http://127.0.0.1:8190/v1";
const ARCHIVE: (&str, u64, &str) = ("https://github.com/ggml-org/llama.cpp/releases/download/b10516/llama-b10516-bin-win-vulkan-x64.zip", 34861181, "530f57d2a874ce017827c1e5a926812b9d5de4667248575d1372b1c0acf94d83");
const MODEL_ROOT: &str = "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/bb5d59e06d9551d752d08b292a50eb208b07ab1f";
const SHARDS: [(&str, u64, &str); 2] = [
    (
        "qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf",
        3993201344,
        "dfce12e3862a5283ccfb88221b48480e58745165de856439950d0f22590580db",
    ),
    (
        "qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf",
        689872288,
        "539cf93f78e887edea1c04e2d7d8cdaca9d01dae9c9025bcb8accbe29df3d72a",
    ),
];
fn root(app: &RuntimeContext) -> Result<PathBuf, String> {
    Ok(app.data_dir.clone().join("runtime/language-b10516"))
}
fn ready() -> bool {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(1))
        .build()
        .ok()
        .and_then(|client| client.get(format!("{ENDPOINT}/models")).send().ok())
        .and_then(|response| response.json::<serde_json::Value>().ok())
        .is_some_and(|value| {
            value["data"]
                .as_array()
                .is_some_and(|models| models.iter().any(|model| model["id"] == "dndrom-director"))
        })
}
pub(super) fn status(app: &RuntimeContext) -> Result<RuntimeStatus, String> {
    let base = root(app)?;
    let total = ARCHIVE.1 + SHARDS.iter().map(|s| s.1).sum::<u64>();
    let installed = SHARDS
        .iter()
        .filter(|s| asset_is_installed(&base.join(s.0), s.1))
        .map(|s| s.1)
        .sum::<u64>()
        + if base.join("bin/llama-server.exe").exists() {
            ARCHIVE.1
        } else {
            0
        };
    Ok(RuntimeStatus {
        state: if ready() {
            "ready"
        } else if installed == total {
            "needsStart"
        } else {
            "needsInstall"
        },
        endpoint: ENDPOINT,
        feature: RuntimeFeature::LanguageModel,
        installed_bytes: installed,
        total_bytes: total,
        required_bytes: total.saturating_sub(installed),
        message: "DnDRom manages the local scene and Dungeon Master model".into(),
    })
}
pub(super) fn ensure(
    app: &RuntimeContext,
    state: &LocalRuntimeState,
    vram_reserve_gb: f32,
) -> Result<RuntimeStatus, String> {
    if !cfg!(target_os = "windows") {
        return Err("The managed language pack currently supports Windows x64".into());
    }
    let mut slot = state
        .language_child
        .lock()
        .map_err(|_| "Language runtime lock failed")?;
    if let Some(child) = slot.as_mut() {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() && ready() {
            return status(app);
        }
    }
    if let Some(mut child) = slot.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    if std::net::TcpStream::connect("127.0.0.1:8190").is_ok() {
        return Err("DnDRom's language port 8190 is occupied by another process. Close the other DnDRom instance and retry.".into());
    }
    let base = root(app)?;
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let total = ARCHIVE.1 + SHARDS.iter().map(|s| s.1).sum::<u64>();
    let feature = RuntimeFeature::LanguageModel;
    if !base.join("bin/llama-server.exe").exists() {
        download_verified(
            app,
            feature,
            ARCHIVE.0,
            &base.join("engine.zip"),
            ARCHIVE.1,
            ARCHIVE.2,
            0,
            total,
            "Local language engine",
        )?;
        extract_zip(&base.join("engine.zip"), &base.join("bin"))?;
    }
    let mut completed = ARCHIVE.1;
    for (name, size, hash) in SHARDS {
        download_verified(
            app,
            feature,
            &format!("{MODEL_ROOT}/{name}?download=true"),
            &base.join(name),
            size,
            hash,
            completed,
            total,
            "Scene and Dungeon Master model",
        )?;
        completed += size;
    }
    emit(
        app,
        feature,
        "starting",
        total,
        total,
        "Starting DnDRom's local language model",
    );
    // A fresh process is always app-owned and lives in the same kill-on-close
    // job as our other inference runtimes. No Ollama service or shell is used.
    let log = File::create(base.join("server.log")).map_err(|e| e.to_string())?;
    let fit_target = ((if vram_reserve_gb.is_finite() {
        vram_reserve_gb
    } else {
        4.0
    })
    .clamp(2.0, 32.0)
        * 1024.0)
        .ceil()
        .to_string();
    let mut child = hidden_command(&base.join("bin/llama-server.exe"))
        .current_dir(base.join("bin"))
        .args([
            "--host",
            "127.0.0.1",
            "--port",
            "8190",
            "--alias",
            "dndrom-director",
            "--ctx-size",
            "16384",
            "--parallel",
            "1",
            "--n-gpu-layers",
            "99",
            "--fit-target",
            &fit_target,
            "--no-webui",
        ])
        .arg("--model")
        .arg(base.join(SHARDS[0].0))
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log)
        .spawn()
        .map_err(|e| format!("Could not start local language engine: {e}"))?;
    if let Err(error) = state.process_job.assign_child(&child) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    for _ in 0..180 {
        if ready() {
            *slot = Some(child);
            emit(
                app,
                feature,
                "ready",
                total,
                total,
                "Local scene director is ready",
            );
            return status(app);
        }
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            return Err(format!(
                "Local language engine stopped. See {}",
                base.join("server.log").display()
            ));
        }
        thread::sleep(Duration::from_secs(1));
    }
    let _ = child.kill();
    let _ = child.wait();
    Err("Local language model did not become ready within three minutes".into())
}
