#include "DnDRomSceneActor.h"
#include "ProceduralMeshComponent.h"
#include "PhysicsEngine/BodyInstance.h"
#include "PhysicsEngine/BodySetup.h"
#include "GameFramework/PlayerController.h"
#include "Camera/PlayerCameraManager.h"
#include "Engine/World.h"

bool ADnDRomSceneActor::NeedsTerrainCollision(int32 I) const
{
    const auto& Patch=GroundPatches[I];const auto Size=Patch.Bounds.GetSize();
    if(FMath::Max(Size.X,Size.Y)>51200)return false;
    FVector Camera=FVector::ZeroVector;
    if(auto* PC=GetWorld()->GetFirstPlayerController())if(PC->PlayerCameraManager)Camera=PC->PlayerCameraManager->GetCameraLocation();
    const auto Distance2D=[&](const FVector& P){return FVector2D::Distance(FVector2D(P),FVector2D(Patch.Bounds.GetClosestPointTo(FVector(P.X,P.Y,Patch.Bounds.GetCenter().Z))));};
    return Distance2D(FVector::ZeroVector)<25600||Distance2D(Camera)<(TerrainCollision.IsValidIndex(I)&&TerrainCollision[I]?64000:51200);
}
bool ADnDRomSceneActor::TerrainPhysicsReady() const
{
    for(int32 I=0;I<GroundPatches.Num();I++)if(NeedsTerrainCollision(I)){
        if(!TerrainCollision.IsValidIndex(I)||!TerrainCollision[I])return false;
        auto* Body=TerrainCollision[I]->GetBodySetup();if(!Body||!Body->bCreatedPhysicsMeshes||Body->bFailedToCreatePhysicsMeshes)return false;
    }
    return true;
}

void ADnDRomSceneActor::UpdateTerrainCollision()
{
    // One bounded cooking queue shared by every streamed actor.
    static uint64 BudgetFrame=MAX_uint64;
    static int32 StartedThisFrame=0;
    static TArray<TWeakObjectPtr<UProceduralMeshComponent>> Cooking;
    if(BudgetFrame!=GFrameCounter){BudgetFrame=GFrameCounter;StartedThisFrame=0;}
    Cooking.RemoveAll([](const auto& Weak){auto* C=Weak.Get();return !C||(C->GetBodySetup()&&C->GetBodySetup()->bCreatedPhysicsMeshes);});
    TerrainCollision.SetNum(GroundPatches.Num());
    for(int32 I=0;I<GroundPatches.Num();I++){
        const auto& Patch=GroundPatches[I];auto& C=TerrainCollision[I];
        const bool Needed=bImportComplete&&NeedsTerrainCollision(I);
        if(!Needed){if(C){C->DestroyComponent();C=nullptr;}continue;}
        if(C)C->SetCollisionEnabled(IsHidden()?ECollisionEnabled::NoCollision:ECollisionEnabled::QueryAndPhysics);
        if(C||StartedThisFrame>=2||Cooking.Num()>=4)continue;
        C=NewObject<UProceduralMeshComponent>(this);C->SetupAttachment(RootComponent);
        C->bUseAsyncCooking=true;C->bUseComplexAsSimpleCollision=true;
        C->SetCollisionObjectType(ECC_WorldStatic);C->SetCollisionResponseToAllChannels(ECR_Block);
        C->SetCollisionEnabled(IsHidden()?ECollisionEnabled::NoCollision:ECollisionEnabled::QueryAndPhysics);C->SetGenerateOverlapEvents(false);
        C->SetVisibility(false);C->SetCastShadow(false);C->RegisterComponent();
        // Position-only geometry follows the rendered terrain exactly, including
        // road cuts and foundations. No skirts, normals, textures or foliage.
        C->CreateMeshSection(0,Patch.Vertices,Patch.Indices,TArray<FVector>(),TArray<FVector2D>(),TArray<FColor>(),TArray<FProcMeshTangent>(),true);
        Cooking.Add(C.Get());StartedThisFrame++;
    }
}
