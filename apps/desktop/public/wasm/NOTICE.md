# Local WebGPU shader translators

DnDRom packages `glslang` and `twgsl` locally so the Tauri application never
depends on a network request while PlayCanvas creates a WebGPU graphics device.

- `glslang/glslang.js` and `glslang/glslang.wasm`: Khronos glslang WebAssembly build vendored from PlayCanvas Engine's `release-2.21` example assets.
- `twgsl/twgsl.js` and `twgsl/twgsl.wasm`: Tint WGSL translator WebAssembly build vendored from PlayCanvas Engine's `release-2.21` example assets.

These binaries are runtime shader translators used by PlayCanvas. Their
upstream licenses remain applicable. SHA-256 checksums for the packaged files:

```text
C4D874B63615E4ED03A739EB01506282C25E03954D97F13DFD9A2C9E06138120  glslang/glslang.js
D79453E0803EBCDF3753C6B1D8D51543B52FED96F7F0D4AEC94ACD847E225169  glslang/glslang.wasm
B4F1F66263B801210F955F74AA71F1939BE647CE0FD80EA5BEFD12A78499D5FF  twgsl/twgsl.js
A434C2DECDBB38CAADF5F486D806384A1543554828C983C77922B2D92579914C  twgsl/twgsl.wasm
```
