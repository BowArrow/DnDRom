use serde_json::Value;
use std::{
    io::Write,
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

fn run(input: &[u8]) -> std::process::Output {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let directory =
        std::env::temp_dir().join(format!("dndrom-host-ipc-{}-{unique}", std::process::id()));
    let mut child = Command::new(env!("CARGO_BIN_EXE_dndrom-runtime-host"))
        .arg("--data-dir")
        .arg(&directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(input).unwrap();
    let output = child.wait_with_output().unwrap();
    // Handshake, malformed input and release must never install anything.
    assert!(!directory.exists());
    output
}

#[test]
fn private_pipe_protocol_recovers_from_bad_requests_and_shuts_down_on_eof() {
    let result = run(concat!(
        "{\"version\":1,\"id\":\"hello\",\"method\":\"system.hello\"}\n",
        "not-json\n",
        "{\"version\":1,\"id\":\"unknown\",\"method\":\"unknown\"}\n",
        "{\"version\":1,\"id\":\"release\",\"method\":\"runtime.release\"}\n",
        "{\"version\":1,\"id\":\"again\",\"method\":\"system.hello\"}\n"
    )
    .as_bytes());
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let messages: Vec<Value> = String::from_utf8(result.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(messages.len(), 5);
    assert_eq!(messages[0]["result"]["protocol"], "dndrom.runtime");
    assert_eq!(messages[1]["ok"], false);
    assert_eq!(messages[2]["id"], "unknown");
    assert_eq!(messages[2]["ok"], false);
    assert_eq!(messages[3]["result"]["released"], true);
    assert_eq!(messages[4]["ok"], true);
}

#[test]
fn rejects_oversized_unterminated_frames() {
    let result = run(&vec![b' '; 1024 * 1024 + 1]);
    assert!(!result.status.success());
    assert!(String::from_utf8_lossy(&result.stderr).contains("exceeds 1 MiB"));
}

#[cfg(windows)]
#[test]
fn host_exits_when_its_unreal_parent_dies_even_with_stdin_open() {
    use std::{
        io::{BufRead, BufReader},
        os::windows::process::CommandExt,
        time::{Duration, Instant},
    };
    struct Owned(std::process::Child);
    impl Drop for Owned {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let mut parent = Owned(
        Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 30",
            ])
            .creation_flags(0x08000000)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    let directory = std::env::temp_dir().join("dndrom-parent-watch-no-install");
    let mut host = Owned(
        Command::new(env!("CARGO_BIN_EXE_dndrom-runtime-host"))
            .arg("--data-dir")
            .arg(directory)
            .arg("--parent-pid")
            .arg(parent.0.id().to_string())
            .creation_flags(0x08000000)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap(),
    );
    // Leave stdin open throughout. Receiving hello establishes that the parent
    // watcher opened its process handle before the simulated crash.
    host.0
        .stdin
        .as_mut()
        .unwrap()
        .write_all(b"{\"version\":1,\"id\":\"hello\",\"method\":\"system.hello\"}\n")
        .unwrap();
    let mut line = String::new();
    BufReader::new(host.0.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    assert_eq!(serde_json::from_str::<Value>(&line).unwrap()["ok"], true);
    parent.0.kill().unwrap();
    parent.0.wait().unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if let Some(status) = host.0.try_wait().unwrap() {
            assert!(status.success());
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("Runtime host survived its parent process");
}
