//! Owned local model host. Private stdin/stdout pipes, no network listener.
use dndrom_local_runtime::{LocalRuntimeState, RuntimeContext, RuntimeFeature};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    io::{self, BufRead, Write},
    path::PathBuf,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    version: u32,
    id: String,
    method: String,
    #[serde(default)]
    params: Value,
}

fn send(value: Value) {
    let mut out = io::stdout().lock();
    let _ = serde_json::to_writer(&mut out, &value);
    let _ = writeln!(out);
    let _ = out.flush();
}
fn data_directory() -> Result<PathBuf, String> {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some("--data-dir") {
        return Err(
            "Usage: dndrom-runtime-host --data-dir <absolute directory> [--parent-pid <pid>]"
                .into(),
        );
    }
    let path = PathBuf::from(args.next().ok_or("Missing data directory")?);
    if !path.is_absolute() {
        return Err("Data directory must be absolute".into());
    }
    if let Some(option) = args.next() {
        if option != "--parent-pid" {
            return Err("Unknown host option".into());
        }
        let pid = args
            .next()
            .ok_or("Missing parent PID")?
            .parse::<u32>()
            .map_err(|_| "Invalid parent PID")?;
        if pid == 0 || args.next().is_some() {
            return Err("Invalid parent PID or extra options".into());
        }
        watch_parent(pid)?;
    }
    Ok(path)
}

#[cfg(windows)]
fn watch_parent(pid: u32) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, WAIT_OBJECT_0},
        System::Threading::{OpenProcess, WaitForSingleObject, INFINITE, PROCESS_SYNCHRONIZE},
    };
    let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
    if handle.is_null() {
        return Err("Cannot monitor the Unreal parent process".into());
    }
    // Retaining the handle prevents PID reuse from attaching us to a different
    // process. Exit also closes kill-on-close model jobs if UE crashes while
    // the main thread is downloading or waiting for model startup.
    let owned = handle as usize;
    std::thread::spawn(move || {
        let result = unsafe { WaitForSingleObject(owned as _, INFINITE) };
        unsafe { CloseHandle(owned as _) };
        if result == WAIT_OBJECT_0 {
            std::process::exit(0);
        }
    });
    Ok(())
}
#[cfg(not(windows))]
fn watch_parent(_pid: u32) -> Result<(), String> {
    Err("Parent monitoring currently requires Windows".into())
}
fn dispatch(
    request: &Request,
    ctx: RuntimeContext,
    state: &mut LocalRuntimeState,
) -> Result<Value, String> {
    if request.version != 1 {
        return Err("Unsupported runtime protocol version".into());
    }
    if request.id.is_empty() || request.id.len() > 128 {
        return Err("Invalid request ID".into());
    }
    let feature = || {
        serde_json::from_value::<RuntimeFeature>(
            request
                .params
                .get("feature")
                .cloned()
                .unwrap_or(Value::Null),
        )
        .map_err(|e| e.to_string())
    };
    let reserve = match request.params.get("vramReserveGb") {
        None => 4.0,
        Some(v) => v.as_f64().ok_or("VRAM reservation must be a number")?,
    };
    if !reserve.is_finite() || !(0.75..=32.0).contains(&reserve) {
        return Err("Invalid VRAM reservation".into());
    }
    match request.method.as_str() {
        "system.hello" => Ok(
            json!({"protocol":"dndrom.runtime","version":1,"localOnly":true,"capabilities":["runtime.status","runtime.ensure","runtime.restart","runtime.release","rules.roll"]}),
        ),
        "runtime.status" => dndrom_local_runtime::local_runtime_status(ctx, feature()?)
            .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "runtime.ensure" => {
            dndrom_local_runtime::ensure_local_runtime(ctx, state, feature()?, Some(reserve as f32))
                .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string()))
        }
        "runtime.restart" => dndrom_local_runtime::restart_local_runtime(
            ctx,
            state,
            feature()?,
            Some(reserve as f32),
        )
        .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "runtime.release" => {
            state.shutdown(&ctx);
            *state = LocalRuntimeState::new()?;
            Ok(json!({"released":true}))
        }
        "runtime.provision" => dndrom_local_runtime::provision_local_creation_suite(ctx, state, Some(reserve as f32))
            .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "runtime.dataset" => dndrom_local_runtime::find_latest_local_world_dataset(ctx)
            .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "runtime.trained" => dndrom_local_runtime::find_latest_local_trained_world(ctx)
            .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "runtime.train" => {
            let path = request.params.get("datasetPath").and_then(Value::as_str).ok_or("Missing dataset path")?;
            let number = |key| request.params.get(key).and_then(Value::as_u64).and_then(|v| u32::try_from(v).ok());
            dndrom_local_runtime::train_local_world(ctx, state, path.into(), number("totalSteps"), number("maxSplats"), number("maxFrames"))
                .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string()))
        }
        "rules.roll" => {
            let roll =
                serde_json::from_value::<dndrom_domain::CheckRequest>(request.params.clone())
                    .map_err(|e| e.to_string())?;
            dndrom_domain::perform_check(&roll)
                .map_err(|e| e.to_string())
                .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string()))
        }
        _ => Err("Unknown runtime method".into()),
    }
}
fn run() -> Result<(), String> {
    let directory = data_directory()?;
    let mut state = LocalRuntimeState::new()?;
    let shutdown = RuntimeContext::new(directory.clone(), |_| {});
    let mut input = io::stdin().lock();
    loop {
        let mut bytes = Vec::new();
        // Bounded framing, including malformed input with no newline.
        loop {
            let available = input.fill_buf().map_err(|e| e.to_string())?;
            if available.is_empty() {
                break;
            }
            let count = available
                .iter()
                .position(|b| *b == b'\n')
                .map(|i| i + 1)
                .unwrap_or(available.len());
            if bytes.len() + count > 1024 * 1024 {
                state.shutdown(&shutdown);
                return Err("Runtime request exceeds 1 MiB".into());
            }
            bytes.extend_from_slice(&available[..count]);
            input.consume(count);
            if bytes.last() == Some(&b'\n') {
                break;
            }
        }
        if bytes.is_empty() {
            break;
        }
        match serde_json::from_slice::<Request>(&bytes) {
            Ok(request) => {
                let event_id = request.id.clone();
                let ctx = RuntimeContext::new(directory.clone(), move |progress| {
                    send(
                        json!({"version":1,"id":event_id,"event":"runtime.progress","data":progress}),
                    )
                });
                match dispatch(&request, ctx, &mut state) {
                    Ok(result) => {
                        send(json!({"version":1,"id":request.id,"ok":true,"result":result}))
                    }
                    Err(error) => {
                        send(json!({"version":1,"id":request.id,"ok":false,"error":error}))
                    }
                }
            }
            Err(error) => send(
                json!({"version":1,"id":null,"ok":false,"error":format!("Invalid request: {error}")}),
            ),
        }
    }
    state.shutdown(&shutdown);
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn negotiates_protocol_without_installing_or_loading_models() {
        let ctx = RuntimeContext::new(std::env::temp_dir().join("dndrom-protocol-test"), |_| {});
        let mut state = LocalRuntimeState::new().unwrap();
        let mut req = Request {
            version: 1,
            id: "test".into(),
            method: "system.hello".into(),
            params: Value::Null,
        };
        assert_eq!(
            dispatch(&req, ctx.clone(), &mut state).unwrap()["localOnly"],
            true
        );
        req.version = 9;
        assert!(dispatch(&req, ctx, &mut state).is_err());
    }
}
