#include "DnDRomWaterSubsystem.h"
#include "Engine/PostProcessVolume.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Components/SceneCaptureComponentCube.h"
#include "Engine/TextureRenderTargetCube.h"

bool UDnDRomWaterSubsystem::SampleAt(const FVector2D& Point,FVector3f& Value) const
{
    const FField* Best=nullptr;
    for(const auto& F:Fields){
        if(!F.Owner.IsValid()||F.Owner->IsHidden()||Point.X<F.X||Point.Y<F.Y||Point.X>F.X+F.Size||Point.Y>F.Y+F.Size)continue;
        if(!Best||F.Size/F.Resolution<Best->Size/Best->Resolution)Best=&F;
    }
    if(!Best)return false;
    const auto& F=*Best;const double U=(Point.X-F.X)/F.Size*F.Resolution,V=(Point.Y-F.Y)/F.Size*F.Resolution;
    const int32 X=FMath::Clamp(FMath::FloorToInt(U),0,F.Resolution-1),Y=FMath::Clamp(FMath::FloorToInt(V),0,F.Resolution-1),I=Y*(F.Resolution+1)+X;
    const float FX=FMath::Clamp(U-X,0.,1.),FY=FMath::Clamp(V-Y,0.,1.);
    const auto A=F.Values[I],B=F.Values[I+1],C=F.Values[I+F.Resolution+1],D=F.Values[I+F.Resolution+2];
    Value=FX+FY<=1?A+(B-A)*FX+(C-A)*FY:D*(FX+FY-1)+B*(1-FY)+C*(1-FX);
    return true;
}

void UDnDRomWaterSubsystem::UpdateView(const FVector& Camera)
{
    ViewPosition=Camera;FVector3f Water;
    const bool Valid=SampleAt(FVector2D(Camera.X*.01,Camera.Y*.01),Water)&&Water.X>.005;
    ViewDepth=Valid?Water.Z-Camera.Z*.01:0;
    bUnderwater=Valid&&ViewDepth>-.45; // shader resolves the displaced waterline
    if(UnderwaterVolume)UnderwaterVolume->BlendWeight=bUnderwater?1:0;
    if(UnderwaterMaterial)UnderwaterMaterial->SetVectorParameterValue(TEXT("CameraWater"),FLinearColor(Valid?Water.Z:0,Valid?Water.X:0,Valid?Water.Y:0,Valid?1:0));
    // A bounded HDR environment supplies offscreen refraction/reflection.
    // Rotation never triggers another six-view capture; only translation,
    // scene replacement or a slow refresh does. No per-frame capture cost.
    if(bUnderwater&&UnderwaterMaterial){
        if(!WaterViewCapture){
            WaterViewEnvironment=NewObject<UTextureRenderTargetCube>(this);
            WaterViewEnvironment->Init(128,PF_FloatRGBA);
            WaterViewEnvironment->UpdateResourceImmediate(true);
            auto* Owner=GetWorld()->SpawnActor<AActor>();
            WaterViewCapture=NewObject<USceneCaptureComponentCube>(Owner);
            Owner->SetRootComponent(WaterViewCapture);
            WaterViewCapture->TextureTarget=WaterViewEnvironment;
            WaterViewCapture->bCaptureEveryFrame=false;WaterViewCapture->bCaptureOnMovement=false;
            WaterViewCapture->CaptureSource=ESceneCaptureSource::SCS_SceneColorHDR;
            WaterViewCapture->LODDistanceFactor=2;
            WaterViewCapture->ShowFlags.SetPostProcessing(false);
            WaterViewCapture->ShowFlags.SetTemporalAA(false);
            // Cloud history is view-dependent and leaves cube-face seams.
            // Screen refraction retains clouds; the fallback captures the
            // continuous atmosphere and submerged geometry only.
            WaterViewCapture->ShowFlags.SetCloud(false);
            WaterViewCapture->RegisterComponent();
            UnderwaterMaterial->SetTextureParameterValue(TEXT("UnderwaterEnvironment"),WaterViewEnvironment);
        }
        const double Now=GetWorld()->GetTimeSeconds(),Age=Now-EnvironmentCapturedAt;
        if(Age>10||(Age>2&&FVector::DistSquared(Camera,EnvironmentPosition)>FMath::Square(1600.))){
            FVector CapturePosition=Camera;
            CapturePosition.Z=FMath::Min(Camera.Z,Water.Z*100.-FMath::Min(20.,Water.X*50.));
            WaterViewCapture->SetWorldLocation(CapturePosition);
            WaterViewCapture->CaptureScene();
            EnvironmentPosition=Camera;EnvironmentCapturedAt=Now;++EnvironmentCaptures;
            UnderwaterMaterial->SetScalarParameterValue(TEXT("EnvironmentReady"),1);
        }
    }
}
