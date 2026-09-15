#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "DnDRomSceneActor.generated.h"

class FJsonObject;
class UProceduralMeshComponent;
class UHierarchicalInstancedStaticMeshComponent;

UCLASS()
class DNDROM_API ADnDRomSceneActor : public AActor
{
    GENERATED_BODY()
public:
    ADnDRomSceneActor();
    virtual void Tick(float DeltaSeconds) override;
    UFUNCTION(BlueprintCallable) bool LoadScene(const FString& Filename);
    UFUNCTION(BlueprintCallable) FString EntityForHit(UPrimitiveComponent* Component, int32 InstanceIndex) const;
    UPROPERTY(BlueprintReadOnly) FString Status;
    FString SceneName;
    FString SceneIdentity;
    FString StreamIdentity;
    FString ReplaceEntityId;
    void RemoveEntity(const FString& Id);
    void TransformEntity(const FString& Id,const FTransform& Before,const FTransform& After);
    UPROPERTY(BlueprintReadOnly) FVector SuggestedCamera = FVector(0, 0, 2000);
    bool IsImportComplete() const { return bImportComplete && TerrainPhysicsReady(); }
    TSharedPtr<FJsonObject> ImportDiagnostics() const;
    static TArray<FString> CachedPrototypeIds();
    bool GroundRayHit(const FVector& Origin, const FVector& Direction, double& Distance, FVector& Point) const;
    bool GroundHeightAt(const FVector2D& Point, double& Height) const;
private:
    struct FGroundPatch { FBox Bounds=FBox(ForceInit); TArray<FVector> Vertices; TArray<int32> Indices; };
    TArray<FGroundPatch> GroundPatches;
    UPROPERTY(Transient) TArray<TObjectPtr<UProceduralMeshComponent>> TerrainCollision;
    void UpdateTerrainCollision();
    bool NeedsTerrainCollision(int32 Index) const;
    bool TerrainPhysicsReady() const;
    struct FRouteMotion { TWeakObjectPtr<UHierarchicalInstancedStaticMeshComponent> Component; int32 Instance = 0; TArray<FVector> Points; double Length = 0; double Speed = 300; double Dwell = 12; FVector Scale = FVector::OneVector; };
    TArray<FRouteMotion> RouteMotions;
    bool bImportComplete = false;
    TSharedPtr<FJsonObject> Document;
    double MeshBuildMilliseconds = 0;
    int32 MeshesBuilt = 0;
    int32 PrototypeCacheHits = 0;
    int32 NextMesh = 0;
    int32 WarningCount = 0;
    int64 VertexColorsChecked = 0;
    int64 VertexColorMismatches = 0;
    TMap<FString, TArray<TSharedPtr<FJsonObject>>> Placements;
    TMap<TWeakObjectPtr<UPrimitiveComponent>, TArray<FString>> EntityIds;
    UPROPERTY(Transient) TArray<TObjectPtr<UHierarchicalInstancedStaticMeshComponent>> Groups;
    bool BuildMesh(const TSharedPtr<FJsonObject>& Definition);
};
