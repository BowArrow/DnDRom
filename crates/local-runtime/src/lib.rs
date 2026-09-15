use reqwest::header::RANGE;
#[path = "language_runtime.rs"]
mod language;
mod speech_runtime;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
/// Platform-independent runtime location and progress sink.
#[derive(Clone)]
pub struct RuntimeContext {
    pub data_dir: PathBuf,
    progress: Arc<dyn Fn(RuntimeProgress) + Send + Sync>,
}
impl RuntimeContext {
    pub fn new(
        data_dir: PathBuf,
        progress: impl Fn(RuntimeProgress) + Send + Sync + 'static,
    ) -> Self {
        Self {
            data_dir,
            progress: Arc::new(progress),
        }
    }
    fn emit(&self, _event: &str, progress: RuntimeProgress) -> Result<(), String> {
        (self.progress)(progress);
        Ok(())
    }
}

#[cfg(target_os = "windows")]
use std::os::windows::io::AsRawHandle;
#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
    },
};

const ENDPOINT: &str = "http://127.0.0.1:8189";
const RUNTIME_VERSION: &str = "0.34.0";
const SUITE_MARKER: &str = ".dndrom-local-creation-suite-v1";
const PROP_SANA_DEPENDENCY_MARKER: &str = ".dndrom-prop-sana-dependencies-v2";
const PROP_SANA_DIFFUSERS_PACKAGE: &str = "diffusers==0.36.0";
const DNDROM_RUNTIME_NODE_MARKER: &str = ".dndrom-runtime-nodes-v6";
const DNDROM_RUNTIME_NODES: &str = r#"import json
import math
import os
import re
import struct
import time

import comfy.model_management


class DnDRomWanVAEDecode:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "samples": ("LATENT",),
            "vae": ("VAE",),
            "tile_size": ("INT", {"default": 2048, "min": 64, "max": 4096, "step": 32}),
            "overlap": ("INT", {"default": 64, "min": 0, "max": 4096, "step": 32}),
            "temporal_size": ("INT", {"default": 16, "min": 8, "max": 4096, "step": 4}),
            "temporal_overlap": ("INT", {"default": 4, "min": 4, "max": 4096, "step": 4}),
        }}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "decode"
    CATEGORY = "DnDRom/runtime"
    DESCRIPTION = "Evicts the diffusion model before a memory-bounded WAN VAE decode."

    def decode(self, vae, samples, tile_size, overlap, temporal_size, temporal_overlap):
        # The 14B WAN model otherwise remains resident after KSampler and leaves
        # a 10 GB GPU paging every VAE operation. The latent is already in host
        # memory, so explicitly release model residency before decoding it.
        comfy.model_management.unload_all_models()
        comfy.model_management.soft_empty_cache(True)
        free_gib = comfy.model_management.get_free_memory(comfy.model_management.get_torch_device()) / (1024 ** 3)
        started = time.perf_counter()
        print(f"[DnDRom VAE] WAN released; {free_gib:.2f} GiB free before bounded decode", flush=True)

        latent = samples["samples"]
        if latent.is_nested:
            latent = latent.unbind()[0]
        if tile_size < overlap * 4:
            overlap = tile_size // 4
        if temporal_size < temporal_overlap * 2:
            temporal_overlap = temporal_size // 2
        temporal_compression = vae.temporal_compression_decode()
        if temporal_compression is not None:
            temporal_size = max(2, temporal_size // temporal_compression)
            temporal_overlap = max(1, min(temporal_size // 2, temporal_overlap // temporal_compression))
        else:
            temporal_size = None
            temporal_overlap = None
        compression = vae.spacial_compression_decode()
        images = vae.decode_tiled(
            latent,
            tile_x=tile_size // compression,
            tile_y=tile_size // compression,
            overlap=overlap // compression,
            tile_t=temporal_size,
            overlap_t=temporal_overlap,
        )
        if len(images.shape) == 5:
            images = images.reshape(-1, images.shape[-3], images.shape[-2], images.shape[-1])
        print(f"[DnDRom VAE] decoded {len(images)} frames in {time.perf_counter() - started:.2f}s", flush=True)
        return (images,)


class DnDRomTrajectoryCoverage:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "control_mask_1": ("IMAGE",),
                "max_paths": ("INT", {"default": 4, "min": 1, "max": 4}),
            },
            "optional": {
                "control_mask_2": ("IMAGE",),
                "control_mask_3": ("IMAGE",),
                "control_mask_4": ("IMAGE",),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("coverage_report",)
    FUNCTION = "measure"
    CATEGORY = "DnDRom/runtime"
    DESCRIPTION = "Measures and ranks every authored camera path without pruning reconstruction coverage."
    OUTPUT_NODE = True

    def measure(self, control_mask_1, max_paths, control_mask_2=None, control_mask_3=None, control_mask_4=None):
        masks = [mask for mask in (control_mask_1, control_mask_2, control_mask_3, control_mask_4) if mask is not None]
        paths = []
        for index, mask in enumerate(masks):
            values = mask.float()
            if values.max().item() > 1.0:
                values = values / 255.0
            if values.ndim >= 4:
                frame_coverage = values.mean(dim=tuple(range(1, values.ndim)))
            else:
                frame_coverage = values.reshape(values.shape[0], -1).mean(dim=1)
            tail_start = max(0, int(frame_coverage.shape[0] * 0.66))
            mean = float(frame_coverage.mean().item())
            minimum = float(frame_coverage.min().item())
            tail = float(frame_coverage[tail_start:].mean().item())
            score = mean * 0.55 + minimum * 0.25 + tail * 0.20
            paths.append({"index": index, "mean": round(mean, 5), "minimum": round(minimum, 5), "tail": round(tail, 5), "score": round(score, 5)})

        recommended = min(max(1, int(max_paths)), len(paths))
        # Rank rails for progress scheduling only. All authored rails remain
        # part of the reconstruction so lower-memory profiles do not discard
        # the viewpoints needed to preserve panorama geometry.
        adjacent = sorted(
            [path for path in paths if path["index"] in (1, 3)],
            key=lambda path: (path["mean"], path["minimum"]),
        )
        remaining = sorted(
            [path for path in paths if path["index"] not in (0, 1, 3)],
            key=lambda path: (path["mean"], path["minimum"]),
        )
        supplements = adjacent + remaining
        selected = [0] + [path["index"] for path in supplements if path["index"] != 0]
        report = "DNDROM_COVERAGE:" + json.dumps({
            "selectedPaths": selected,
            "recommendedPathCount": recommended,
            "paths": paths,
        }, separators=(",", ":"))
        print(f"[DnDRom coverage] {report}", flush=True)
        return {"ui": {"text": [report]}, "result": (report,)}


class DnDRomDatasetResult:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"dataset_dir": ("STRING", {"forceInput": True})}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("dataset_dir",)
    FUNCTION = "report"
    CATEGORY = "DnDRom/runtime"
    OUTPUT_NODE = True

    def _read_images(self, path):
        images = []
        with open(path, "rb") as stream:
            count = struct.unpack("<Q", stream.read(8))[0]
            for _ in range(count):
                image_id = struct.unpack("<I", stream.read(4))[0]
                q = struct.unpack("<4d", stream.read(32))
                t = struct.unpack("<3d", stream.read(24))
                stream.read(4)
                name = bytearray()
                while True:
                    char = stream.read(1)
                    if not char or char == b"\0": break
                    name.extend(char)
                points = struct.unpack("<Q", stream.read(8))[0]
                stream.seek(points * 24, 1)
                # Camera center is -R^T t for COLMAP's world-to-camera pose.
                w, x, y, z = q
                rotation = ((1-2*y*y-2*z*z, 2*x*y-2*z*w, 2*x*z+2*y*w), (2*x*y+2*z*w, 1-2*x*x-2*z*z, 2*y*z-2*x*w), (2*x*z-2*y*w, 2*y*z+2*x*w, 1-2*x*x-2*y*y))
                center = tuple(-sum(rotation[row][column] * t[row] for row in range(3)) for column in range(3))
                images.append((image_id, name.decode("utf-8", "ignore"), center))
        return images

    def _read_points(self, path, limit=120000):
        points, tracks = [], []
        with open(path, "rb") as stream:
            count = struct.unpack("<Q", stream.read(8))[0]
            stride = max(1, count // limit)
            for index in range(count):
                stream.read(8)
                xyz = struct.unpack("<3d", stream.read(24))
                stream.read(11)
                track_length = struct.unpack("<Q", stream.read(8))[0]
                track = [struct.unpack("<II", stream.read(8))[0] for _ in range(track_length)]
                if index % stride == 0:
                    points.append(xyz); tracks.append(track)
        return points, tracks

    def _quality(self, dataset_dir):
        root = os.path.abspath(str(dataset_dir))
        sparse = os.path.join(root, "sparse", "0")
        images = self._read_images(os.path.join(sparse, "images.bin"))
        points, tracks = self._read_points(os.path.join(sparse, "points3D.bin"))
        expected_per_rail = 81
        rail_counts = [0, 0, 0, 0]
        unmatched = []
        for image_id, name, center in images:
            match = re.search(r"(?:camera|cam|rail|path)[_-]?(\d)", name.lower())
            if match and 1 <= int(match.group(1)) <= 4: rail_counts[int(match.group(1)) - 1] += 1
            else: unmatched.append((image_id, name, center))
        if unmatched:
            for index, _ in enumerate(sorted(unmatched, key=lambda item: item[1])):
                rail_counts[min(3, index * 4 // max(1, len(unmatched)))] += 1
        parent = {image_id: image_id for image_id, _, _ in images}
        def find(value):
            while parent.get(value, value) != value:
                parent[value] = parent[parent[value]]; value = parent[value]
            return value
        def union(left, right):
            a, b = find(left), find(right)
            if a != b: parent[b] = a
        for track in tracks:
            for image_id in track[1:]:
                if track[0] in parent and image_id in parent: union(track[0], image_id)
        component_sizes = {}
        for image_id in parent: component_sizes[find(image_id)] = component_sizes.get(find(image_id), 0) + 1
        largest_component = max(component_sizes.values(), default=0) / max(1, len(images))
        point_span = math.sqrt(sum((max(axis)-min(axis))**2 for axis in zip(*points))) if points else 0.0
        camera_span = math.sqrt(sum((max(axis)-min(axis))**2 for axis in zip(*(center for _, _, center in images)))) if len(images) > 1 else 0.0
        # Robustly score the strongest broad plane from deterministic point triples.
        plane_support = 0.0
        if len(points) >= 3 and point_span > 0:
            tolerance = max(0.01, point_span * 0.012)
            for offset in range(min(48, len(points) // 3)):
                a, b, c = points[offset], points[(offset * 37 + len(points)//3) % len(points)], points[(offset * 73 + 2*len(points)//3) % len(points)]
                ab = (b[0]-a[0], b[1]-a[1], b[2]-a[2]); ac = (c[0]-a[0], c[1]-a[1], c[2]-a[2])
                normal = (ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]); length = math.sqrt(sum(value*value for value in normal))
                if length < 1e-8: continue
                support = sum(1 for point in points if abs(sum(normal[i]*(point[i]-a[i]) for i in range(3))) / length <= tolerance) / len(points)
                plane_support = max(plane_support, min(1.0, support / 0.15))
        return {"registeredCameraRatio": min(1.0, len(images)/(4*expected_per_rail)), "railRegistrationRatios": [min(1.0, count/expected_per_rail) for count in rail_counts], "largestComponentRatio": largest_component, "groundPlaneSupport": plane_support, "boundsToRailRatio": point_span/max(1e-8, camera_span)}

    def report(self, dataset_dir):
        marker = "DNDROM_DATASET:" + str(dataset_dir)
        quality = "DNDROM_SFM_QUALITY:" + json.dumps(self._quality(dataset_dir), separators=(",", ":"))
        print(f"[DnDRom dataset] {marker}", flush=True)
        print(f"[DnDRom dataset] {quality}", flush=True)
        return {"ui": {"text": [marker, quality]}, "result": (str(dataset_dir),)}


NODE_CLASS_MAPPINGS = {
    "DnDRomWanVAEDecode": DnDRomWanVAEDecode,
    "DnDRomTrajectoryCoverage": DnDRomTrajectoryCoverage,
    "DnDRomDatasetResult": DnDRomDatasetResult,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "DnDRomWanVAEDecode": "DnDRom WAN VAE Decode",
    "DnDRomTrajectoryCoverage": "DnDRom Camera Coverage",
    "DnDRomDatasetResult": "DnDRom Dataset Result",
}
"#;
const INSTALL_OVERHEAD: u64 = 5 * 1024 * 1024 * 1024;
const BASE_SERVER_ARGS: &[&str] = &[
    "--windows-standalone-build",
    "--listen",
    "127.0.0.1",
    "--port",
    "8189",
    "--enable-cors-header",
    "--disable-auto-launch",
];

fn server_args(vram_reserve_gb: f32) -> Vec<String> {
    let reserve = if vram_reserve_gb.is_finite() {
        vram_reserve_gb.clamp(0.6, 4.0)
    } else {
        0.75
    };
    BASE_SERVER_ARGS
        .iter()
        .map(|value| (*value).to_string())
        .chain(["--reserve-vram".to_string(), format!("{reserve:.2}")])
        .collect()
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeFeature {
    LanguageModel,
    Speech,
    CharacterPixal3d,
    CharacterTrellis2,
    CharacterRig,
    PropImageLite,
    PropImageKrea,
    World,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    state: &'static str,
    endpoint: &'static str,
    feature: RuntimeFeature,
    installed_bytes: u64,
    total_bytes: u64,
    required_bytes: u64,
    message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProgress {
    feature: RuntimeFeature,
    stage: &'static str,
    completed_bytes: u64,
    total_bytes: u64,
    message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainedWorld {
    path: String,
    filename: String,
}

#[derive(Clone, Copy)]
struct DownloadAsset {
    name: &'static str,
    url: &'static str,
    relative_path: &'static str,
    size: u64,
    sha256: &'static str,
}

#[derive(Clone, Copy)]
struct NodeArchive {
    name: &'static str,
    repo: &'static str,
    commit: &'static str,
    size: u64,
    sha256: &'static str,
}

#[derive(Clone, Copy)]
struct RuntimeArchive {
    variant: &'static str,
    url: &'static str,
    size: u64,
    sha256: &'static str,
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
struct ManagedProcessJob {
    handle: Mutex<Option<HANDLE>>,
}

#[cfg(target_os = "windows")]
unsafe impl Send for ManagedProcessJob {}
#[cfg(target_os = "windows")]
unsafe impl Sync for ManagedProcessJob {}

#[cfg(target_os = "windows")]
impl ManagedProcessJob {
    fn new() -> Result<Self, String> {
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err("Could not create the local AI process group".into());
        }
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            unsafe { CloseHandle(handle) };
            return Err("Could not configure the local AI process group".into());
        }
        Ok(Self {
            handle: Mutex::new(Some(handle)),
        })
    }

    fn assign_child(&self, child: &Child) -> Result<(), String> {
        let handle = self
            .handle
            .lock()
            .map_err(|_| "Local AI process group lock failed".to_string())?;
        let job = handle.ok_or("The local AI process group is already closed")?;
        let assigned = unsafe { AssignProcessToJobObject(job, child.as_raw_handle() as HANDLE) };
        if assigned == 0 {
            return Err("Could not attach the local AI engine to DnDRom's process group".into());
        }
        Ok(())
    }

    fn assign_pid(&self, pid: u32) -> Result<(), String> {
        let process = unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid) };
        if process.is_null() {
            return Err("Could not reopen the existing local AI engine".into());
        }
        let result = self
            .handle
            .lock()
            .map_err(|_| "Local AI process group lock failed".to_string())
            .and_then(|handle| {
                let job = handle.ok_or("The local AI process group is already closed")?;
                if unsafe { AssignProcessToJobObject(job, process) } == 0 {
                    return Err("Could not adopt the existing local AI engine".into());
                }
                Ok(())
            });
        unsafe { CloseHandle(process) };
        result
    }

    fn shutdown(&self) {
        let Ok(mut handle) = self.handle.lock() else {
            return;
        };
        let Some(job) = handle.take() else {
            return;
        };
        unsafe {
            TerminateJobObject(job, 0);
            CloseHandle(job);
        }
    }
}

#[cfg(not(target_os = "windows"))]
#[derive(Debug, Default)]
struct ManagedProcessJob;

#[cfg(not(target_os = "windows"))]
impl ManagedProcessJob {
    fn new() -> Result<Self, String> {
        Ok(Self)
    }
    fn assign_child(&self, _child: &Child) -> Result<(), String> {
        Ok(())
    }
    fn shutdown(&self) {}
}

impl Drop for ManagedProcessJob {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[derive(Clone)]
pub struct LocalRuntimeState {
    owner_lock: Arc<Mutex<Option<File>>>,
    language_child: Arc<Mutex<Option<Child>>>,
    speech_child: Arc<Mutex<Option<Child>>>,
    install_gate: Arc<Mutex<()>>,
    child: Arc<Mutex<Option<Child>>>,
    process_job: Arc<ManagedProcessJob>,
}

impl LocalRuntimeState {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            owner_lock: Arc::new(Mutex::new(None)),
            language_child: Arc::new(Mutex::new(None)),
            speech_child: Arc::new(Mutex::new(None)),
            install_gate: Arc::new(Mutex::new(())),
            child: Arc::new(Mutex::new(None)),
            process_job: Arc::new(ManagedProcessJob::new()?),
        })
    }

    pub fn shutdown(&self, app: &RuntimeContext) {
        let mut owner = self.owner_lock.lock().unwrap_or_else(|e| e.into_inner());
        if let Ok(mut slot) = self.speech_child.lock() { if let Some(mut child) = slot.take() { let _ = child.kill(); let _ = child.wait(); } }
        if let Ok(mut slot) = self.language_child.lock() {
            if let Some(mut child) = slot.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        if let Ok(mut slot) = self.child.lock() {
            if let Some(mut child) = slot.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        self.process_job.shutdown();
        if owner.is_some() && server_ready() {
            let _ = stop_trusted_orphaned_server(app);
        }
        owner.take();
    }

    fn claim(&self, app: &RuntimeContext) -> Result<(), String> {
        let mut owner = self
            .owner_lock
            .lock()
            .map_err(|_| "Runtime ownership lock failed")?;
        if owner.is_none() {
            let file = OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(runtime_base(app)?.join("owner.lock"))
                .map_err(|e| e.to_string())?;
            fs2::FileExt::try_lock_exclusive(&file).map_err(|_| "Another DnDRom client owns the local model runtime. Close that client before starting models here.".to_string())?;
            *owner = Some(file);
        }
        Ok(())
    }
}

impl Default for LocalRuntimeState {
    fn default() -> Self {
        Self::new().expect("could not initialize the local AI process group")
    }
}

impl Drop for LocalRuntimeState {
    fn drop(&mut self) {
        if Arc::strong_count(&self.child) != 1 {
            return;
        }
        if let Ok(mut value) = self.child.lock() {
            if let Some(child) = value.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        if Arc::strong_count(&self.process_job) == 1 {
            self.process_job.shutdown();
        }
    }
}

const CHARACTER_MODELS: &[DownloadAsset] = &[
    DownloadAsset {
        name: "Pixal3D INT8",
        url: "https://huggingface.co/Comfy-Org/Pixal3D/resolve/main/diffusion_models/pixal3d_int8_convrot.safetensors?download=true",
        relative_path: "diffusion_models/pixal3d_int8_convrot.safetensors",
        size: 5_584_555_824,
        sha256: "4621eac3b715484f79303c7152af641fe0b2b14f4d0e3d394fd6922d00f955ec",
    },
    DownloadAsset {
        name: "DINO vision encoder",
        url: "https://huggingface.co/Comfy-Org/Pixal3D/resolve/main/clip_vision/dino_v3_L_naf_fp32.safetensors?download=true",
        relative_path: "clip_vision/dino_v3_L_naf_fp32.safetensors",
        size: 1_215_214_176,
        sha256: "4ad2ec4e0879a5b5b04cd97325cc37da954a7b6edca5170b86510f17f2b2290f",
    },
    DownloadAsset {
        name: "Trellis shape decoder",
        url: "https://huggingface.co/Comfy-Org/Pixal3D/resolve/main/vae/trellis_2_shape_vae_bf16.safetensors?download=true",
        relative_path: "vae/trellis_2_shape_vae_bf16.safetensors",
        size: 1_095_844_024,
        sha256: "de0cb4949a76c59ee5c091a995a69bcc8c51d5aeda939f0c641a50d2a72341f4",
    },
    DownloadAsset {
        name: "Trellis texture decoder",
        url: "https://huggingface.co/Comfy-Org/Pixal3D/resolve/main/vae/trellis_2_texture_vae_bf16.safetensors?download=true",
        relative_path: "vae/trellis_2_texture_vae_bf16.safetensors",
        size: 948_461_364,
        sha256: "714e5ebf094a610e12a8e3b5175c18a62f37f6ea4218acb6073644456b73ab0e",
    },
    DownloadAsset {
        name: "MoGe 2 geometry estimator",
        url: "https://huggingface.co/Comfy-Org/MoGe/resolve/main/geometry_estimation/moge_2_vitl_normal_fp16.safetensors?download=true",
        relative_path: "geometry_estimation/moge_2_vitl_normal_fp16.safetensors",
        size: 661_859_924,
        sha256: "cb1a692d03235671e959e81360d7b4d9f44aefadb1f852d6ca6aa17799d5e31f",
    },
    DownloadAsset {
        name: "BiRefNet subject extractor",
        url: "https://huggingface.co/Comfy-Org/BiRefNet/resolve/main/background_removal/birefnet.safetensors?download=true",
        relative_path: "background_removal/birefnet.safetensors",
        size: 444_473_596,
        sha256: "9ab37426bf4de0567af6b5d21b16151357149139362e6e8992021b8ce356a154",
    },
];

const TRELLIS_MODELS: &[DownloadAsset] = &[
    DownloadAsset {
        name: "TRELLIS.2 INT8",
        url: "https://huggingface.co/Comfy-Org/TRELLIS.2/resolve/main/diffusion_models/trellis_2_int8_convrot.safetensors?download=true",
        relative_path: "diffusion_models/trellis_2_int8_convrot.safetensors",
        size: 5_253_048_192,
        sha256: "d01952ad137213f6a868f86b6b877026276f84af5eec23069217475a0bad3a31",
    },
    DownloadAsset {
        name: "TRELLIS.2 vision encoder",
        url: "https://huggingface.co/Comfy-Org/TRELLIS.2/resolve/main/clip_vision/dino_v3_vit_l.safetensors?download=true",
        relative_path: "clip_vision/dino_v3_vit_l.safetensors",
        size: 1_212_559_776,
        sha256: "5cb785e458de7c460579082418af81f5c62380c181599344bdc60898c63468ee",
    },
    DownloadAsset {
        name: "Trellis shape decoder",
        url: "https://huggingface.co/Comfy-Org/TRELLIS.2/resolve/main/vae/trellis_2_shape_vae_bf16.safetensors?download=true",
        relative_path: "vae/trellis_2_shape_vae_bf16.safetensors",
        size: 1_095_844_024,
        sha256: "de0cb4949a76c59ee5c091a995a69bcc8c51d5aeda939f0c641a50d2a72341f4",
    },
    DownloadAsset {
        name: "Trellis texture decoder",
        url: "https://huggingface.co/Comfy-Org/TRELLIS.2/resolve/main/vae/trellis_2_texture_vae_bf16.safetensors?download=true",
        relative_path: "vae/trellis_2_texture_vae_bf16.safetensors",
        size: 948_461_364,
        sha256: "714e5ebf094a610e12a8e3b5175c18a62f37f6ea4218acb6073644456b73ab0e",
    },
    DownloadAsset {
        name: "MoGe 2 geometry estimator",
        url: "https://huggingface.co/Comfy-Org/MoGe/resolve/main/geometry_estimation/moge_2_vitl_normal_fp16.safetensors?download=true",
        relative_path: "geometry_estimation/moge_2_vitl_normal_fp16.safetensors",
        size: 661_859_924,
        sha256: "cb1a692d03235671e959e81360d7b4d9f44aefadb1f852d6ca6aa17799d5e31f",
    },
    DownloadAsset {
        name: "BiRefNet subject extractor",
        url: "https://huggingface.co/Comfy-Org/BiRefNet/resolve/main/background_removal/birefnet.safetensors?download=true",
        relative_path: "background_removal/birefnet.safetensors",
        size: 444_473_596,
        sha256: "9ab37426bf4de0567af6b5d21b16151357149139362e6e8992021b8ce356a154",
    },
];

const WORLD_MODELS: &[DownloadAsset] = &[
    DownloadAsset {
        name: "Krea panorama model",
        url: "https://huggingface.co/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_turbo_fp8_scaled.safetensors?download=true",
        relative_path: "diffusion_models/krea2_turbo_fp8_scaled.safetensors",
        size: 13_141_730_784,
        sha256: "eb4dd8c612cfd10f64f25b057e6e6bbcb5737c94a7372177e456dbf7579502f1",
    },
    DownloadAsset {
        name: "Krea text encoder",
        url: "https://huggingface.co/Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors?download=true",
        relative_path: "text_encoders/qwen3vl_4b_fp8_scaled.safetensors",
        size: 5_242_467_968,
        sha256: "54bd5144df0bbc25dd6ccadfcb826b521445a1b06ae5a42570bdd2974ca87094",
    },
    DownloadAsset {
        name: "Krea 360 panorama adapter",
        url: "https://huggingface.co/mickmumpitz/Krea2-360-ERP-LoRAs/resolve/main/krea2_t2i_360_erp_lora_v1.safetensors?download=true",
        relative_path: "loras/krea/krea2_t2i_360_erp_lora_v1.safetensors",
        size: 228_587_744,
        sha256: "46587da116a8cdd9ab8fa8850b06effd49970929d071294018d33cdfaa2a6bda",
    },
    DownloadAsset {
        name: "WAN panorama world model",
        url: "https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan2_1-I2V-14B-720P_fp8_e4m3fn.safetensors?download=true",
        relative_path: "diffusion_models/wan/Wan2_1-I2V-14B-720P_fp8_e4m3fn.safetensors",
        size: 16_993_877_896,
        sha256: "993d4cf51527a2fdc3b9079efa636cf6ccd8bca063cc695fcc64ed4b4e739305",
    },
    DownloadAsset {
        name: "WAN fast sampler",
        url: "https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors?download=true",
        relative_path: "loras/lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors",
        size: 630_697_104,
        sha256: "37d49218544b9e0bfb8e831d1399f451fbc5068aff6474f42a90c928363c3573",
    },
    DownloadAsset {
        name: "WAN 360 camera adapter",
        url: "https://huggingface.co/mickmumpitz/Wan2.1-Pano360-LoRA/resolve/main/pano_video_gen_720p_comfy.safetensors?download=true",
        relative_path: "loras/pano_video_gen_720p_comfy.safetensors",
        size: 306_809_616,
        sha256: "c1d669abb9f99aa01fab12481bf10891bd0b007576875a945381b7f1ef29e7c6",
    },
    DownloadAsset {
        name: "WAN text encoder",
        url: "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors?download=true",
        relative_path: "text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors",
        size: 6_735_906_897,
        sha256: "c3355d30191f1f066b26d93fba017ae9809dce6c627dda5f6a66eaa651204f68",
    },
    DownloadAsset {
        name: "WAN vision encoder",
        url: "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/clip_vision/clip_vision_h.safetensors?download=true",
        relative_path: "clip_vision/clip_vision_h.safetensors",
        size: 1_264_219_396,
        sha256: "64a7ef761bfccbadbaa3da77366aac4185a6c58fa5de5f589b42a65bcc21f161",
    },
    DownloadAsset {
        name: "WAN image decoder",
        url: "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors?download=true",
        relative_path: "vae/wan_2.1_vae.safetensors",
        size: 253_815_318,
        sha256: "2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b",
    },
    DownloadAsset {
        name: "World detail upscaler",
        url: "https://huggingface.co/Kim2091/UltraSharp/resolve/main/4x-UltraSharp.pth?download=true",
        relative_path: "upscale_models/4x-UltraSharp.pth",
        size: 66_961_958,
        sha256: "a5812231fc936b42af08a5edba784195495d303d5b3248c24489ef0c4021fe01",
    },
];

const PROP_KREA_MODELS: &[DownloadAsset] = &[
    DownloadAsset { name: "Krea 2 Turbo prop model", url: "https://huggingface.co/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_turbo_fp8_scaled.safetensors?download=true", relative_path: "diffusion_models/krea2_turbo_fp8_scaled.safetensors", size: 13_141_730_784, sha256: "eb4dd8c612cfd10f64f25b057e6e6bbcb5737c94a7372177e456dbf7579502f1" },
    DownloadAsset { name: "Krea 2 text encoder", url: "https://huggingface.co/Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors?download=true", relative_path: "text_encoders/qwen3vl_4b_fp8_scaled.safetensors", size: 5_242_467_968, sha256: "54bd5144df0bbc25dd6ccadfcb826b521445a1b06ae5a42570bdd2974ca87094" },
    DownloadAsset { name: "Krea 2 image decoder", url: "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors?download=true", relative_path: "vae/wan_2.1_vae.safetensors", size: 253_815_318, sha256: "2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b" },
];

const PROP_SANA_MODELS: &[DownloadAsset] = &[
    DownloadAsset { name: "Sana 1.5 1.6B FP8", url: "https://huggingface.co/sharp-y/sana1.5_1.6b_1024px_fp8/resolve/main/sana1.5_1.6b_1024px_fp8.safetensors?download=true", relative_path: "checkpoints/sana1.5_1.6b_1024px_fp8.safetensors", size: 1_608_546_672, sha256: "1a8b6eea5b37d4e53bf4d8c484857ec352fdfdd1be3822cf0f852bf01bf942c4" },
    DownloadAsset { name: "Sana Gemma 2 text encoder", url: "https://huggingface.co/Efficient-Large-Model/gemma-2-2b-it/resolve/main/gemma-2-2b-it.safetensors?download=true", relative_path: "text_encoders/models-efficient-large-model--gemma-2-2b-it/model.safetensors", size: 5_228_717_512, sha256: "bf06a1e6cfe1610beb98a2975e5602e7fc108d902b3ff9dd62282d749c7a2394" },
    DownloadAsset { name: "Sana Gemma config", url: "https://huggingface.co/Efficient-Large-Model/gemma-2-2b-it/resolve/main/config.json?download=true", relative_path: "text_encoders/models-efficient-large-model--gemma-2-2b-it/config.json", size: 881, sha256: "b3195cba8e4a8e637f15bc0bab6b48fd0f4e02967fac72925e2dfb02c4d5b8d7" },
    DownloadAsset { name: "Sana Gemma generation config", url: "https://huggingface.co/Efficient-Large-Model/gemma-2-2b-it/resolve/main/generation_config.json?download=true", relative_path: "text_encoders/models-efficient-large-model--gemma-2-2b-it/generation_config.json", size: 187, sha256: "069b655f964da6484bea4ab6ecfc34f6c5f47448a5b88711218555a76dce34e8" },
    DownloadAsset { name: "Sana Gemma special tokens", url: "https://huggingface.co/Efficient-Large-Model/gemma-2-2b-it/resolve/main/special_tokens_map.json?download=true", relative_path: "text_encoders/models-efficient-large-model--gemma-2-2b-it/special_tokens_map.json", size: 636, sha256: "baec30ea10906f16adb8c18af7a34023002c1746542612b8b41c9f09e1351351" },
    DownloadAsset { name: "Sana Gemma tokenizer", url: "https://huggingface.co/Efficient-Large-Model/gemma-2-2b-it/resolve/main/tokenizer.json?download=true", relative_path: "text_encoders/models-efficient-large-model--gemma-2-2b-it/tokenizer.json", size: 17_525_357, sha256: "3f289bc05132635a8bc7aca7aa21255efd5e18f3710f43e3cdb96bcd41be4922" },
    DownloadAsset { name: "Sana Gemma tokenizer model", url: "https://huggingface.co/Efficient-Large-Model/gemma-2-2b-it/resolve/main/tokenizer.model?download=true", relative_path: "text_encoders/models-efficient-large-model--gemma-2-2b-it/tokenizer.model", size: 4_241_003, sha256: "61a7b147390c64585d6c3543dd6fc636906c9af3865a5548f27f31aee1d4c8e2" },
    DownloadAsset { name: "Sana Gemma tokenizer config", url: "https://huggingface.co/Efficient-Large-Model/gemma-2-2b-it/resolve/main/tokenizer_config.json?download=true", relative_path: "text_encoders/models-efficient-large-model--gemma-2-2b-it/tokenizer_config.json", size: 46_996, sha256: "cb32b7929c62608d46572e813112b3ad8a841fb98fdd6a4da8559e368a951c89" },
    DownloadAsset { name: "Sana DC-AE image decoder", url: "https://huggingface.co/mit-han-lab/dc-ae-f32c32-sana-1.1-diffusers/resolve/main/diffusion_pytorch_model.safetensors?download=true", relative_path: "vae/dc-ae-f32c32-sana-1.1-diffusers.safetensors", size: 1_249_044_836, sha256: "dfd991d1b54ffabf22745c5885589d8f2a7bc59930d95d92bd741c4fc64454bb" },
];

const PROP_SANA_NODES: &[NodeArchive] = &[NodeArchive {
    name: "ComfyUI_ExtraModels",
    repo: "lawrence-cj/ComfyUI_ExtraModels",
    commit: "09e895cf35384979e0bb9a1ea01fe8f3db913516",
    size: 3_187_651,
    sha256: "7e439854da41c3aef5282f65733bfc0836f1d8fded59539c56e338986fc3e01e",
}];

const WORLD_NODES: &[NodeArchive] = &[
    NodeArchive {
        name: "ComfyUI-UniRig",
        repo: "PozzettiAndrea/ComfyUI-UniRig",
        commit: "69ee59dc459d2da7cb0291930c1f944886c31d7c",
        size: 28_997_346,
        sha256: "66bfd0f8ee417eca6fb6685baafa0fb3c3796f14892e6536e6912c9d05dc3fe3",
    },
    NodeArchive {
        name: "comfyui-LatLong",
        repo: "cedarconnor/comfyui-LatLong",
        commit: "385df054196e0028f9f13321af1e6d56ad7f9e23",
        size: 51_822,
        sha256: "dc597ace2ba9e97908cca8b9e7b720fb4fa9e6acf7d06e28851cc3aca5ec9201",
    },
    NodeArchive {
        name: "ComfyUI_essentials",
        repo: "cubiq/ComfyUI_essentials",
        commit: "9d9f4bedfc9f0321c19faf71855e228c93bd0dc9",
        size: 72_361,
        sha256: "b5a6cd3cdb88abe80c9ba021ffb3f20760418d7f212a4bb139bd7defa3d59e44",
    },
    NodeArchive {
        name: "ComfyUI_UltimateSDUpscale",
        repo: "ssitu/ComfyUI_UltimateSDUpscale",
        commit: "a5547db9e1d07d3318bb21e9e9c474f4c1e9c8df",
        size: 256_459,
        sha256: "47ef9d567d20a2ef8b96ff9a3e1bbed8f764ffb04988d0d4b32d020281fc73d1",
    },
    NodeArchive {
        name: "ComfyUI-Mickmumpitz-Nodes",
        repo: "mickmumpitz/ComfyUI-Mickmumpitz-Nodes",
        commit: "4d5ff7c433884631599c3b2d82011a2cbbeea37e",
        size: 193_940,
        sha256: "6880dae4c11da0cac515bc30c36f0629964c86b6b79847ba402facccd446bf03",
    },
    NodeArchive {
        name: "ComfyUI-SplatKit",
        repo: "mickmumpitz/ComfyUI-SplatKit",
        commit: "f59de2529772b01ffa627545552a00d812af7475",
        size: 573_483,
        sha256: "67476cd6331998deb68b41157b0374be4005cbf7f284a6f47f37956d31983d14",
    },
];

const BRUSH: DownloadAsset = DownloadAsset {
    name: "Brush world trainer",
    url: "https://github.com/ArthurBrussee/brush/releases/download/v0.3.0/brush-app-x86_64-pc-windows-msvc.zip",
    relative_path: "tools/brush-v0.3.0.zip",
    size: 158_791_348,
    sha256: "b68e3e9cf052d51bf3ee30776fa5a364de7f2ba13b58443128ff797bb7bcfcd6",
};

fn runtime_archive() -> RuntimeArchive {
    let vendor = detect_gpu_vendor();
    match vendor.as_str() {
        "amd" => RuntimeArchive {
            variant: "amd",
            url: "https://github.com/Comfy-Org/ComfyUI/releases/download/v0.34.0/ComfyUI_windows_portable_amd.7z",
            size: 1_817_392_344,
            sha256: "da9317b62eab26865563b0529012799fd1f63e604d4ce81432c4e98eb6008b3f",
        },
        "intel" => RuntimeArchive {
            variant: "intel",
            url: "https://github.com/Comfy-Org/ComfyUI/releases/download/v0.34.0/ComfyUI_windows_portable_intel.7z",
            size: 1_734_410_473,
            sha256: "7dd41db69b53b4db120ce617d310c785e9fe9c0c9d634a3ea57cd877cab89e9e",
        },
        _ => RuntimeArchive {
            variant: "nvidia",
            url: "https://github.com/Comfy-Org/ComfyUI/releases/download/v0.34.0/ComfyUI_windows_portable_nvidia.7z",
            size: 2_146_721_943,
            sha256: "ed57cc6b19ae3d83add1ecebfdd56b25e04e0008cf0fe9af43a4ad8797e2a24c",
        },
    }
}

fn detect_gpu_vendor() -> String {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty AdapterCompatibility) -join ';'"])
            .creation_flags(0x08000000)
            .output();
        let value = output
            .ok()
            .map(|result| String::from_utf8_lossy(&result.stdout).to_lowercase())
            .unwrap_or_default();
        if value.contains("nvidia") {
            return "nvidia".into();
        }
        if value.contains("advanced micro devices") || value.contains("amd") {
            return "amd".into();
        }
        if value.contains("intel") {
            return "intel".into();
        }
    }
    "cpu".into()
}

fn runtime_base(app: &RuntimeContext) -> Result<PathBuf, String> {
    let path = app.data_dir.join("runtime");
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn portable_root(app: &RuntimeContext) -> Result<PathBuf, String> {
    Ok(runtime_base(app)?
        .join(format!("comfy-{RUNTIME_VERSION}"))
        .join("ComfyUI_windows_portable"))
}

fn models(feature: RuntimeFeature) -> &'static [DownloadAsset] {
    match feature {
        RuntimeFeature::LanguageModel | RuntimeFeature::Speech => &[],
        RuntimeFeature::CharacterPixal3d => CHARACTER_MODELS,
        RuntimeFeature::CharacterTrellis2 => TRELLIS_MODELS,
        RuntimeFeature::CharacterRig => &[],
        RuntimeFeature::PropImageLite => PROP_SANA_MODELS,
        RuntimeFeature::PropImageKrea => PROP_KREA_MODELS,
        RuntimeFeature::World => WORLD_MODELS,
    }
}

fn nodes(feature: RuntimeFeature) -> &'static [NodeArchive] {
    match feature {
        RuntimeFeature::CharacterRig => &WORLD_NODES[..1],
        RuntimeFeature::PropImageLite => PROP_SANA_NODES,
        RuntimeFeature::World => WORLD_NODES,
        _ => &[],
    }
}

fn feature_total(feature: RuntimeFeature, archive: RuntimeArchive) -> u64 {
    archive.size
        + models(feature).iter().map(|asset| asset.size).sum::<u64>()
        + nodes(feature).iter().map(|asset| asset.size).sum::<u64>()
        + if feature == RuntimeFeature::World {
            BRUSH.size
        } else {
            0
        }
}

fn asset_is_installed(path: &Path, size: u64) -> bool {
    path.metadata()
        .map(|metadata| metadata.len() == size)
        .unwrap_or(false)
}

fn installed_bytes(
    app: &RuntimeContext,
    feature: RuntimeFeature,
    archive: RuntimeArchive,
) -> Result<u64, String> {
    let root = portable_root(app)?;
    let runtime_ready =
        root.join("python_embeded/python.exe").exists() && root.join("ComfyUI/main.py").exists();
    let mut installed = if runtime_ready { archive.size } else { 0 };
    for asset in models(feature) {
        if asset_is_installed(
            &root.join("ComfyUI/models").join(asset.relative_path),
            asset.size,
        ) {
            installed += asset.size;
        }
    }
    if !nodes(feature).is_empty() {
        for node in nodes(feature) {
            if root.join("ComfyUI/custom_nodes").join(node.name).exists() {
                installed += node.size;
            }
        }
        if find_brush_binary(&runtime_base(app)?.join("tools/brush")).is_some() {
            installed += BRUSH.size;
        }
    }
    Ok(installed)
}

fn server_ready() -> bool {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .ok()
        .and_then(|client| client.get(format!("{ENDPOINT}/system_stats")).send().ok())
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

fn emit(
    app: &RuntimeContext,
    feature: RuntimeFeature,
    stage: &'static str,
    completed: u64,
    total: u64,
    message: impl Into<String>,
) {
    let _ = app.emit(
        "local-runtime-progress",
        RuntimeProgress {
            feature,
            stage,
            completed_bytes: completed,
            total_bytes: total,
            message: message.into(),
        },
    );
}

pub fn local_runtime_status(
    app: RuntimeContext,
    feature: RuntimeFeature,
) -> Result<RuntimeStatus, String> {
    status_inner(&app, feature)
}

fn status_inner(app: &RuntimeContext, feature: RuntimeFeature) -> Result<RuntimeStatus, String> {
    if feature == RuntimeFeature::Speech { return speech_runtime::status(app); }
    if feature == RuntimeFeature::LanguageModel {
        return language::status(app);
    }
    let archive = runtime_archive();
    let total = feature_total(feature, archive);
    let installed = installed_bytes(app, feature, archive)?;
    let running = server_ready();
    Ok(RuntimeStatus {
        state: if running && installed >= total {
            "ready"
        } else if running {
            "external"
        } else if installed >= total {
            "needsStart"
        } else {
            "needsInstall"
        },
        endpoint: ENDPOINT,
        feature,
        installed_bytes: installed,
        total_bytes: total,
        required_bytes: total.saturating_sub(installed),
        message: if running && installed >= total {
            "Local creation tools are ready".into()
        } else if running {
            "A compatible local generator is already running".into()
        } else if installed >= total {
            "Local creation tools are installed and will start automatically".into()
        } else {
            "DnDRom will prepare the local creation tools automatically".into()
        },
    })
}

pub fn ensure_local_runtime(
    app: RuntimeContext,
    state: &LocalRuntimeState,
    feature: RuntimeFeature,
    vram_reserve_gb: Option<f32>,
) -> Result<RuntimeStatus, String> {
    let manager = state.clone();
    ensure_inner(&app, &manager, feature, vram_reserve_gb.unwrap_or(0.75))
}

pub fn restart_local_runtime(
    app: RuntimeContext,
    state: &LocalRuntimeState,
    feature: RuntimeFeature,
    vram_reserve_gb: Option<f32>,
) -> Result<RuntimeStatus, String> {
    let manager = state.clone();
    manager.claim(&app)?;
    (|| {
        if feature == RuntimeFeature::Speech {
            if let Ok(mut slot) = manager.speech_child.lock() { if let Some(mut child) = slot.take() { let _ = child.kill(); let _ = child.wait(); } }
        } else if feature == RuntimeFeature::LanguageModel {
            if let Ok(mut slot) = manager.language_child.lock() {
                if let Some(mut child) = slot.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        } else if server_ready() {
            stop_managed_server(&app, &manager)?;
        }
        ensure_inner(&app, &manager, feature, vram_reserve_gb.unwrap_or(0.75))
    })()
}

pub fn provision_local_creation_suite(
    app: RuntimeContext,
    state: &LocalRuntimeState,
    vram_reserve_gb: Option<f32>,
) -> Result<RuntimeStatus, String> {
    let manager = state.clone();
    (|| {
        if std::env::var_os("DNDROM_SKIP_RUNTIME_BOOTSTRAP").is_some() {
            return status_inner(&app, RuntimeFeature::World);
        }
        ensure_inner(
            &app,
            &manager,
            RuntimeFeature::LanguageModel,
            vram_reserve_gb.unwrap_or(0.75),
        )?;
        let marker = runtime_base(&app)?.join(SUITE_MARKER);
        let archive = runtime_archive();
        let features = [
            RuntimeFeature::CharacterPixal3d,
            RuntimeFeature::CharacterTrellis2,
            RuntimeFeature::PropImageLite,
            RuntimeFeature::World,
        ];
        let complete = features.iter().all(|feature| {
            installed_bytes(&app, *feature, archive)
                .map(|installed| installed >= feature_total(*feature, archive))
                .unwrap_or(false)
        });
        if marker.exists() && complete {
            return status_inner(&app, RuntimeFeature::World);
        }
        for feature in features {
            ensure_inner(&app, &manager, feature, vram_reserve_gb.unwrap_or(0.75))?;
        }
        fs::write(&marker, b"complete\n")
            .map_err(|error| format!("Could not record local creation setup: {error}"))?;
        status_inner(&app, RuntimeFeature::World)
    })()
}

fn ensure_inner(
    app: &RuntimeContext,
    state: &LocalRuntimeState,
    feature: RuntimeFeature,
    vram_reserve_gb: f32,
) -> Result<RuntimeStatus, String> {
    state.claim(app)?;
    let _gate = state
        .install_gate
        .lock()
        .map_err(|_| "Local runtime installer lock failed".to_string())?;
    if feature == RuntimeFeature::LanguageModel {
        return language::ensure(app, state, vram_reserve_gb);
    }
    if feature == RuntimeFeature::Speech { return speech_runtime::ensure(app, state); }
    let archive = runtime_archive();
    let total = feature_total(feature, archive);
    let installed = installed_bytes(app, feature, archive)?;
    let base = runtime_base(app)?;
    let node_setup_marker = portable_root(app)?
        .join("ComfyUI/custom_nodes")
        .join(match feature {
            RuntimeFeature::CharacterRig => ".dndrom-character-rig-dependencies-v1",
            RuntimeFeature::PropImageLite => PROP_SANA_DEPENDENCY_MARKER,
            _ => ".dndrom-world-dependencies-v2",
        });
    let runtime_node_marker = portable_root(app)?
        .join("ComfyUI/custom_nodes/DnDRom_Runtime")
        .join(DNDROM_RUNTIME_NODE_MARKER);
    let runtime_node_needed = feature == RuntimeFeature::World && !runtime_node_marker.exists();
    let node_setup_needed =
        (!nodes(feature).is_empty() && !node_setup_marker.exists()) || runtime_node_needed;
    if (installed < total || node_setup_needed) && server_ready() {
        stop_managed_server(app, state)?;
    }
    let required = total.saturating_sub(installed) + INSTALL_OVERHEAD;
    let available = fs2::available_space(&base)
        .map_err(|error| format!("Could not check free disk space: {error}"))?;
    if available < required {
        return Err(format!(
            "DnDRom needs {:.1} GB free for this local creation pack, but {:.1} GB is available.",
            required as f64 / 1_073_741_824.0,
            available as f64 / 1_073_741_824.0
        ));
    }

    install_runtime(app, feature, archive, total)?;
    install_models(app, feature, total)?;
    if !nodes(feature).is_empty() {
        install_world_nodes(app, state, feature, total)?;
    }
    if feature == RuntimeFeature::World {
        install_brush(app, feature, total)?;
    }
    start_server(app, state, feature, total, vram_reserve_gb)?;
    status_inner(app, feature)
}

fn install_runtime(
    app: &RuntimeContext,
    feature: RuntimeFeature,
    archive: RuntimeArchive,
    total: u64,
) -> Result<(), String> {
    let root = portable_root(app)?;
    if root.join("python_embeded/python.exe").exists() && root.join("ComfyUI/main.py").exists() {
        return Ok(());
    }
    let base = runtime_base(app)?;
    let downloads = base.join("downloads");
    fs::create_dir_all(&downloads).map_err(|error| error.to_string())?;
    let archive_path = downloads.join(format!("comfy-{RUNTIME_VERSION}-{}.7z", archive.variant));
    emit(
        app,
        feature,
        "runtime",
        0,
        total,
        format!(
            "Downloading the local engine for {} graphics",
            archive.variant
        ),
    );
    download_verified(
        app,
        feature,
        archive.url,
        &archive_path,
        archive.size,
        archive.sha256,
        0,
        total,
        "Local creation engine",
    )?;
    let install_parent = root.parent().ok_or("Invalid runtime install path")?;
    let staging = install_parent.join(format!("extracting-{}", archive.variant));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    emit(
        app,
        feature,
        "extracting",
        archive.size,
        total,
        "Installing the local creation engine",
    );
    sevenz_rust2::decompress_file(&archive_path, &staging)
        .map_err(|error| format!("Could not unpack the local engine: {error}"))?;
    let extracted = staging.join("ComfyUI_windows_portable");
    if !extracted.join("python_embeded/python.exe").exists() {
        return Err("The verified local engine archive had an unexpected layout".into());
    }
    if root.exists() {
        fs::remove_dir_all(&root).map_err(|error| error.to_string())?;
    }
    fs::rename(&extracted, &root)
        .map_err(|error| format!("Could not finish the local engine installation: {error}"))?;
    let _ = fs::remove_dir_all(&staging);
    let _ = fs::remove_file(&archive_path);
    Ok(())
}

fn install_models(app: &RuntimeContext, feature: RuntimeFeature, total: u64) -> Result<(), String> {
    let root = portable_root(app)?.join("ComfyUI/models");
    let archive = runtime_archive();
    let mut completed = archive.size;
    for asset in models(feature) {
        let target = root.join(asset.relative_path);
        // Early builds put the Sana checkpoint under diffusion_models even
        // though the pinned SanaCheckpointLoader enumerates checkpoints.
        // Move the verified app-owned file in place so existing installs do
        // not download another 1.6 GB copy merely to repair that layout.
        if feature == RuntimeFeature::PropImageLite
            && asset.relative_path == "checkpoints/sana1.5_1.6b_1024px_fp8.safetensors"
            && !target.exists()
        {
            let legacy = root.join("diffusion_models/sana1.5_1.6b_1024px_fp8.safetensors");
            if asset_is_installed(&legacy, asset.size) {
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                fs::rename(&legacy, &target).map_err(|error| {
                    format!("Could not migrate the Sana model into the loader directory: {error}")
                })?;
            }
        }
        // The third-party Gemma node requires a Hugging Face-style directory.
        // Reuse the verified single-file encoder downloaded by earlier builds.
        if feature == RuntimeFeature::PropImageLite
            && asset.relative_path
                == "text_encoders/models-efficient-large-model--gemma-2-2b-it/model.safetensors"
            && !target.exists()
        {
            let legacy = root.join("text_encoders/gemma-2-2b-it.safetensors");
            if asset_is_installed(&legacy, asset.size) {
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                fs::rename(&legacy, &target).map_err(|error| {
                    format!("Could not migrate the Gemma encoder into its offline model directory: {error}")
                })?;
            }
        }
        if asset_is_installed(&target, asset.size) {
            completed += asset.size;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        download_verified(
            app,
            feature,
            asset.url,
            &target,
            asset.size,
            asset.sha256,
            completed,
            total,
            asset.name,
        )?;
        completed += asset.size;
    }
    Ok(())
}

fn install_world_nodes(
    app: &RuntimeContext,
    state: &LocalRuntimeState,
    feature: RuntimeFeature,
    total: u64,
) -> Result<(), String> {
    let root = portable_root(app)?;
    let custom_nodes = root.join("ComfyUI/custom_nodes");
    let dependency_marker = custom_nodes.join(match feature {
        RuntimeFeature::CharacterRig => ".dndrom-character-rig-dependencies-v1",
        RuntimeFeature::PropImageLite => PROP_SANA_DEPENDENCY_MARKER,
        _ => ".dndrom-world-dependencies-v2",
    });
    let downloads = runtime_base(app)?.join("downloads/nodes");
    fs::create_dir_all(&downloads).map_err(|error| error.to_string())?;
    if feature == RuntimeFeature::World {
        let runtime_nodes = custom_nodes.join("DnDRom_Runtime");
        fs::create_dir_all(&runtime_nodes).map_err(|error| error.to_string())?;
        fs::write(runtime_nodes.join("__init__.py"), DNDROM_RUNTIME_NODES)
            .map_err(|error| format!("Could not install DnDRom's bounded WAN decoder: {error}"))?;
        fs::write(runtime_nodes.join(DNDROM_RUNTIME_NODE_MARKER), b"4\n")
            .map_err(|error| format!("Could not finalize DnDRom's bounded WAN decoder: {error}"))?;
    }
    let mut completed =
        runtime_archive().size + models(feature).iter().map(|asset| asset.size).sum::<u64>();
    for node in nodes(feature) {
        let target = custom_nodes.join(node.name);
        if target.exists() {
            completed += node.size;
            continue;
        }
        let archive_path = downloads.join(format!("{}.zip", node.name));
        let url = format!(
            "https://github.com/{}/archive/{}.zip",
            node.repo, node.commit
        );
        download_verified(
            app,
            feature,
            &url,
            &archive_path,
            node.size,
            node.sha256,
            completed,
            total,
            node.name,
        )?;
        emit(
            app,
            feature,
            "nodes",
            completed + node.size,
            total,
            format!("Installing {}", node.name),
        );
        extract_zip_strip_root(&archive_path, &target)?;
        let _ = fs::remove_file(&archive_path);
        completed += node.size;
    }

    if feature == RuntimeFeature::PropImageLite {
        let gemma_node = custom_nodes.join("ComfyUI_ExtraModels/Gemma/nodes.py");
        let source = fs::read_to_string(&gemma_node)
            .map_err(|error| format!("Could not prepare the offline Sana text encoder: {error}"))?;
        let patched = source
            .replace(
                "AutoTokenizer.from_pretrained(model_name)",
                "AutoTokenizer.from_pretrained(text_encoder_dir, local_files_only=True)",
            )
            .replace(
                "AutoModelForCausalLM.from_pretrained(model_name, torch_dtype=dtype)",
                "AutoModelForCausalLM.from_pretrained(text_encoder_dir, torch_dtype=dtype, local_files_only=True)",
            );
        if !patched.contains("AutoTokenizer.from_pretrained(text_encoder_dir, local_files_only=True)")
            || !patched.contains("AutoModelForCausalLM.from_pretrained(text_encoder_dir, torch_dtype=dtype, local_files_only=True)")
        {
            return Err("The pinned Sana node no longer exposes the expected Gemma loader".into());
        }
        if patched != source {
            fs::write(&gemma_node, patched).map_err(|error| {
                format!("Could not finish the offline Sana text encoder setup: {error}")
            })?;
        }
        // The extension creates CPU parameters after BaseModel construction.
        // Advertising CUDA here makes ComfyUI skip the required initial move.
        let sana_loader = custom_nodes.join("ComfyUI_ExtraModels/Sana/loader.py");
        let source = fs::read_to_string(&sana_loader)
            .map_err(|error| format!("Could not prepare Sana device placement: {error}"))?;
        let patched = source.replace(
            "device=model_management.get_torch_device()",
            "device=offload_device",
        );
        if !patched.contains("device=offload_device") {
            return Err("The pinned Sana loader no longer exposes its initial device".into());
        }
        if source != patched {
            fs::write(&sana_loader, patched)
                .map_err(|error| format!("Could not repair Sana device placement: {error}"))?;
        }
    }

    if dependency_marker.exists() {
        return Ok(());
    }

    let python = root.join("python_embeded/python.exe");
    for node in nodes(feature) {
        let requirements = custom_nodes.join(node.name).join("requirements.txt");
        if !requirements.exists() {
            continue;
        }
        emit(
            app,
            feature,
            "dependencies",
            completed,
            total,
            format!("Finishing {}", node.name),
        );
        let mut dependency = hidden_command(&python);
        dependency
            .args([
                "-s",
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "-r",
            ])
            .arg(&requirements);
        let status = run_managed_command(state, &mut dependency)
            .map_err(|error| format!("Could not install {}: {error}", node.name))?;
        if !status.success() {
            return Err(format!(
                "The local dependency setup for {} did not complete",
                node.name
            ));
        }
        if node.name == "ComfyUI-UniRig" {
            let installer = custom_nodes.join(node.name).join("install.py");
            if installer.exists() {
                emit(
                    app,
                    feature,
                    "dependencies",
                    completed,
                    total,
                    "Preparing the isolated auto-rig tools".to_string(),
                );
                let mut installer_command = hidden_command(&python);
                installer_command
                    .arg(&installer)
                    .current_dir(custom_nodes.join(node.name));
                let installer_status = run_managed_command(state, &mut installer_command)
                    .map_err(|error| format!("Could not prepare {}: {error}", node.name))?;
                if !installer_status.success() {
                    return Err("The isolated auto-rig setup did not complete".to_string());
                }
            }
        }
    }
    if feature == RuntimeFeature::PropImageLite {
        emit(
            app,
            feature,
            "dependencies",
            completed,
            total,
            "Finishing the Sana image decoder".to_string(),
        );
        let mut dependency = hidden_command(&python);
        dependency.args([
            "-s",
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            PROP_SANA_DIFFUSERS_PACKAGE,
        ]);
        let status = run_managed_command(state, &mut dependency).map_err(|error| {
            format!("Could not install the Sana image decoder dependency: {error}")
        })?;
        if !status.success() {
            return Err("The Sana image decoder dependency setup did not complete".to_string());
        }
        let mut verify = hidden_command(&python);
        verify.args([
            "-s",
            "-c",
            "from diffusers import ModelMixin, ConfigMixin, FromOriginalModelMixin",
        ]);
        let status = run_managed_command(state, &mut verify).map_err(|error| {
            format!("Could not verify the Sana image decoder dependency: {error}")
        })?;
        if !status.success() {
            return Err(
                "The Sana image decoder dependency was installed but could not be imported"
                    .to_string(),
            );
        }
    }
    fs::write(&dependency_marker, b"installed\n")
        .map_err(|error| format!("Could not finish local dependency setup: {error}"))?;
    Ok(())
}

fn install_brush(app: &RuntimeContext, feature: RuntimeFeature, total: u64) -> Result<(), String> {
    let base = runtime_base(app)?;
    let target = base.join("tools/brush");
    if find_brush_binary(&target).is_some() {
        return Ok(());
    }
    let archive = base.join(BRUSH.relative_path);
    if let Some(parent) = archive.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let completed = runtime_archive().size
        + WORLD_MODELS.iter().map(|asset| asset.size).sum::<u64>()
        + WORLD_NODES.iter().map(|node| node.size).sum::<u64>();
    download_verified(
        app,
        feature,
        BRUSH.url,
        &archive,
        BRUSH.size,
        BRUSH.sha256,
        completed,
        total,
        BRUSH.name,
    )?;
    emit(
        app,
        feature,
        "trainer",
        completed + BRUSH.size,
        total,
        "Installing the local 3D world trainer",
    );
    extract_zip(&archive, &target)?;
    let _ = fs::remove_file(&archive);
    if find_brush_binary(&target).is_none() {
        return Err("The verified Brush archive had an unexpected layout".into());
    }
    Ok(())
}

fn download_verified(
    app: &RuntimeContext,
    feature: RuntimeFeature,
    url: &str,
    target: &Path,
    expected_size: u64,
    expected_sha: &str,
    base_completed: u64,
    total: u64,
    label: &str,
) -> Result<(), String> {
    if asset_is_installed(target, expected_size) && sha256(target)? == expected_sha {
        return Ok(());
    }
    let partial = target.with_extension(format!(
        "{}part",
        target
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| format!("{value}."))
            .unwrap_or_default()
    ));
    if let Some(parent) = partial.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let existing = partial
        .metadata()
        .map(|metadata| metadata.len())
        .unwrap_or(0)
        .min(expected_size);
    let client = reqwest::blocking::Client::builder()
        .user_agent("DnDRom/0.1 local-runtime-installer")
        .timeout(Duration::from_secs(3600))
        .build()
        .map_err(|error| error.to_string())?;
    let mut request = client.get(url);
    if existing > 0 {
        request = request.header(RANGE, format!("bytes={existing}-"));
    }
    let mut response = request
        .send()
        .map_err(|error| format!("Could not download {label}: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Could not download {label}: server returned {}",
            response.status()
        ));
    }
    let append = existing > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .append(append)
        .truncate(!append)
        .open(&partial)
        .map_err(|error| error.to_string())?;
    let mut downloaded = if append { existing } else { 0 };
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let count = response
            .read(&mut buffer)
            .map_err(|error| format!("Download interrupted for {label}: {error}"))?;
        if count == 0 {
            break;
        }
        file.write_all(&buffer[..count])
            .map_err(|error| error.to_string())?;
        downloaded += count as u64;
        emit(
            app,
            feature,
            "downloading",
            base_completed + downloaded.min(expected_size),
            total,
            format!("Downloading {label}"),
        );
    }
    file.flush().map_err(|error| error.to_string())?;
    if downloaded != expected_size {
        return Err(format!(
            "{label} download is incomplete ({downloaded} of {expected_size} bytes). Retry will resume it."
        ));
    }
    emit(
        app,
        feature,
        "verifying",
        base_completed + expected_size,
        total,
        format!("Verifying {label}"),
    );
    if sha256(&partial)? != expected_sha {
        let _ = fs::remove_file(&partial);
        return Err(format!(
            "{label} failed its security check and was removed. Please retry."
        ));
    }
    if target.exists() {
        fs::remove_file(target).map_err(|error| error.to_string())?;
    }
    fs::rename(&partial, target).map_err(|error| error.to_string())?;
    Ok(())
}

fn sha256(path: &Path) -> Result<String, String> {
    let mut reader = BufReader::new(File::open(path).map_err(|error| error.to_string())?);
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; 4 * 1024 * 1024];
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn safe_zip_path(name: &Path) -> Option<PathBuf> {
    if name.is_absolute() {
        return None;
    }
    let mut result = PathBuf::new();
    for component in name.components() {
        match component {
            Component::Normal(value) => result.push(value),
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(result)
}

fn extract_zip(source: &Path, target: &Path) -> Result<(), String> {
    extract_zip_inner(source, target, false)
}
fn extract_zip_strip_root(source: &Path, target: &Path) -> Result<(), String> {
    extract_zip_inner(source, target, true)
}

fn extract_zip_inner(source: &Path, target: &Path, strip_root: bool) -> Result<(), String> {
    if target.exists() {
        fs::remove_dir_all(target).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(target).map_err(|error| error.to_string())?;
    let file = File::open(source).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| error.to_string())?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let safe =
            safe_zip_path(Path::new(entry.name())).ok_or("Archive contained an unsafe path")?;
        let relative = if strip_root {
            safe.components().skip(1).collect::<PathBuf>()
        } else {
            safe
        };
        if relative.as_os_str().is_empty() {
            continue;
        }
        let output = target.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&output).map_err(|error| error.to_string())?;
        } else {
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let mut destination = File::create(&output).map_err(|error| error.to_string())?;
            std::io::copy(&mut entry, &mut destination).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn hidden_command(program: &Path) -> Command {
    let mut command = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

fn run_managed_command(
    state: &LocalRuntimeState,
    command: &mut Command,
) -> std::io::Result<ExitStatus> {
    let mut child = command.spawn()?;
    if let Err(error) = state.process_job.assign_child(&child) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(std::io::Error::other(error));
    }
    child.wait()
}

fn executable_is_inside_runtime(executable: &Path, runtime_root: &Path) -> bool {
    executable.starts_with(runtime_root) && executable != runtime_root
}

#[cfg(target_os = "windows")]
fn adopt_trusted_orphaned_server(
    app: &RuntimeContext,
    state: &LocalRuntimeState,
) -> Result<bool, String> {
    let script = r#"$connection = Get-NetTCPConnection -LocalPort 8189 -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -in @('127.0.0.1', '::1') } | Select-Object -First 1; if ($connection) { $process = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $connection.OwningProcess); [Console]::Out.Write($connection.OwningProcess.ToString() + "`t" + $process.ExecutablePath) }"#;
    let output = hidden_command(Path::new("powershell.exe"))
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|error| format!("Could not inspect the local creation engine: {error}"))?;
    let value = String::from_utf8_lossy(&output.stdout);
    let Some((pid, executable)) = value.trim().split_once('\t') else {
        return Ok(false);
    };
    let executable = fs::canonicalize(executable.trim())
        .map_err(|error| format!("Could not verify the local creation process: {error}"))?;
    let trusted_root = fs::canonicalize(portable_root(app)?)
        .map_err(|error| format!("Could not verify the local creation runtime: {error}"))?;
    if !executable_is_inside_runtime(&executable, &trusted_root) {
        return Ok(false);
    }
    let pid = pid
        .trim()
        .parse::<u32>()
        .map_err(|_| "The local creation engine reported an invalid process id".to_string())?;
    state.process_job.assign_pid(pid)?;
    Ok(true)
}

#[cfg(not(target_os = "windows"))]
fn adopt_trusted_orphaned_server(
    _app: &RuntimeContext,
    _state: &LocalRuntimeState,
) -> Result<bool, String> {
    Ok(false)
}

#[cfg(target_os = "windows")]
fn stop_trusted_orphaned_server(app: &RuntimeContext) -> Result<bool, String> {
    let script = r#"$connection = Get-NetTCPConnection -LocalPort 8189 -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -in @('127.0.0.1', '::1') } | Select-Object -First 1; if ($connection) { $process = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $connection.OwningProcess); [Console]::Out.Write($connection.OwningProcess.ToString() + "`t" + $process.ExecutablePath) }"#;
    let output = hidden_command(Path::new("powershell.exe"))
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|error| format!("Could not inspect the local creation engine: {error}"))?;
    if !output.status.success() {
        return Err("Could not inspect the process using the local-generation port".into());
    }
    let value = String::from_utf8_lossy(&output.stdout);
    let Some((pid, executable)) = value.trim().split_once('\t') else {
        return Ok(false);
    };
    let pid = pid
        .trim()
        .parse::<u32>()
        .map_err(|_| "The local creation engine reported an invalid process id".to_string())?;
    let executable = fs::canonicalize(executable.trim())
        .map_err(|error| format!("Could not verify the local creation process: {error}"))?;
    let trusted_root = fs::canonicalize(portable_root(app)?)
        .map_err(|error| format!("Could not verify the local creation runtime: {error}"))?;
    if !executable_is_inside_runtime(&executable, &trusted_root) {
        return Err("Another application is using DnDRom's private local-generation port. Close it, then retry local setup.".into());
    }
    let status = hidden_command(Path::new("taskkill.exe"))
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status()
        .map_err(|error| {
            format!("Could not restart the verified DnDRom creation engine: {error}")
        })?;
    if !status.success() {
        return Err("The verified DnDRom creation engine could not be restarted".into());
    }
    Ok(true)
}

#[cfg(not(target_os = "windows"))]
fn stop_trusted_orphaned_server(_app: &RuntimeContext) -> Result<bool, String> {
    Ok(false)
}

fn stop_managed_server(app: &RuntimeContext, state: &LocalRuntimeState) -> Result<(), String> {
    let mut child = state
        .child
        .lock()
        .map_err(|_| "Local runtime process lock failed".to_string())?;
    if let Some(mut process) = child.take() {
        process
            .kill()
            .map_err(|error| format!("Could not restart the local creation engine: {error}"))?;
        process.wait().map_err(|error| {
            format!("Could not finish restarting the local creation engine: {error}")
        })?;
    } else if !stop_trusted_orphaned_server(app)? {
        return Err("Another application is using DnDRom's private local-generation port. Close it, then retry local setup.".into());
    }
    drop(child);
    for _ in 0..20 {
        if !server_ready() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("The local creation engine did not release its private port during restart".into())
}

fn start_server(
    app: &RuntimeContext,
    state: &LocalRuntimeState,
    feature: RuntimeFeature,
    total: u64,
    vram_reserve_gb: f32,
) -> Result<(), String> {
    if server_ready() {
        let has_owned_handle = state
            .child
            .lock()
            .map(|slot| slot.is_some())
            .unwrap_or(false);
        if !has_owned_handle {
            // Adopt a verified DnDRom runtime left by an older/crashed build so
            // closing this session will still tear it down. A user's external
            // ComfyUI instance is deliberately left alone.
            let _ = adopt_trusted_orphaned_server(app, state)?;
        }
        return Ok(());
    }
    // A player can terminate ComfyUI from Task Manager while DnDRom remains
    // open. Reap that stale handle before replacing it so the next generation
    // starts with a clean process and log stream.
    if let Ok(mut slot) = state.child.lock() {
        if let Some(mut previous) = slot.take() {
            match previous.try_wait() {
                Ok(Some(_)) => {
                    let _ = previous.wait();
                }
                Ok(None) => {
                    let _ = previous.kill();
                    let _ = previous.wait();
                }
                Err(_) => {
                    let _ = previous.kill();
                }
            }
        }
    }
    let root = portable_root(app)?;
    let python = root.join("python_embeded/python.exe");
    let main = root.join("ComfyUI/main.py");
    let log_path = runtime_base(app)?.join("comfy-runtime.log");
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| error.to_string())?;
    let stderr = stdout.try_clone().map_err(|error| error.to_string())?;
    emit(
        app,
        feature,
        "starting",
        total,
        total,
        "Starting the local creation engine",
    );
    let mut child = hidden_command(&python)
        .args(["-s"])
        .arg(&main)
        .args(server_args(vram_reserve_gb))
        .current_dir(&root)
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|error| format!("Could not start the local creation engine: {error}"))?;
    if let Err(error) = state.process_job.assign_child(&child) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    *state
        .child
        .lock()
        .map_err(|_| "Local runtime process lock failed".to_string())? = Some(child);
    for _ in 0..120 {
        if server_ready() {
            emit(
                app,
                feature,
                "ready",
                total,
                total,
                "Local creation tools are ready",
            );
            return Ok(());
        }
        if let Some(child) = state.child.lock().ok().and_then(|mut value| {
            value
                .as_mut()
                .and_then(|child| child.try_wait().ok().flatten())
        }) {
            return Err(format!(
                "The local creation engine exited during startup ({child}). See {}",
                log_path.display()
            ));
        }
        thread::sleep(Duration::from_secs(1));
    }
    Err(format!(
        "The local creation engine did not become ready. See {}",
        log_path.display()
    ))
}

fn find_brush_binary(root: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_brush_binary(&path) {
                return Some(found);
            }
        } else if path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("exe"))
            && path
                .file_stem()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.to_lowercase().contains("brush"))
        {
            return Some(path);
        }
    }
    None
}

fn dataset_root(candidate: &Path, comfy_root: &Path) -> Result<PathBuf, String> {
    let resolved = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        comfy_root.join("output").join(candidate)
    };
    let canonical = resolved
        .canonicalize()
        .map_err(|_| "The generated world dataset could not be found".to_string())?;
    let allowed = comfy_root
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !canonical.starts_with(&allowed) {
        return Err(
            "The world trainer only accepts datasets generated inside DnDRom's local runtime"
                .into(),
        );
    }
    for path in canonical.ancestors() {
        if path.join("images").is_dir() && path.join("sparse/0").is_dir() {
            return Ok(path.to_path_buf());
        }
    }
    Err("The generated output is not a complete COLMAP dataset".into())
}

fn latest_complete_world_dataset(
    comfy_root: &Path,
    max_age: Duration,
) -> Result<Option<PathBuf>, String> {
    let output = comfy_root.join("output");
    if !output.is_dir() {
        return Ok(None);
    }
    let cutoff = SystemTime::now().checked_sub(max_age).unwrap_or(UNIX_EPOCH);
    let mut newest: Option<(SystemTime, PathBuf)> = None;
    for entry in fs::read_dir(&output)
        .map_err(|error| error.to_string())?
        .flatten()
    {
        let root = entry.path();
        let sparse = root.join("sparse/0");
        if !root.join("images").is_dir() || !sparse.is_dir() {
            continue;
        }
        let required = ["cameras.bin", "images.bin", "points3D.bin"];
        if !required.iter().all(|name| {
            sparse
                .join(name)
                .metadata()
                .is_ok_and(|metadata| metadata.len() > 0)
        }) {
            continue;
        }
        let modified = sparse
            .join("images.bin")
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH);
        if modified < cutoff {
            continue;
        }
        if newest.as_ref().is_none_or(|(latest, _)| modified > *latest) {
            newest = Some((modified, sparse));
        }
    }
    Ok(newest.map(|(_, path)| path))
}

fn latest_trained_world(runtime_root: &Path, max_age: Duration) -> Result<Option<PathBuf>, String> {
    let generated = runtime_root.join("generated-worlds");
    if !generated.is_dir() {
        return Ok(None);
    }
    let cutoff = SystemTime::now().checked_sub(max_age).unwrap_or(UNIX_EPOCH);
    let mut newest: Option<(SystemTime, PathBuf)> = None;
    for entry in fs::read_dir(&generated)
        .map_err(|error| error.to_string())?
        .flatten()
    {
        let candidate = entry.path().join("dndrom-world.ply");
        let Ok(metadata) = candidate.metadata() else {
            continue;
        };
        if metadata.len() == 0 || ply_vertex_count(&candidate).unwrap_or(0) == 0 {
            continue;
        }
        let modified = metadata.modified().unwrap_or(UNIX_EPOCH);
        if modified < cutoff {
            continue;
        }
        if newest.as_ref().is_none_or(|(latest, _)| modified > *latest) {
            newest = Some((modified, candidate));
        }
    }
    Ok(newest.map(|(_, path)| path))
}

pub fn find_latest_local_world_dataset(app: RuntimeContext) -> Result<Option<String>, String> {
    let comfy = portable_root(&app)?.join("ComfyUI");
    Ok(
        latest_complete_world_dataset(&comfy, Duration::from_secs(12 * 60 * 60))?
            .map(|path| path.to_string_lossy().to_string()),
    )
}

pub fn find_latest_local_trained_world(
    app: RuntimeContext,
) -> Result<Option<TrainedWorld>, String> {
    Ok(
        latest_trained_world(&runtime_base(&app)?, Duration::from_secs(12 * 60 * 60))?.map(
            |path| TrainedWorld {
                path: path.to_string_lossy().to_string(),
                filename: "dndrom-world.ply".into(),
            },
        ),
    )
}

pub fn train_local_world(
    app: RuntimeContext,
    state: &LocalRuntimeState,
    dataset_path: String,
    total_steps: Option<u32>,
    max_splats: Option<u32>,
    max_frames: Option<u32>,
) -> Result<TrainedWorld, String> {
    state.claim(&app)?;
    train_world_inner(
        &app,
        state,
        &dataset_path,
        total_steps,
        max_splats,
        max_frames,
    )
}

fn training_step_from_line(line: &str, total_steps: u32) -> Option<u32> {
    let lower = line.to_ascii_lowercase();
    let marker = lower.find("step").or_else(|| lower.find("iter"))?;
    let tail = &lower[marker..];
    let digits = tail
        .trim_start_matches(|character: char| !character.is_ascii_digit())
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect::<String>();
    digits
        .parse::<u32>()
        .ok()
        .filter(|step| *step <= total_steps)
}

fn validation_loss_from_line(line: &str) -> Option<f64> {
    let lower = line.to_ascii_lowercase();
    if !lower.contains("validation") && !lower.contains("val_loss") && !lower.contains("val loss") {
        return None;
    }
    let marker = lower.find("loss")?;
    lower[marker + 4..]
        .trim_start_matches(|character: char| {
            !character.is_ascii_digit() && character != '.' && character != '-'
        })
        .split(|character: char| character.is_whitespace() || character == ',' || character == ';')
        .next()?
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite())
}

#[derive(Default)]
struct BrushEarlyStopState {
    current_step: u32,
    best_loss: Option<f64>,
    last_improved_step: u32,
}

#[derive(Debug, PartialEq)]
struct BrushRefinementConfig {
    refine_every: u32,
    growth_grad_threshold: &'static str,
    growth_select_fraction: &'static str,
    growth_stop_iter: u32,
}

fn brush_refinement_config(total_steps: u32, max_frames: u32) -> BrushRefinementConfig {
    // Brush defaults to refining every 200 optimization steps. That is suitable
    // for large video datasets, but a DnDRom world only has 54-200 deliberately
    // selected pinhole faces. Refine after a meaningful fraction of those faces
    // has contributed instead of repeatedly splitting under-observed Gaussians;
    // the latter creates the giant translucent sheets seen in failed worlds.
    // The lower threshold still densifies the sparse COLMAP seed, while the
    // conservative selection fraction leaves time for appearance convergence.
    BrushRefinementConfig {
        refine_every: (max_frames / 3).clamp(24, 72),
        growth_grad_threshold: "0.0000025",
        growth_select_fraction: "0.15",
        growth_stop_iter: ((total_steps as f32 * 0.68).round() as u32).clamp(800, 8_000),
    }
}

fn stage_brush_colmap_dataset(dataset: &Path, output: &Path) -> Result<PathBuf, String> {
    // SplatKit also stores spherical-camera working data and a p2s marker in
    // the dataset root. Brush can detect that metadata before the final
    // pinhole COLMAP export and reject camera model 11. Give the trainer a
    // clean, inexpensive hard-linked view containing only its supported data.
    let staged = output.join("brush-dataset");
    let staged_sparse = staged.join("sparse/0");
    let staged_images = staged.join("images");
    fs::create_dir_all(&staged_sparse).map_err(|error| error.to_string())?;
    fs::create_dir_all(&staged_images).map_err(|error| error.to_string())?;
    for name in ["cameras.bin", "images.bin", "points3D.bin"] {
        let source = dataset.join("sparse/0").join(name);
        let target = staged_sparse.join(name);
        fs::hard_link(&source, &target)
            .or_else(|_| fs::copy(&source, &target).map(|_| ()))
            .map_err(|error| format!("Could not stage {name} for world training: {error}"))?;
    }
    for entry in fs::read_dir(dataset.join("images"))
        .map_err(|error| error.to_string())?
        .flatten()
    {
        let source = entry.path();
        if !source.is_file() {
            continue;
        }
        let target = staged_images.join(entry.file_name());
        fs::hard_link(&source, &target)
            .or_else(|_| fs::copy(&source, &target).map(|_| ()))
            .map_err(|error| format!("Could not stage a training image: {error}"))?;
    }
    Ok(staged)
}

fn ply_vertex_count(path: &Path) -> Option<u32> {
    let mut file = fs::File::open(path).ok()?;
    let mut header = vec![0_u8; 256 * 1024];
    let read = file.read(&mut header).ok()?;
    let text = String::from_utf8_lossy(&header[..read]);
    text.lines()
        .find_map(|line| line.strip_prefix("element vertex ")?.trim().parse().ok())
}

fn train_world_inner(
    app: &RuntimeContext,
    state: &LocalRuntimeState,
    dataset_path: &str,
    total_steps: Option<u32>,
    max_splats: Option<u32>,
    max_frames: Option<u32>,
) -> Result<TrainedWorld, String> {
    let base = runtime_base(app)?;
    let comfy = portable_root(app)?.join("ComfyUI");
    let dataset = dataset_root(Path::new(dataset_path), &comfy)?;
    let brush = find_brush_binary(&base.join("tools/brush"))
        .ok_or("The local world trainer is not installed")?;
    let total_steps = total_steps.unwrap_or(4_500).clamp(3_000, 6_000);
    let max_splats = max_splats.unwrap_or(180_000).clamp(100_000, 2_000_000);
    let max_frames = max_frames.unwrap_or(132).clamp(4, 200);
    let refinement = brush_refinement_config(total_steps, max_frames);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let output = base.join("generated-worlds").join(timestamp.to_string());
    fs::create_dir_all(&output).map_err(|error| error.to_string())?;
    let brush_dataset = stage_brush_colmap_dataset(&dataset, &output)?;
    emit(
        app,
        RuntimeFeature::World,
        "training",
        0,
        total_steps as u64,
        format!("Training a game-ready world (up to {max_splats} splats)"),
    );
    let mut trainer = hidden_command(&brush)
        .arg(&brush_dataset)
        .arg("--total-steps")
        .arg(total_steps.to_string())
        .arg("--max-splats")
        .arg(max_splats.to_string())
        .arg("--max-frames")
        .arg(max_frames.to_string())
        .arg("--refine-every")
        .arg(refinement.refine_every.to_string())
        .arg("--growth-grad-threshold")
        .arg(refinement.growth_grad_threshold)
        .arg("--growth-select-fraction")
        .arg(refinement.growth_select_fraction)
        .arg("--growth-stop-iter")
        .arg(refinement.growth_stop_iter.to_string())
        .arg("--export-every")
        .arg("250")
        .arg("--export-path")
        .arg(&output)
        .args(["--export-name", "dndrom-world.ply"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start the local world trainer: {error}"))?;
    if let Err(error) = state.process_job.assign_child(&trainer) {
        let _ = trainer.kill();
        let _ = trainer.wait();
        return Err(error);
    }
    let stdout = trainer.stdout.take();
    let stderr = trainer.stderr.take();
    let early_stop = Arc::new(Mutex::new(BrushEarlyStopState::default()));
    let progress_reader = |reader: Box<dyn Read + Send>,
                           progress_app: RuntimeContext,
                           early_stop: Arc<Mutex<BrushEarlyStopState>>| {
        thread::spawn(move || {
            for line in BufReader::new(reader).lines().map_while(Result::ok) {
                if let Some(step) = training_step_from_line(&line, total_steps) {
                    if let Ok(mut state) = early_stop.lock() {
                        state.current_step = state.current_step.max(step);
                    }
                    emit(
                        &progress_app,
                        RuntimeFeature::World,
                        "training",
                        step as u64,
                        total_steps as u64,
                        format!("Optimizing gameplay splats: step {step} of {total_steps}"),
                    );
                }
                if let Some(loss) = validation_loss_from_line(&line) {
                    if let Ok(mut state) = early_stop.lock() {
                        let improved = state
                            .best_loss
                            .is_none_or(|best| loss < best - best.abs().max(1e-8) * 0.0005);
                        if improved {
                            state.best_loss = Some(loss);
                            state.last_improved_step = state.current_step;
                        }
                    }
                }
            }
        })
    };
    let stdout_thread =
        stdout.map(|reader| progress_reader(Box::new(reader), app.clone(), early_stop.clone()));
    let stderr_thread =
        stderr.map(|reader| progress_reader(Box::new(reader), app.clone(), early_stop.clone()));
    let export_path = output.join("dndrom-world.ply");
    let mut stopped_early = false;
    let status = loop {
        if let Some(status) = trainer
            .try_wait()
            .map_err(|error| format!("Could not wait for the local world trainer: {error}"))?
        {
            break status;
        }
        let plateau = early_stop.lock().ok().is_some_and(|state| {
            state.best_loss.is_some()
                && state.current_step >= 3_000
                && state.current_step.saturating_sub(state.last_improved_step) >= 250
        });
        if plateau && export_path.exists() {
            emit(
                app,
                RuntimeFeature::World,
                "training",
                total_steps as u64,
                total_steps as u64,
                "Validation loss plateaued for 250 steps; preserving the latest completed export",
            );
            trainer
                .kill()
                .map_err(|error| format!("Could not stop the converged world trainer: {error}"))?;
            stopped_early = true;
            break trainer.wait().map_err(|error| {
                format!("Could not finish the converged world trainer: {error}")
            })?;
        }
        thread::sleep(Duration::from_millis(200));
    };
    if let Some(handle) = stdout_thread {
        let _ = handle.join();
    }
    if let Some(handle) = stderr_thread {
        let _ = handle.join();
    }
    if !status.success() && !stopped_early {
        return Err(format!("The local world trainer stopped with {status}"));
    }
    let path = export_path;
    if !path.exists() {
        return Err("World training completed without exporting dndrom-world.ply".into());
    }
    let splat_count = ply_vertex_count(&path).unwrap_or(0);
    let minimum_detail = (max_splats / 20).clamp(5_000, 25_000);
    if splat_count < minimum_detail {
        return Err(format!(
            "World training produced only {splat_count} splats; at least {minimum_detail} are required for a readable game scene. The completed camera dataset was preserved for retry."
        ));
    }
    emit(
        app,
        RuntimeFeature::World,
        "training",
        total_steps as u64,
        total_steps as u64,
        format!("Game-ready world training complete ({splat_count} splats)"),
    );
    Ok(TrainedWorld {
        path: path.to_string_lossy().to_string(),
        filename: "dndrom-world.ply".into(),
    })
}

pub fn read_local_runtime_file(app: RuntimeContext, path: String) -> Result<Vec<u8>, String> {
    let base = runtime_base(&app)?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let candidate = PathBuf::from(path)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !candidate.starts_with(&base.join("generated-worlds")) {
        return Err("DnDRom refused to read a file outside its generated-world directory".into());
    }
    fs::read(candidate).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn clients_cannot_own_the_same_runtime_and_drop_releases_the_lease() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory =
            std::env::temp_dir().join(format!("dndrom-owner-test-{}-{unique}", std::process::id()));
        let ctx = RuntimeContext::new(directory.clone(), |_| {});
        let first = LocalRuntimeState::new().unwrap();
        let second = LocalRuntimeState::new().unwrap();
        first.claim(&ctx).unwrap();
        assert!(second
            .claim(&ctx)
            .unwrap_err()
            .contains("Another DnDRom client"));
        // Clones must keep the lease alive until the last owner is dropped.
        let clone = first.clone();
        drop(first);
        assert!(second.claim(&ctx).is_err());
        drop(clone);
        second.claim(&ctx).unwrap();
        drop(second);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn feature_packs_are_explicit_and_large_enough_for_the_models() {
        let archive = runtime_archive();
        assert!(feature_total(RuntimeFeature::CharacterPixal3d, archive) > 10_000_000_000);
        assert!(feature_total(RuntimeFeature::CharacterTrellis2, archive) > 9_000_000_000);
        assert!(feature_total(RuntimeFeature::CharacterRig, archive) < 5_000_000_000);
        assert!(feature_total(RuntimeFeature::World, archive) > 40_000_000_000);
    }

    #[test]
    fn tabletop_training_densifies_on_view_coverage_not_video_defaults() {
        assert_eq!(
            brush_refinement_config(5_000, 180),
            BrushRefinementConfig {
                refine_every: 60,
                growth_grad_threshold: "0.0000025",
                growth_select_fraction: "0.15",
                growth_stop_iter: 3_400,
            }
        );
        assert_eq!(brush_refinement_config(2_800, 54).refine_every, 24);
    }

    #[test]
    fn sana_pack_repairs_the_decoder_dependency_from_older_installs() {
        assert_eq!(PROP_SANA_DIFFUSERS_PACKAGE, "diffusers==0.36.0");
        assert!(PROP_SANA_DEPENDENCY_MARKER.ends_with("-v2"));
    }

    #[test]
    fn zip_paths_reject_traversal() {
        assert_eq!(
            safe_zip_path(Path::new("folder/file.txt")),
            Some(PathBuf::from("folder/file.txt"))
        );
        assert_eq!(safe_zip_path(Path::new("../escape.txt")), None);
    }

    #[test]
    fn downloadable_artifacts_are_pinned_and_have_unique_targets() {
        let archive = runtime_archive();
        assert_eq!(archive.sha256.len(), 64);
        assert!(archive
            .sha256
            .chars()
            .all(|character| character.is_ascii_hexdigit()));

        let mut targets = HashMap::new();
        for asset in CHARACTER_MODELS
            .iter()
            .chain(TRELLIS_MODELS)
            .chain(PROP_SANA_MODELS)
            .chain(PROP_KREA_MODELS)
            .chain(WORLD_MODELS)
            .chain(std::iter::once(&BRUSH))
        {
            assert!(asset.size > 0, "{} has no pinned size", asset.name);
            assert_eq!(
                asset.sha256.len(),
                64,
                "{} has an invalid SHA-256",
                asset.name
            );
            assert!(asset
                .sha256
                .chars()
                .all(|character| character.is_ascii_hexdigit()));
            if let Some(previous) = targets.insert(asset.relative_path, asset.sha256) {
                assert_eq!(
                    previous, asset.sha256,
                    "conflicting target {}",
                    asset.relative_path
                );
            }
        }
        for node in WORLD_NODES {
            assert_eq!(
                node.commit.len(),
                40,
                "{} is not pinned to a commit",
                node.name
            );
            assert_eq!(
                node.sha256.len(),
                64,
                "{} has an invalid SHA-256",
                node.name
            );
        }
    }

    #[test]
    fn managed_server_allows_the_desktop_webview_origin() {
        assert!(BASE_SERVER_ARGS.contains(&"--enable-cors-header"));
        assert!(BASE_SERVER_ARGS
            .windows(2)
            .any(|pair| pair == ["--listen", "127.0.0.1"]));
        assert!(BASE_SERVER_ARGS
            .windows(2)
            .any(|pair| pair == ["--port", "8189"]));
    }

    #[test]
    fn managed_server_reserves_vram_headroom() {
        let args = server_args(1.25);
        let reserve_index = args
            .iter()
            .position(|value| value == "--reserve-vram")
            .unwrap();
        assert_eq!(
            args.get(reserve_index + 1).map(String::as_str),
            Some("1.25")
        );
        let clamped = server_args(99.0);
        let reserve_index = clamped
            .iter()
            .position(|value| value == "--reserve-vram")
            .unwrap();
        assert_eq!(
            clamped.get(reserve_index + 1).map(String::as_str),
            Some("4.00")
        );
    }

    #[test]
    fn world_decoder_evicts_diffusion_weights_before_bounded_decode() {
        let unload = DNDROM_RUNTIME_NODES
            .find("comfy.model_management.unload_all_models()")
            .expect("world decoder unload");
        let decode = DNDROM_RUNTIME_NODES
            .find("images = vae.decode_tiled(")
            .expect("bounded VAE decode");
        assert!(
            unload < decode,
            "WAN weights must be evicted before VAE decode"
        );
        assert!(DNDROM_RUNTIME_NODES.contains("DnDRomWanVAEDecode"));
        assert!(DNDROM_RUNTIME_NODES.contains("DnDRomTrajectoryCoverage"));
        assert!(DNDROM_RUNTIME_NODES.contains("DnDRomDatasetResult"));
        assert!(DNDROM_RUNTIME_NODES.contains("DNDROM_COVERAGE:"));
        assert!(DNDROM_RUNTIME_NODES.contains("DNDROM_DATASET:"));
    }

    #[test]
    fn completed_world_dataset_can_be_recovered_after_history_omits_its_path() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let comfy = std::env::temp_dir().join(format!("dndrom-dataset-recovery-{unique}"));
        let complete = comfy.join("output/scene/sparse/0");
        fs::create_dir_all(comfy.join("output/scene/images")).unwrap();
        fs::create_dir_all(&complete).unwrap();
        for name in ["cameras.bin", "images.bin", "points3D.bin"] {
            fs::write(complete.join(name), [1_u8]).unwrap();
        }
        fs::create_dir_all(comfy.join("output/incomplete/images")).unwrap();

        let recovered = latest_complete_world_dataset(&comfy, Duration::from_secs(60)).unwrap();
        assert_eq!(recovered.as_deref(), Some(complete.as_path()));
        fs::remove_dir_all(&comfy).unwrap();
    }

    #[test]
    fn completed_trained_world_can_be_recovered_before_retraining() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let runtime = std::env::temp_dir().join(format!("dndrom-trained-world-recovery-{unique}"));
        let output = runtime.join("generated-worlds/123/dndrom-world.ply");
        fs::create_dir_all(output.parent().unwrap()).unwrap();
        fs::write(
            &output,
            b"ply\nformat binary_little_endian 1.0\nelement vertex 113568\nend_header\n",
        )
        .unwrap();

        let recovered = latest_trained_world(&runtime, Duration::from_secs(60)).unwrap();
        assert_eq!(recovered.as_deref(), Some(output.as_path()));
        fs::remove_dir_all(&runtime).unwrap();
    }

    #[test]
    fn brush_progress_parser_reads_steps_without_treating_loss_as_progress() {
        assert_eq!(
            training_step_from_line("train step 240/3500 loss 0.021", 3500),
            Some(240)
        );
        assert_eq!(
            training_step_from_line("iteration 91: refine", 3500),
            Some(91)
        );
        assert_eq!(training_step_from_line("loss 0.021", 3500), None);
        assert_eq!(training_step_from_line("step 9000/3500", 3500), None);
        assert_eq!(
            validation_loss_from_line("validation step 3000 loss 0.0215"),
            Some(0.0215)
        );
        assert_eq!(
            validation_loss_from_line("train step 3000 loss 0.0215"),
            None
        );
    }

    #[test]
    fn only_processes_inside_the_managed_runtime_can_be_restarted() {
        let runtime = Path::new("C:/Users/test/AppData/Local/ai.dndrom.desktop/runtime/comfy");
        assert!(executable_is_inside_runtime(
            Path::new(
                "C:/Users/test/AppData/Local/ai.dndrom.desktop/runtime/comfy/python_embeded/python.exe"
            ),
            runtime,
        ));
        assert!(!executable_is_inside_runtime(
            Path::new("C:/Tools/ComfyUI/python.exe"),
            runtime,
        ));
        assert!(!executable_is_inside_runtime(runtime, runtime));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn closing_the_managed_job_terminates_its_engine_process() {
        let job = ManagedProcessJob::new().expect("job object");
        let mut child = hidden_command(Path::new("powershell.exe"))
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 30",
            ])
            .spawn()
            .expect("test child");
        job.assign_child(&child).expect("assign child");
        job.shutdown();
        let mut exited = false;
        for _ in 0..20 {
            if child.try_wait().expect("child status").is_some() {
                exited = true;
                break;
            }
            thread::sleep(Duration::from_millis(25));
        }
        if !exited {
            let _ = child.kill();
        }
        assert!(exited, "closing the job must promptly terminate its child");
    }
}
