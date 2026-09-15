param([string]$Version='039',[string]$Archive='artifacts/unreal-package/Windows')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$taskRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskOutput=Join-Path $taskRoot "artifacts/icons-$Version"
New-Item -ItemType Directory -Force -Path $taskOutput | Out-Null
# Decode the ICO's PNG payload directly. System.Drawing.Icon.ToBitmap on this
# PNG-compressed ICO can return uninitialised pixels on Windows PowerShell.
$icoBytes=[System.IO.File]::ReadAllBytes((Join-Path $taskRoot 'apps/desktop/src-tauri/icons/icon.ico'))
$brandStream=$null
for($i=0;$i -lt [BitConverter]::ToUInt16($icoBytes,4);$i++){
 $entry=6+$i*16
 if($icoBytes[$entry] -eq 32 -and $icoBytes[$entry+1] -eq 32){
  $length=[BitConverter]::ToUInt32($icoBytes,$entry+8);$offset=[BitConverter]::ToUInt32($icoBytes,$entry+12)
  $brandStream=[System.IO.MemoryStream]::new($icoBytes,$offset,$length)
  break
 }
}
if(!$brandStream){throw 'Brand ICO has no 32 px image'}
$brandBitmap=[System.Drawing.Bitmap]::FromStream($brandStream)
$brandBitmap.Save((Join-Path $taskOutput 'brand.png'))
$dotted=if($Version.Contains('.')){$Version}else{($Version.ToCharArray() -join '.')}
$files=@{
 'application'=Join-Path $Archive 'DnDRom/Binaries/Win64/DnDRom.exe'
 'launcher'=Join-Path $Archive 'DnDRom.exe'
 'installer'="artifacts/installers/DnDRom-Unreal-$dotted-x64-setup.exe"
}
$results=@{}
foreach($name in $files.Keys){
 $file=(Resolve-Path $files[$name]).Path
 $icon=[System.Drawing.Icon]::ExtractAssociatedIcon($file)
 $bitmap=$icon.ToBitmap()
 $bitmap.Save((Join-Path $taskOutput "$name.png"))
 if($bitmap.Size -ne $brandBitmap.Size){throw "$name icon has unexpected dimensions"}
 $different=0
 for($y=0;$y -lt $bitmap.Height;$y++){for($x=0;$x -lt $bitmap.Width;$x++){
  if($bitmap.GetPixel($x,$y).ToArgb() -ne $brandBitmap.GetPixel($x,$y).ToArgb()){$different++}
 }}
 if($different -ne 0){throw "$name does not use the brand icon ($different differing pixels)"}
 $results[$name]=@{brandIconMatches=$true;file=$file}
 $bitmap.Dispose();$icon.Dispose()
}
$brandBitmap.Dispose();$brandStream.Dispose()
$results | ConvertTo-Json -Depth 3 | Set-Content -Encoding UTF8 (Join-Path $taskOutput 'report.json')
$results | ConvertTo-Json -Depth 3
