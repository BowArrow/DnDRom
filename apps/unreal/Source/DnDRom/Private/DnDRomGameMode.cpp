#include "DnDRomGameMode.h"
#include "DnDRomWaterSubsystem.h"
#include "DnDRomSceneActor.h"
#include "DnDRomRuntimeSubsystem.h"
#include "DnDRomAppBridge.h"
#include "SWebBrowser.h"
#include "Engine/LocalPlayer.h"
#include "EngineUtils.h"
#include "Engine/DirectionalLight.h"
#include "Engine/SkyLight.h"
#include "Engine/PostProcessVolume.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/SpotLightComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Engine/Texture2D.h"
#include "ImageUtils.h"
#include "Misc/Base64.h"
#include "IImageWrapperModule.h"
#include "IImageWrapper.h"
#include "Engine/GameViewportClient.h"
#include "Engine/World.h"
#include "GameFramework/SpectatorPawn.h"
#include "Camera/PlayerCameraManager.h"
#include "GameFramework/PawnMovementComponent.h"
#include "InputCoreTypes.h"
#include "Widgets/SOverlay.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Text/STextBlock.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Misc/FileHelper.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformMemory.h"
#include "UnrealClient.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"

ADnDRomGameMode::ADnDRomGameMode()
{
    HUDClass = ADnDRomEditorHUD::StaticClass();
    DefaultPawnClass = ASpectatorPawn::StaticClass();
    PlayerControllerClass = ADnDRomPlayerController::StaticClass();
}

void ADnDRomPlayerController::BeginPlay()
{
    Super::BeginPlay();
    Scene = GetWorld()->SpawnActor<ADnDRomSceneActor>();
    bShowMouseCursor = true;
    // Movement is explicitly gated by right mouse so editing the file path
    // never drives the camera through the world.
    SetIgnoreMoveInput(true); SetIgnoreLookInput(true);
    SetInputMode(FInputModeGameAndUI().SetHideCursorDuringCapture(false));
    const auto Runtime = GetGameInstance()->GetSubsystem<UDnDRomRuntimeSubsystem>();
    Runtime->StartHost(); // Handshake only; does not download or load models.
    FParse::Value(FCommandLine::Get(), TEXT("DnDRomScene="), ScenePath);
    FParse::Value(FCommandLine::Get(), TEXT("DnDRomSmokeOutput="), SmokeDirectory);
    if (!ScenePath.IsEmpty()) OpenScene();
    if (!FParse::Param(FCommandLine::Get(), TEXT("DnDRomViewer")) && SmokeDirectory.IsEmpty())
    {
        AppBridge = NewObject<UDnDRomAppBridge>(this);
        Panel = AppBridge->Create(this);
        if (GetWorld()->GetGameViewport()) GetWorld()->GetGameViewport()->AddViewportWidgetContent(Panel.ToSharedRef());
        return;
    }
    SAssignNew(Panel, SOverlay)
    + SOverlay::Slot().HAlign(HAlign_Left).VAlign(VAlign_Top).Padding(16)
    [
        SNew(SBox).WidthOverride(650)
        [ SNew(SBorder).Padding(12).BorderBackgroundColor(FLinearColor(.035f, .028f, .02f, .94f))
          [ SNew(SVerticalBox)
            + SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 8)
            [ SNew(STextBlock).Text(FText::FromString(TEXT("DnDRom Ã‚Â· Unreal migration preview"))) ]
            + SVerticalBox::Slot().AutoHeight()
            [ SNew(SHorizontalBox)
              + SHorizontalBox::Slot().FillWidth(1)
              [ SNew(SEditableTextBox).Text_Lambda([this] { return FText::FromString(ScenePath); })
                .HintText(FText::FromString(TEXT("Path to exported .dndscene")))
                .OnTextChanged_Lambda([this](const FText& Text) { ScenePath = Text.ToString(); })
                .OnTextCommitted_Lambda([this](const FText&, ETextCommit::Type Type) { if (Type == ETextCommit::OnEnter) OpenScene(); }) ]
              + SHorizontalBox::Slot().AutoWidth().Padding(6, 0)
              [ SNew(SButton).Text(FText::FromString(TEXT("Open scene"))).OnClicked_Lambda([this] { OpenScene(); return FReply::Handled(); }) ]
            ]
            + SVerticalBox::Slot().AutoHeight().Padding(0, 8)
            [ SNew(STextBlock).AutoWrapText(true).Text_Lambda([this] { return FText::FromString(Scene ? Scene->Status : TEXT("No scene")); }) ]
            + SVerticalBox::Slot().AutoHeight()
            [ SNew(STextBlock).AutoWrapText(true).Text_Lambda([Runtime] { return FText::FromString(Runtime->Status); }) ]
            + SVerticalBox::Slot().AutoHeight().Padding(0, 8)
            [ SNew(SHorizontalBox)
              + SHorizontalBox::Slot().AutoWidth()
              [ SNew(SButton).Text(FText::FromString(TEXT("Check installed language model"))).OnClicked_Lambda([Runtime] { if (Runtime->StartHost()) Runtime->Request(TEXT("runtime.status"), TEXT("{\"feature\":\"languageModel\"}")); return FReply::Handled(); }) ]
              + SHorizontalBox::Slot().AutoWidth().Padding(6, 0)
              [ SNew(SButton).Text(FText::FromString(TEXT("Release AI memory"))).OnClicked_Lambda([Runtime] { Runtime->Request(TEXT("runtime.release")); return FReply::Handled(); }) ]
            ]
            + SVerticalBox::Slot().AutoHeight()
            [ SNew(STextBlock).AutoWrapText(true).Text(FText::FromString(TEXT("Hold right mouse: look and fly with WASD / Q / E. Shift: faster. Left click: select geometry."))) ]
            + SVerticalBox::Slot().AutoHeight().Padding(0, 6)
            [ SNew(STextBlock).Text_Lambda([this] { return FText::FromString(SelectedEntity.IsEmpty() ? TEXT("") : TEXT("Selected: ") + SelectedEntity); }) ]
          ]
        ]
    ];
    if (GetWorld()->GetGameViewport()) GetWorld()->GetGameViewport()->AddViewportWidgetContent(Panel.ToSharedRef());
}

void ADnDRomPlayerController::OpenScene()
{
    if (Scene && Scene->LoadScene(ScenePath.TrimStartAndEnd()))
    {
        if (GetPawn()) GetPawn()->SetActorLocation(Scene->SuggestedCamera);
        SetControlRotation(FRotator(-30, 45, 0)); SelectedEntity.Empty();
    }
}

bool ADnDRomPlayerController::AppLoadScene(const FString& Path)
{
    auto* Replacement = GetWorld()->SpawnActor<ADnDRomSceneActor>();
    Replacement->SetActorHiddenInGame(true);
    if (!Replacement->LoadScene(Path)) { Replacement->Destroy(); return false; }
    ReframeScene = Scene->SceneName != Replacement->SceneName || Scene->SceneIdentity != Replacement->SceneIdentity || !Scene->IsImportComplete();
    if (PendingScene) PendingScene->Destroy(); PendingScene = Replacement;
    return true;
}

TSharedPtr<FJsonObject> ADnDRomPlayerController::AppDiagnostics() const
{
    auto Report = (PendingScene ? PendingScene : Scene)->ImportDiagnostics();
    Report->SetStringField(TEXT("streamId"),(PendingScene ? PendingScene : Scene)->StreamIdentity);
    Report->SetObjectField(TEXT("water"),GetWorld()->GetSubsystem<UDnDRomWaterSubsystem>()->Diagnostics());
    Report->SetBoolField(TEXT("worldSync"), true);
    Report->SetNumberField(TEXT("revealRadius"),RevealRadius);Report->SetNumberField(TEXT("revealTarget"),RevealTarget);Report->SetStringField(TEXT("revealIdentity"),RevealIdentity);
    Report->SetNumberField(TEXT("revealOpacity"),RevealOpacity);Report->SetBoolField(TEXT("revealComplete"),bRevealComplete);
    TArray<TSharedPtr<FJsonValue>> PrototypeIds; for (const auto& Id : ADnDRomSceneActor::CachedPrototypeIds()) PrototypeIds.Add(MakeShared<FJsonValueString>(Id)); Report->SetArrayField(TEXT("cachedPrototypes"), PrototypeIds);
    Report->SetNumberField(TEXT("frameMilliseconds"), GetWorld()->GetDeltaSeconds()*1000);
    const FPlatformMemoryStats Memory = FPlatformMemory::GetStats();
    Report->SetNumberField(TEXT("processMemoryBytes"), Memory.UsedPhysical);
    Report->SetNumberField(TEXT("peakProcessMemoryBytes"), Memory.PeakUsedPhysical);
    Report->SetNumberField(TEXT("worldTiles"), WorldTiles.Num());
    double WorldBuildMs = 0, WorldCacheHits = 0;
    for (const auto& Entry : WorldTiles) { const auto D = Entry.Value->ImportDiagnostics(); WorldBuildMs += D->GetNumberField(TEXT("meshBuildMilliseconds")); WorldCacheHits += D->GetNumberField(TEXT("prototypeCacheHits")); }
    Report->SetNumberField(TEXT("worldMeshBuildMilliseconds"), WorldBuildMs);
    Report->SetNumberField(TEXT("worldPrototypeCacheHits"), WorldCacheHits);
    TArray<TSharedPtr<FJsonValue>> Ready;
    for (const auto& Tile : WorldTiles) if (Tile.Value->IsImportComplete()) Ready.Add(MakeShared<FJsonValueString>(Tile.Key));
    Report->SetArrayField(TEXT("readyTiles"), Ready);
    TArray<TSharedPtr<FJsonValue>> Visible;
    for (const auto& Id : VisibleWorldTiles) if (WorldTiles.Contains(Id) && !WorldTiles[Id]->IsHidden()) Visible.Add(MakeShared<FJsonValueString>(Id));
    Report->SetArrayField(TEXT("visibleTiles"), Visible);
    Report->SetStringField(TEXT("editorEntity"),EditorEntity);
    Report->SetNumberField(TEXT("editorX"),EditorPosition.X/100);Report->SetNumberField(TEXT("editorY"),EditorPosition.Z/100);Report->SetNumberField(TEXT("editorZ"),EditorPosition.Y/100);
    Report->SetNumberField(TEXT("editorPreviews"),EditorPreviews.Num());
    if (GetPawn()) { const auto P = GetPawn()->GetActorLocation(); Report->SetNumberField(TEXT("cameraX"), P.X / 100); Report->SetNumberField(TEXT("cameraY"), P.Z / 100); Report->SetNumberField(TEXT("cameraZ"), P.Y / 100); }
    Report->SetNumberField(TEXT("pivotX"), CameraPivot.X / 100);
    Report->SetNumberField(TEXT("pivotY"), CameraPivot.Z / 100);
    Report->SetNumberField(TEXT("pivotZ"), CameraPivot.Y / 100);
    Report->SetNumberField(TEXT("cameraCollisions"),CameraCollisions);
    TArray<TSharedPtr<FJsonValue>> Frames;
    for(const auto& Sample:CameraFrameSamples){TArray<TSharedPtr<FJsonValue>> Row;Row.Add(MakeShared<FJsonValueNumber>(Sample.X));Row.Add(MakeShared<FJsonValueNumber>(Sample.Y));Row.Add(MakeShared<FJsonValueNumber>(Sample.Z));Frames.Add(MakeShared<FJsonValueArray>(Row));}
    Report->SetArrayField(TEXT("cameraFrames"),Frames);
    Report->SetNumberField(TEXT("cameraYaw"),GetControlRotation().Yaw);Report->SetNumberField(TEXT("cameraPitch"),GetControlRotation().Pitch);
    Report->SetNumberField(TEXT("cameraDistance"), CameraDistance / 100);
    Report->SetNumberField(TEXT("cameraYaw"), GetControlRotation().Yaw);
    Report->SetNumberField(TEXT("cameraPitch"), GetControlRotation().Pitch);
    return Report;
}

bool ADnDRomPlayerController::AppLoadTile(const FString& Id, const FString& Path, const FString& CachedIdentity)
{
    if(Id.Len()>80)return false;
    if(!WorldTiles.Contains(Id)&&!PendingWorldTiles.Contains(Id)){
        int32 Count=0;const bool Edit=Id.StartsWith(TEXT("edit:"));
        for(const auto& Entry:WorldTiles)if(Entry.Key.StartsWith(TEXT("edit:"))==Edit)Count++;
        for(const auto& Entry:PendingWorldTiles)if(Entry.Key.StartsWith(TEXT("edit:"))==Edit)Count++;
        if(Count>=(Edit?4096:515))return false;
    }
    auto* Tile = GetWorld()->SpawnActor<ADnDRomSceneActor>();
    Tile->SetActorHiddenInGame(true);
    if (!Tile->LoadScene(Path)) { Tile->Destroy(); return false; }
    if(!CachedIdentity.IsEmpty())Tile->StreamIdentity=CachedIdentity;
    if ((Id.StartsWith(TEXT("local:")) || Id.StartsWith(TEXT("edit:"))) && (Tile->StreamIdentity.IsEmpty() || Tile->StreamIdentity != Scene->StreamIdentity)) { Tile->Destroy(); return false; }
    if (auto* Old = PendingWorldTiles.Find(Id)) (*Old)->Destroy();
    PendingWorldTiles.Add(Id, Tile); return true;
}

void ADnDRomPlayerController::AppEnvironment(const TSharedPtr<FJsonObject>& Input)
{
    bool Interior = false; Input->TryGetBoolField(TEXT("interior"), Interior);
    bool Beach=false;Input->TryGetBoolField(TEXT("coastalSediment"),Beach);GetWorld()->GetSubsystem<UDnDRomWaterSubsystem>()->SetCoastalSediment(Beach);
    const TSharedPtr<FJsonObject>* Weather;
    if(Input->TryGetObjectField(TEXT("weather"),Weather)){
        double Speed=3,Direction=65;(*Weather)->TryGetNumberField(TEXT("windSpeed"),Speed);(*Weather)->TryGetNumberField(TEXT("windDirection"),Direction);
        GetWorld()->GetSubsystem<UDnDRomWaterSubsystem>()->SetWind(Speed,Direction);
    }
    const TSharedPtr<FJsonObject>* Lighting;
    double Key = 1, IBL = 1; FString Mood;
    if (Input->TryGetObjectField(TEXT("lighting"), Lighting)) { (*Lighting)->TryGetNumberField(TEXT("keyIntensity"), Key); (*Lighting)->TryGetNumberField(TEXT("iblIntensity"), IBL); (*Lighting)->TryGetStringField(TEXT("mood"), Mood); }
    for (TActorIterator<ADirectionalLight> It(GetWorld()); It; ++It)
    {
        auto* Light = Cast<UDirectionalLightComponent>(It->GetLightComponent());
        Light->SetIntensity((Interior ? 350.f : Mood == TEXT("moonlight") ? 30.f : 70000.f) * FMath::Clamp(Key, .05, 5.));
        Light->SetLightColor(Interior ? FLinearColor(1, .78, .52) : FLinearColor::White);
    }
    for (TActorIterator<ASkyLight> It(GetWorld()); It; ++It) It->GetLightComponent()->SetIntensity(FMath::Clamp(IBL, .1, 5.));
    if (!AppPostProcess) { AppPostProcess = GetWorld()->SpawnActor<APostProcessVolume>(); AppPostProcess->bUnbound = true; }
    auto& Post = AppPostProcess->Settings;
    Post.bOverride_AutoExposureSpeedUp = Post.bOverride_AutoExposureSpeedDown = true;
    Post.AutoExposureSpeedUp = Post.AutoExposureSpeedDown = 12;
    double Exposure = 1; bool Bloom = true, SSAO = true, Dynamic = true;
    if (Input->TryGetObjectField(TEXT("lighting"), Lighting)) { (*Lighting)->TryGetNumberField(TEXT("exposure"), Exposure); (*Lighting)->TryGetBoolField(TEXT("bloom"), Bloom); (*Lighting)->TryGetBoolField(TEXT("ssao"), SSAO); (*Lighting)->TryGetBoolField(TEXT("dynamicLights"), Dynamic); }
    Post.bOverride_MotionBlurAmount=true;Post.MotionBlurAmount=0;
    Post.bOverride_AutoExposureBias = true; Post.AutoExposureBias = FMath::Log2(FMath::Clamp(Exposure, .1, 10.));
    Post.bOverride_BloomIntensity = true; Post.BloomIntensity = Bloom ? .35f : 0.f;
    Post.bOverride_AmbientOcclusionIntensity = true; Post.AmbientOcclusionIntensity = SSAO ? .6f : 0.f;
    for (const auto& Light : PracticalLights) Light->DestroyComponent(); PracticalLights.Empty();
    if (!Dynamic) return;
    const TArray<TSharedPtr<FJsonValue>>* Lights;
    if (!Input->TryGetArrayField(TEXT("lights"), Lights)) return;
    for (const auto& Value : *Lights)
    {
        if (PracticalLights.Num() >= 128) break;
        const auto Data = Value->AsObject(); const TSharedPtr<FJsonObject> *Behavior, *Position, *Direction;
        if (!Data.IsValid() || !Data->TryGetObjectField(TEXT("behavior"), Behavior) || !Data->TryGetObjectField(TEXT("position"), Position)) continue;
        FString Type, Color; double Intensity = 1, Range = 5, Cone = 55;
        (*Behavior)->TryGetStringField(TEXT("lightType"), Type); (*Behavior)->TryGetStringField(TEXT("color"), Color);
        (*Behavior)->TryGetNumberField(TEXT("intensity"), Intensity); (*Behavior)->TryGetNumberField(TEXT("range"), Range); (*Behavior)->TryGetNumberField(TEXT("coneAngle"), Cone);
        UPointLightComponent* Light = Type == TEXT("spot") ? NewObject<USpotLightComponent>(this) : NewObject<UPointLightComponent>(this);
        Light->SetMobility(EComponentMobility::Movable); Light->SetIntensityUnits(ELightUnits::Lumens);
        Light->SetIntensity(FMath::Clamp(Intensity, 0., 100.) * 500); Light->SetAttenuationRadius(FMath::Clamp(Range, .1, 100.) * 100);
        Light->SetLightColor(FLinearColor(FColor::FromHex(Color))); Light->SetCastShadows(PracticalLights.Num() < 4);
        auto Coord = [](const TSharedPtr<FJsonObject>& O) { double X = 0, Y = 0, Z = 0; O->TryGetNumberField(TEXT("x"), X); O->TryGetNumberField(TEXT("y"), Y); O->TryGetNumberField(TEXT("z"), Z); return FVector(X, Z, Y); };
        Light->SetWorldLocation(Coord(*Position) * 100);
        if (auto* Spot = Cast<USpotLightComponent>(Light)) { Spot->SetOuterConeAngle(FMath::Clamp(Cone, 1., 85.)); Spot->SetInnerConeAngle(FMath::Clamp(Cone * .6, 1., 80.)); if (Data->TryGetObjectField(TEXT("direction"), Direction)) Spot->SetWorldRotation(Coord(*Direction).Rotation()); }
        Light->RegisterComponentWithWorld(GetWorld()); PracticalLights.Add(Light);
    }
}

UMaterialInterface* ADnDRomPlayerController::AppMaterial(const FString& Id) const
{
    if(Id==TEXT("water") || Id==TEXT("terrain")) return GetWorld()->GetSubsystem<UDnDRomWaterSubsystem>()->Material(Id==TEXT("terrain"));
    const auto* Material = MaterialLibrary.Find(Id); return Material ? Material->Get() : nullptr;
}

bool ADnDRomPlayerController::AppLoadMaterial(const FString& Path)
{
    FString Json; TSharedPtr<FJsonObject> Data;
    if (!FFileHelper::LoadFileToString(Json, *Path) || !FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), Data)) return false;
    FString Id; const TSharedPtr<FJsonObject>* Maps;
    if (!Data->TryGetStringField(TEXT("id"), Id) || Id.IsEmpty() || Id.Len() > 100 || !Data->TryGetObjectField(TEXT("maps"), Maps) || (MaterialLibrary.Num() >= 64 && !MaterialLibrary.Contains(Id))) return false;
    bool Masked = false; Data->TryGetBoolField(TEXT("masked"), Masked);
    auto* Base = LoadObject<UMaterialInterface>(nullptr, Id.StartsWith(TEXT("glb-world-forest-v3-")) ? TEXT("/Game/DnDRom/Materials/M_custom_forest.M_custom_forest") : Masked ? TEXT("/Game/DnDRom/Materials/M_custom_masked.M_custom_masked") : TEXT("/Game/DnDRom/Materials/M_custom.M_custom")); if (!Base) return false;
    auto* Material = UMaterialInstanceDynamic::Create(Base, this);
    auto& Images = FModuleManager::LoadModuleChecked<IImageWrapperModule>(TEXT("ImageWrapper"));
    for (const FString Slot : { TEXT("albedo"), TEXT("normal"), TEXT("roughness"), TEXT("metallic"), TEXT("ambientOcclusion") })
    {
        FString Encoded; if (!(*Maps)->TryGetStringField(Slot, Encoded)) continue;
        TArray<uint8> Bytes; if (!FBase64::Decode(Encoded, Bytes) || Bytes.Num() > 32 * 1024 * 1024) return false;
        const auto Format = Images.DetectImageFormat(Bytes.GetData(), Bytes.Num());
        if (Format == EImageFormat::Invalid) return false;
        auto Wrapper = Images.CreateImageWrapper(Format);
        if (!Wrapper || !Wrapper->SetCompressed(Bytes.GetData(), Bytes.Num()) || Wrapper->GetWidth() > 2048 || Wrapper->GetHeight() > 2048) return false;
        auto* Texture = FImageUtils::ImportBufferAsTexture2D(Bytes); if (!Texture) return false;
        Texture->SRGB = Slot == TEXT("albedo"); Texture->AddressX = TA_Wrap; Texture->AddressY = TA_Wrap; Texture->UpdateResource();
        Material->SetTextureParameterValue(*Slot, Texture);
    }
    for (const FString Scalar : { TEXT("scale"), TEXT("rotation"), TEXT("normalStrength"), TEXT("roughness"), TEXT("metallic") })
    {
        double Value; if (Data->TryGetNumberField(Scalar, Value) && FMath::IsFinite(Value)) Material->SetScalarParameterValue(*(Scalar + TEXT("Value")), Scalar == TEXT("rotation") ? FMath::DegreesToRadians(Value) : FMath::Clamp(Value, 0., 100.));
    }
    MaterialLibrary.Add(Id, Material); return true;
}

void ADnDRomPlayerController::AppWorld(const FString& Method, const TSharedPtr<FJsonObject>& Input)
{
    if(Method==TEXT("world.reveal")){SetWorldReveal(Input);return;}
    if(Input->HasField(TEXT("revealRadius")))SetWorldReveal(Input);
    if (Method == TEXT("world.clear")) { TArray<FString> Keys;WorldTiles.GetKeys(Keys);for(const auto& Id:Keys)if(!(Id.StartsWith(TEXT("local:")) || Id.StartsWith(TEXT("edit:")))){WorldTiles[Id]->Destroy();WorldTiles.Remove(Id);}PendingWorldTiles.GetKeys(Keys);for(const auto& Id:Keys)if(!(Id.StartsWith(TEXT("local:")) || Id.StartsWith(TEXT("edit:")))){PendingWorldTiles[Id]->Destroy();PendingWorldTiles.Remove(Id);}VisibleWorldTiles.Empty();return; }
    const TArray<TSharedPtr<FJsonValue>> *Visible, *Remove;
    if (!Input->TryGetArrayField(TEXT("visible"), Visible) || !Input->TryGetArrayField(TEXT("remove"), Remove)) return;
    TSet<FString> Show; for (const auto& Id : *Visible) Show.Add(Id->AsString());
    VisibleWorldTiles = Show;
    for (const auto& Value : *Remove) {
        const FString Id = Value->AsString();
        if (auto* Tile = WorldTiles.Find(Id)) (*Tile)->Destroy(); WorldTiles.Remove(Id);
        if (auto* Tile = PendingWorldTiles.Find(Id)) (*Tile)->Destroy(); PendingWorldTiles.Remove(Id);
        VisibleWorldTiles.Remove(Id);
    }
    for (const auto& Tile : WorldTiles) Tile.Value->SetActorHiddenInGame(!(Tile.Key.StartsWith(TEXT("local:")) || Tile.Key.StartsWith(TEXT("edit:"))) && !Show.Contains(Tile.Key));
}

FString ADnDRomPlayerController::AppViewport(const TSharedPtr<FJsonObject>& Input)
{
    double X, Y, W, H;
    if (!Input->TryGetNumberField(TEXT("x"), X) || !Input->TryGetNumberField(TEXT("y"), Y) || !Input->TryGetNumberField(TEXT("width"), W) || !Input->TryGetNumberField(TEXT("height"), H)) return TEXT("{\"error\":\"Invalid viewport\"}");
    if (auto* Local = GetLocalPlayer())
    {
        Local->Origin = FVector2D(FMath::Clamp(X, 0., 1.), FMath::Clamp(Y, 0., 1.));
        Local->Size = FVector2D(FMath::Clamp(W, .001, 1. - Local->Origin.X), FMath::Clamp(H, .001, 1. - Local->Origin.Y));
    }
    return TEXT("{}");
}

FString ADnDRomPlayerController::AppInput(const TSharedPtr<FJsonObject>& Input)
{
    FString Kind; Input->TryGetStringField(TEXT("kind"), Kind);
    auto Number = [&Input](const TCHAR* Key) { double V = 0; Input->TryGetNumberField(Key, V); return FMath::IsFinite(V) ? V : 0.; };
    if (Kind==TEXT("water-review") && FParse::Param(FCommandLine::Get(),TEXT("DnDRomAutomation"))) {
        auto* Water=GetWorld()->GetSubsystem<UDnDRomWaterSubsystem>();
        if(Input->HasField(TEXT("emission"))) Water->SetEmission(Number(TEXT("emission")));
        if(Input->HasField(TEXT("x")) && GetPawn()) {
            GetPawn()->SetActorLocation(FVector(Number(TEXT("x")),Number(TEXT("z")),Number(TEXT("y")))*100);
            const FRotator Rotation(Number(TEXT("pitch")),Number(TEXT("yaw")),0);SetControlRotation(Rotation);
            CameraDistance=6000;CameraPivot=GetPawn()->GetActorLocation()+Rotation.Vector()*CameraDistance;ResetCameraTarget();
        }
        FString Json;FJsonSerializer::Serialize(Water->Diagnostics(true),TJsonWriterFactory<>::Create(&Json));return Json;
    }
    if ((Kind == TEXT("camera") || Kind == TEXT("navigate")) && GetPawn())
    {
        if(!bCameraTarget)ResetCameraTarget();
        const FVector TargetPosition=TargetPivot-TargetRotation.Vector()*TargetDistance;
        TargetRotation.Yaw=FRotator::NormalizeAxis(TargetRotation.Yaw+FMath::Clamp(Number(TEXT("yaw")),-180.,180.));
        TargetRotation.Pitch=FMath::Clamp(FRotator::NormalizeAxis(TargetRotation.Pitch)+Number(TEXT("pitch")),-89.,89.);
        TargetRotation.Roll=0;const FRotationMatrix Frame(TargetRotation);
        if(Kind==TEXT("camera")){
            bFlyCamera=true;
            TargetPivot=TargetPosition+TargetRotation.Vector()*TargetDistance;
            TargetPivot+= (Frame.GetUnitAxis(EAxis::X)*Number(TEXT("forward"))+Frame.GetUnitAxis(EAxis::Y)*Number(TEXT("right"))+FVector::UpVector*Number(TEXT("up"))).GetClampedToMaxSize(2000);
        }else{
            bFlyCamera=false;
            TargetDistance=FMath::Clamp(TargetDistance*FMath::Exp(FMath::Clamp(Number(TEXT("zoom")),-2.,2.)),50.,100000000.);
            const double Fov=PlayerCameraManager?PlayerCameraManager->GetFOVAngle():90.;
            const double Span=2*TargetDistance*FMath::Tan(FMath::DegreesToRadians(Fov*.5));
            TargetPivot+=(-Frame.GetUnitAxis(EAxis::Y)*FMath::Clamp(Number(TEXT("panX")),-2.,2.)+Frame.GetUnitAxis(EAxis::Z)*FMath::Clamp(Number(TEXT("panY")),-2.,2.))*Span;
        }
    }
    if(Kind==TEXT("frame"))FrameScene();
    if(Kind==TEXT("entities")||Kind==TEXT("editor"))return AppEditor(Input);
    if (Kind == TEXT("pick"))
    {
        FVector2D Size; GetWorld()->GetGameViewport()->GetViewportSize(Size);
        FVector Origin, Direction; FHitResult Hit;
        const bool RayValid=DeprojectScreenPositionToWorld(Number(TEXT("x"))*Size.X,Number(TEXT("y"))*Size.Y,Origin,Direction);
        FCollisionQueryParams Query(SCENE_QUERY_STAT(DnDRomPick),true);
        if(PendingScene)Query.AddIgnoredActor(PendingScene);
        for(const auto& Entry:PendingWorldTiles)Query.AddIgnoredActor(Entry.Value);
        for(const auto& Entry:WorldTiles)if(Entry.Value->IsHidden())Query.AddIgnoredActor(Entry.Value);
        bool GroundOnly=false;Input->TryGetBoolField(TEXT("groundOnly"),GroundOnly);
        bool Found=!GroundOnly&&RayValid&&GetWorld()->LineTraceSingleByChannel(Hit,Origin,Origin+Direction*10000000,ECC_Visibility,Query);
        const bool PhysicsHit=Found;
        double Distance=Found?Hit.Distance:10000000.;FVector Point=Found?Hit.ImpactPoint:FVector::ZeroVector;
        FString EntityId=Found?(Cast<ADnDRomSceneActor>(Hit.GetActor())?Cast<ADnDRomSceneActor>(Hit.GetActor())->EntityForHit(Hit.GetComponent(),Hit.Item):FString()):FString();
        if(RayValid){
            if(Scene->GroundRayHit(Origin,Direction,Distance,Point)){Found=true;EntityId.Empty();}
            for(const auto& Tile:WorldTiles)if(Tile.Value->GroundRayHit(Origin,Direction,Distance,Point)){Found=true;EntityId.Empty();}
        }
        if(!Found&&GroundOnly&&RayValid&&FMath::Abs(Direction.Z)>.0001){const double T=(Number(TEXT("planeY"))*100-Origin.Z)/Direction.Z;if(T>0){Point=Origin+Direction*T;Found=true;}}
        auto R=MakeShared<FJsonObject>();R->SetBoolField(TEXT("hit"),Found);R->SetBoolField(TEXT("physicsHit"),PhysicsHit);
        if(Found){
            R->SetStringField(TEXT("entityId"),EntityId);
            auto P=MakeShared<FJsonObject>();P->SetNumberField(TEXT("x"),Point.X/100);P->SetNumberField(TEXT("y"),Point.Z/100);P->SetNumberField(TEXT("z"),Point.Y/100);R->SetObjectField(TEXT("position"),P);
        }
        FString Json; FJsonSerializer::Serialize(R, TJsonWriterFactory<>::Create(&Json)); return Json;
    }
    return TEXT("{}");
}

void ADnDRomPlayerController::FrameScene()
{
    if (!Scene || !GetPawn()) return;
    const FBox Bounds = Scene->GetComponentsBoundingBox(true);
    if (!Bounds.IsValid) return;
    CameraPivot = Bounds.GetCenter();
    const double Extent = FMath::Max(1000., Bounds.GetExtent().Length() * 1.4);
    const FVector Location = CameraPivot + FVector(-Extent, -Extent, Extent * .75);
    CameraDistance = FVector::Distance(Location, CameraPivot);
    GetPawn()->SetActorLocation(Location);
    SetControlRotation((CameraPivot - Location).Rotation());ResetCameraTarget();
}

void ADnDRomPlayerController::PlayerTick(float DeltaSeconds)
{
    Super::PlayerTick(DeltaSeconds);
    if (PendingScene && PendingScene->IsImportComplete())
    {
        TArray<FString> LocalIds;for(const auto& Tile:WorldTiles)if((Tile.Key.StartsWith(TEXT("local:")) || Tile.Key.StartsWith(TEXT("edit:"))))LocalIds.Add(Tile.Key);
        for(const auto& Id:LocalIds){WorldTiles[Id]->Destroy();WorldTiles.Remove(Id);}
        EditorPreviews.Reset();EditorEntity.Empty();Scene->Destroy(); Scene = PendingScene; PendingScene = nullptr; Scene->SetActorHiddenInGame(false);
        if (ReframeScene) { GetWorld()->GetSubsystem<UDnDRomWaterSubsystem>()->Reset(); FrameScene(); }
    }
    TickWorldReveal(DeltaSeconds);
    TickCamera(DeltaSeconds);
    // Keep the previous edge topology visible until its replacement is built.
    // Camera movement must not open a hole while a tile is being restitched.
    TArray<FString> CompletedTiles;
    for (const auto& Entry : PendingWorldTiles) if (Entry.Value->IsImportComplete()) CompletedTiles.Add(Entry.Key);
    for (const FString& Id : CompletedTiles)
    {
        if((Id.StartsWith(TEXT("local:")) || Id.StartsWith(TEXT("edit:"))) && PendingWorldTiles[Id]->StreamIdentity!=Scene->StreamIdentity){PendingWorldTiles[Id]->Destroy();PendingWorldTiles.Remove(Id);continue;}
        if (auto* Old = WorldTiles.Find(Id)) (*Old)->Destroy();
        auto* Tile = PendingWorldTiles[Id].Get();
        if(!Tile->ReplaceEntityId.IsEmpty()){
            Scene->RemoveEntity(Tile->ReplaceEntityId);
            for(const auto& Other:WorldTiles)Other.Value->RemoveEntity(Tile->ReplaceEntityId);
        }
        WorldTiles.Add(Id, Tile); PendingWorldTiles.Remove(Id);
        Tile->SetActorHiddenInGame(!(Id.StartsWith(TEXT("local:")) || Id.StartsWith(TEXT("edit:"))) && !VisibleWorldTiles.Contains(Id));
    }
    if(GetPawn())GetWorld()->GetSubsystem<UDnDRomWaterSubsystem>()->UpdateView(GetPawn()->GetActorLocation());
    GetWorld()->GetSubsystem<UDnDRomWaterSubsystem>()->Advance(DeltaSeconds,CameraPivot);
    TickEditor();
    TickSmoke(DeltaSeconds);
    if (AppBridge) return;
    if (IsInputKeyDown(EKeys::RightMouseButton) && GetPawn())
    {
        float X, Y; GetInputMouseDelta(X, Y);
        auto Rotation = GetControlRotation(); Rotation.Yaw += X * .15f; Rotation.Pitch = FMath::Clamp(FRotator::NormalizeAxis(Rotation.Pitch) + Y * .15f, -89.f, 89.f); SetControlRotation(Rotation);
        FVector Direction = FVector::ZeroVector;
        const FRotationMatrix Frame(Rotation);
        if (IsInputKeyDown(EKeys::W)) Direction += Frame.GetUnitAxis(EAxis::X);
        if (IsInputKeyDown(EKeys::S)) Direction -= Frame.GetUnitAxis(EAxis::X);
        if (IsInputKeyDown(EKeys::D)) Direction += Frame.GetUnitAxis(EAxis::Y);
        if (IsInputKeyDown(EKeys::A)) Direction -= Frame.GetUnitAxis(EAxis::Y);
        if (IsInputKeyDown(EKeys::E)) Direction.Z += 1;
        if (IsInputKeyDown(EKeys::Q)) Direction.Z -= 1;
        const FVector Start=GetPawn()->GetActorLocation();
        GetPawn()->SetActorLocation(ConstrainCamera(Start,Start+Direction.GetSafeNormal()*DeltaSeconds*(IsInputKeyDown(EKeys::LeftShift)?12000:1800)));
        CameraPivot=GetPawn()->GetActorLocation()+Rotation.Vector()*CameraDistance;ResetCameraTarget();
    }
    if (WasInputKeyJustPressed(EKeys::LeftMouseButton) && Scene)
    {
        FHitResult Hit;
        if (GetHitResultUnderCursor(ECC_Visibility, true, Hit)) SelectedEntity = Scene->EntityForHit(Hit.GetComponent(), Hit.Item);
    }
}

void ADnDRomPlayerController::TickSmoke(float DeltaSeconds)
{
    if (SmokeDirectory.IsEmpty() || !Scene || !Scene->IsImportComplete() || !GetPawn()) return;
    const double Now = FPlatformTime::Seconds();
    if (!SmokeStage)
    {
        IFileManager::Get().MakeDirectory(*SmokeDirectory, true);
        SmokeStarted = Now; SmokeStage = 1;
    }
    if (SmokeStage == 1 && Now - SmokeStarted >= 15)
    {
        FScreenshotRequest::RequestScreenshot(FPaths::Combine(SmokeDirectory, TEXT("overview.png")), false, false);
        SmokeStage = 2; SmokeStarted = Now; SmokeFrameTimes.Reset();
    }
    else if (SmokeStage == 2)
    {
        SmokeFrameTimes.Add(DeltaSeconds * 1000.0);
        if (Now - SmokeStarted < 5) return;
        auto Report = Scene->ImportDiagnostics();
        SmokeFrameTimes.Sort();
        Report->SetNumberField(TEXT("frameMillisecondsMedian"), SmokeFrameTimes[SmokeFrameTimes.Num() / 2]);
        Report->SetNumberField(TEXT("frameMillisecondsP95"), SmokeFrameTimes[FMath::Min(SmokeFrameTimes.Num() - 1, FMath::FloorToInt(SmokeFrameTimes.Num() * .95))]);
        Report->SetNumberField(TEXT("processMemoryBytes"), FPlatformMemory::GetStats().UsedPhysical);
        Report->SetStringField(TEXT("runtimeStatus"), GetGameInstance()->GetSubsystem<UDnDRomRuntimeSubsystem>()->Status);
        const FBox Bounds = Scene->GetComponentsBoundingBox(true);
        const FVector Center = Bounds.GetCenter();
        FHitResult Hit;
        const bool Collision = GetWorld()->LineTraceSingleByChannel(Hit, Center + FVector(0, 0, 100000), Center - FVector(0, 0, 100000), ECC_Visibility);
        Report->SetBoolField(TEXT("centerCollisionHit"), Collision);
        Report->SetStringField(TEXT("hitEntityId"), Collision ? Scene->EntityForHit(Hit.GetComponent(), Hit.Item) : FString());
        FString Json; FJsonSerializer::Serialize(Report, TJsonWriterFactory<>::Create(&Json));
        FFileHelper::SaveStringToFile(Json, *FPaths::Combine(SmokeDirectory, TEXT("report.json")));
        if (Collision) { GetPawn()->SetActorLocation(Hit.ImpactPoint + FVector(-800, -800, 250)); SetControlRotation(FRotator(-5, 45, 0)); }
        SmokeStage = 3; SmokeStarted = Now;
    }
    else if (SmokeStage == 3 && Now - SmokeStarted >= 5)
    {
        FScreenshotRequest::RequestScreenshot(FPaths::Combine(SmokeDirectory, TEXT("ground.png")), false, false);
        SmokeStage = 4; SmokeStarted = Now;
    }
    else if (SmokeStage == 4 && Now - SmokeStarted >= 2) FPlatformMisc::RequestExit(false);
}

void ADnDRomPlayerController::EndPlay(const EEndPlayReason::Type Reason)
{
    if (AppBridge) AppBridge->Shutdown();
    if (Panel.IsValid() && GetWorld()->GetGameViewport()) GetWorld()->GetGameViewport()->RemoveViewportWidgetContent(Panel.ToSharedRef());
    Panel.Reset(); Super::EndPlay(Reason);
}

void ADnDRomPlayerController::RebindCachedImport(const FString& Kind,const FString& Name,const FString& Identity){
 if(Kind==TEXT("scene")&&PendingScene)PendingScene->StreamIdentity=Identity;
 else if(auto* Tile=PendingWorldTiles.Find(Name))(*Tile)->StreamIdentity=Identity;
}
