#pragma once
#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "DnDRomWaterSubsystem.generated.h"

class FJsonObject;
class UMaterialInstanceDynamic;
class UTexture2D;
class UTextureRenderTarget2D;
class APostProcessVolume;

/** One world-space history, independent of tile actor lifetimes. */
UCLASS()
class DNDROM_API UDnDRomWaterSubsystem : public UWorldSubsystem
{
    GENERATED_BODY()
public:
    static bool ValidateFields(const TSharedPtr<FJsonObject>& Root);
    void RegisterFields(AActor* Owner, const TSharedPtr<FJsonObject>& Root);
    void Advance(float DeltaSeconds, const FVector& Focus);
    bool SampleAt(const FVector2D& Point,FVector3f& Value) const;
    void UpdateView(const FVector& Camera);
    UMaterialInstanceDynamic* Material(bool Terrain = false);
    void Reset();
    void SetEmission(float Value) { Emission = FMath::Clamp(Value, 0.f, 1.f); }
    void SetWind(float Speed,float Direction);
    void SetCoastalSediment(bool Enabled) { CoastalSediment=Enabled?1.f:0.f; }
    TSharedPtr<FJsonObject> Diagnostics(bool Readback = false) const;
private:
    struct FField {
        TWeakObjectPtr<AActor> Owner;
        double X = 0, Y = 0, Size = 0;
        int32 Resolution = 0;
        TArray<FVector3f> Values; // signed depth, signed shore distance, surface height (m)
    };
    TArray<FField> Fields;
    UPROPERTY(Transient) TObjectPtr<UTexture2D> Info;
    UPROPERTY(Transient) TObjectPtr<UTextureRenderTarget2D> History[2];
    UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> WaterMaterial;
    UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> GroundMaterial;
    UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> UpdateMaterial;
    UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> UnderwaterMaterial;
    UPROPERTY(Transient) TObjectPtr<APostProcessVolume> UnderwaterVolume;
    UPROPERTY(Transient) TObjectPtr<class USceneCaptureComponentCube> WaterViewCapture;
    UPROPERTY(Transient) TObjectPtr<class UTextureRenderTargetCube> WaterViewEnvironment;
    FVector EnvironmentPosition=FVector::ZeroVector;
    double EnvironmentCapturedAt=-100;
    int32 EnvironmentCaptures=0;
    FVector ViewPosition=FVector::ZeroVector;
    float ViewDepth=0;
    bool bUnderwater=false;
    FVector2D Origin = FVector2D::ZeroVector, HistoryOrigin = FVector2D::ZeroVector;
    FVector Wind=FVector(.82,.57,1),TargetWind=FVector(.82,.57,1);
    uint32 FieldSignature = 0;
    int32 ReadIndex = 0, Steps = 0, Reprojections = 0, FieldUploads = 0;
    float Accumulator = 0, RefreshAge = 1, SimTime = 0, Emission = 1;
    float CoastalSediment = 0;
    double LastFieldMilliseconds = 0;
    bool bReady = false, bDirty = true;
    bool InitializeResources();
    void RefreshField(const FVector2D& NextOrigin);
    void Bind(UMaterialInstanceDynamic* Target);
};
