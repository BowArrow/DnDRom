using UnrealBuildTool;
using System.Collections.Generic;
public class DnDRomEditorTarget : TargetRules
{
    public DnDRomEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V7;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("DnDRom");
    }
}
