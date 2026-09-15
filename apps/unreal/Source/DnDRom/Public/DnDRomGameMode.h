#pragma once
#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/HUD.h"
#include "DnDRomGameMode.generated.h"

class ADnDRomSceneActor;
class SWidget;
class UDnDRomAppBridge;
class FJsonObject;

UCLASS()
class DNDROM_API ADnDRomPlayerController : public APlayerController
{
    GENERATED_BODY()
public:
    void DrawEditorHUD(class UCanvas* Canvas);
    virtual void BeginPlay() override;
    virtual void EndPlay(const EEndPlayReason::Type Reason) override;
    virtual void PlayerTick(float DeltaSeconds) override;
    bool AppLoadScene(const FString& Path);
    void RebindCachedImport(const FString& Kind,const FString& Name,const FString& Identity);
    FString AppInput(const TSharedPtr<FJsonObject>& Input);
    FString AppViewport(const TSharedPtr<FJsonObject>& Input);
    TSharedPtr<FJsonObject> AppDiagnostics() const;
    bool AppLoadTile(const FString& Id, const FString& Path, const FString& CachedIdentity=FString());
    void AppWorld(const FString& Method, const TSharedPtr<FJsonObject>& Input);
    void AppEnvironment(const TSharedPtr<FJsonObject>& Input);
    bool AppLoadMaterial(const FString& Path);
    class UMaterialInterface* AppMaterial(const FString& Id) const;
private:
    UPROPERTY() TObjectPtr<ADnDRomSceneActor> Scene;
    UPROPERTY() TObjectPtr<ADnDRomSceneActor> PendingScene;
    bool ReframeScene = false;
    FVector CameraPivot = FVector::ZeroVector;
    double CameraDistance = 1000.;
    FVector TargetPivot=FVector::ZeroVector;
    FRotator TargetRotation=FRotator::ZeroRotator;
    double TargetDistance=1000.;
    bool bCameraTarget=false;
    int32 CameraCollisions=0;
    bool bFlyCamera=false;
    TArray<FVector> CameraFrameSamples;
    void ResetCameraTarget();
    void TickCamera(float DeltaSeconds);
    FVector ConstrainCamera(const FVector& Start,const FVector& Desired);
    void FrameScene();
    FString AppEditor(const TSharedPtr<FJsonObject>& Input);
    void TickEditor();
    FString EditorEntity,EditorTool=TEXT("move");
    FVector EditorPosition=FVector::ZeroVector;
    TMap<FString,FTransform> EditorPreviews;
    bool bEditorGrid=false;
    double EditorGridSize=1;
    FString EditorGridShape;
    TArray<FVector> EditorGridLines;
    FVector EditorGridCenter=FVector(MAX_dbl);
    double EditorGridBuiltAt=-1;
    void SetWorldReveal(const TSharedPtr<FJsonObject>& Input);
    void TickWorldReveal(float DeltaSeconds);
    FString RevealIdentity;
    float RevealRadius=0,RevealTarget=0,RevealTime=0;
    float RevealOpacity=0;
    bool bRevealComplete=false,bRevealEnabled=false;
    UPROPERTY() TObjectPtr<class APostProcessVolume> RevealVolume;
    UPROPERTY() TObjectPtr<class UMaterialInstanceDynamic> RevealMaterial;
    UPROPERTY() TObjectPtr<UDnDRomAppBridge> AppBridge;
    UPROPERTY() TMap<FString, TObjectPtr<ADnDRomSceneActor>> WorldTiles;
    UPROPERTY() TMap<FString, TObjectPtr<ADnDRomSceneActor>> PendingWorldTiles;
    TSet<FString> VisibleWorldTiles;
    UPROPERTY() TArray<TObjectPtr<class UPointLightComponent>> PracticalLights;
    UPROPERTY() TObjectPtr<class APostProcessVolume> AppPostProcess;
    UPROPERTY() TMap<FString, TObjectPtr<class UMaterialInstanceDynamic>> MaterialLibrary;
    TSharedPtr<SWidget> Panel;
    FString ScenePath;
    FString SelectedEntity;
    FString SmokeDirectory;
    double SmokeStarted = 0;
    int32 SmokeStage = 0;
    TArray<double> SmokeFrameTimes;
    void TickSmoke(float DeltaSeconds);
    void OpenScene();
};

UCLASS()
class DNDROM_API ADnDRomGameMode : public AGameModeBase
{
    GENERATED_BODY()
public:
    ADnDRomGameMode();
};

UCLASS()
class DNDROM_API ADnDRomEditorHUD : public AHUD
{
    GENERATED_BODY()
public:
    virtual void DrawHUD() override;
};
