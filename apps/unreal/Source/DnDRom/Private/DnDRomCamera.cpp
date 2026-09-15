#include "DnDRomGameMode.h"
#include "DnDRomSceneActor.h"
#include "Engine/World.h"
#include "GameFramework/Pawn.h"

// Query the same rendered triangles used by camera grounding. Runtime-built
// meshes need not have a cooked Chaos triangle body for editing to work.
bool ADnDRomSceneActor::GroundRayHit(const FVector& Origin,const FVector& Direction,double& Distance,FVector& Point) const
{
    if(IsHidden()||!bImportComplete)return false;
    bool Found=false;
    for(const auto& Patch:GroundPatches){
        if(!FMath::LineBoxIntersection(Patch.Bounds,Origin,Origin+Direction*Distance,Direction*Distance))continue;
        for(int32 I=0;I+2<Patch.Indices.Num();I+=3){
            const FVector A=Patch.Vertices[Patch.Indices[I]],E1=Patch.Vertices[Patch.Indices[I+1]]-A,E2=Patch.Vertices[Patch.Indices[I+2]]-A;
            const FVector P=FVector::CrossProduct(Direction,E2);const double Det=FVector::DotProduct(E1,P);
            if(FMath::Abs(Det)<1e-9)continue;
            const FVector T=Origin-A;const double U=FVector::DotProduct(T,P)/Det;if(U<0||U>1)continue;
            const FVector Q=FVector::CrossProduct(T,E1);const double V=FVector::DotProduct(Direction,Q)/Det;if(V<0||U+V>1)continue;
            const double D=FVector::DotProduct(E2,Q)/Det;if(D<0||D>=Distance)continue;
            Distance=D;Point=Origin+Direction*D;Found=true;
        }
    }
    return Found;
}

bool ADnDRomSceneActor::GroundHeightAt(const FVector2D& Point,double& Height) const
{
    bool Found=false;
    if(IsHidden()||!bImportComplete)return false;
    for(const auto& Patch:GroundPatches){
        if(Point.X<Patch.Bounds.Min.X||Point.X>Patch.Bounds.Max.X||Point.Y<Patch.Bounds.Min.Y||Point.Y>Patch.Bounds.Max.Y)continue;
        int32 First=0,Last=Patch.Indices.Num();const int32 N=FMath::RoundToInt(FMath::Sqrt(double(Patch.Vertices.Num())));
        if(N>1&&N*N==Patch.Vertices.Num()&&Patch.Indices.Num()==(N-1)*(N-1)*6&&FMath::IsNearlyEqual(Patch.Vertices[0].Y,Patch.Vertices[1].Y,.01)&&Patch.Vertices[1].X>Patch.Vertices[0].X&&Patch.Vertices[N].Y>Patch.Vertices[0].Y){
            const int32 X=FMath::Clamp(FMath::FloorToInt((Point.X-Patch.Bounds.Min.X)/FMath::Max(.001,Patch.Bounds.GetSize().X)*(N-1)),0,N-2),Y=FMath::Clamp(FMath::FloorToInt((Point.Y-Patch.Bounds.Min.Y)/FMath::Max(.001,Patch.Bounds.GetSize().Y)*(N-1)),0,N-2);
            First=(Y*(N-1)+X)*6;Last=First+6;
        }
        for(int32 I=First;I<Last;I+=3){
            const FVector A=Patch.Vertices[Patch.Indices[I]],B=Patch.Vertices[Patch.Indices[I+1]],C=Patch.Vertices[Patch.Indices[I+2]];
            const double D=(B.Y-C.Y)*(A.X-C.X)+(C.X-B.X)*(A.Y-C.Y);if(FMath::Abs(D)<.001)continue;
            const double U=((B.Y-C.Y)*(Point.X-C.X)+(C.X-B.X)*(Point.Y-C.Y))/D,V=((C.Y-A.Y)*(Point.X-C.X)+(A.X-C.X)*(Point.Y-C.Y))/D;
            if(U<-.000001||V<-.000001||U+V>1.000001)continue;
            const double Z=U*A.Z+V*B.Z+(1-U-V)*C.Z;
            Height=Found?FMath::Max(Height,Z):Z;Found=true;
        }
    }
    return Found;
}

void ADnDRomPlayerController::ResetCameraTarget()
{
    TargetRotation=GetControlRotation();TargetPivot=CameraPivot;TargetDistance=CameraDistance;bCameraTarget=true;bFlyCamera=false;
}

FVector ADnDRomPlayerController::ConstrainCamera(const FVector& Start,const FVector& Desired)
{
    FVector Result=Desired;double Ground=-DBL_MAX,H;
    if(Scene&&Scene->GroundHeightAt(FVector2D(Result),H))Ground=H;
    for(const auto& Entry:WorldTiles)if(Entry.Value->GroundHeightAt(FVector2D(Result),H))Ground=FMath::Max(Ground,H);
    if(Ground>-DBL_MAX&&Result.Z<Ground+40){Result.Z=Ground+40;++CameraCollisions;}
    FCollisionQueryParams Params(SCENE_QUERY_STAT(DnDRomCamera),true,GetPawn());
    if(PendingScene)Params.AddIgnoredActor(PendingScene);
    for(const auto& Entry:PendingWorldTiles)Params.AddIgnoredActor(Entry.Value);
    for(const auto& Entry:WorldTiles)if(Entry.Value->IsHidden())Params.AddIgnoredActor(Entry.Value);
    FHitResult Hit;
    if(GetWorld()->SweepSingleByChannel(Hit,Start,Result,FQuat::Identity,ECC_Camera,FCollisionShape::MakeSphere(30),Params)){
        if(!Hit.bStartPenetrating)Result=Hit.Location+Hit.Normal*4;
        else Result=Start+Hit.Normal*(Hit.PenetrationDepth+35);
        ++CameraCollisions;
    }
    return Result;
}

void ADnDRomPlayerController::TickCamera(float DeltaSeconds)
{
    if(!GetPawn()||!bCameraTarget)return;
    // Integrate on the render/game clock, independently of CEF packet timing.
    const double Alpha=1-FMath::Exp(-FMath::Min(DeltaSeconds,.1f)/.028);
    const FQuat Rotation=FQuat::Slerp(GetControlRotation().Quaternion(),TargetRotation.Quaternion(),Alpha);
    CameraPivot=FMath::Lerp(CameraPivot,TargetPivot,Alpha);
    CameraDistance=FMath::Lerp(CameraDistance,TargetDistance,Alpha);
    const FVector Desired=bFlyCamera?FMath::Lerp(GetPawn()->GetActorLocation(),TargetPivot-TargetRotation.Vector()*TargetDistance,Alpha):CameraPivot-Rotation.GetForwardVector()*CameraDistance;
    const FVector Position=ConstrainCamera(GetPawn()->GetActorLocation(),Desired);
    GetPawn()->SetActorLocation(Position);SetControlRotation(Rotation.Rotator());
    if(FParse::Param(FCommandLine::Get(),TEXT("DnDRomAutomation"))){
        if(CameraFrameSamples.Num()>=240)CameraFrameSamples.RemoveAt(0);
        CameraFrameSamples.Add(FVector(DeltaSeconds*1000,GetControlRotation().Yaw,GetControlRotation().Pitch));
    }
}
