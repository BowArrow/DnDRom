using UnrealBuildTool;
using System.IO;
public class DnDRom : ModuleRules
{
    public DnDRom(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new[] { "Core", "CoreUObject", "Engine", "InputCore", "Json", "MeshDescription", "StaticMeshDescription" });
        PrivateDependencyModuleNames.AddRange(new[] { "Slate", "SlateCore", "RenderCore", "PhysicsCore", "ProceduralMeshComponent", "HTTP", "WebBrowser", "AudioCaptureCore", "AudioCapture", "ImageWrapper" });
        string WebUI = Path.GetFullPath(Path.Combine(ModuleDirectory, "../../WebUI"));
        // Vite changes hashed filenames on every UI build. Invalidate the cached
        // target receipt before enumerating its runtime dependencies again.
        ExternalDependencies.Add(Path.Combine(WebUI, "index.html"));
        if (Directory.Exists(WebUI))
            foreach (string FilePath in Directory.GetFiles(WebUI, "*", SearchOption.AllDirectories))
                RuntimeDependencies.Add(FilePath, StagedFileType.NonUFS);
        string Host = Path.Combine(ModuleDirectory, "../../Binaries/Win64/dndrom-runtime-host.exe");
        if (Target.Platform == UnrealTargetPlatform.Win64 && File.Exists(Host))
            RuntimeDependencies.Add(Host, StagedFileType.NonUFS);
    }
}
