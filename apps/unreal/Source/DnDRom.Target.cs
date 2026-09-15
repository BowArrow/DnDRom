using UnrealBuildTool;
using System.Collections.Generic;
public class DnDRomTarget : TargetRules
{
    public DnDRomTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.V7;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("DnDRom");
    }
}
