#include "DnDRomWaterSubsystem.h"
#include "Dom/JsonObject.h"
#include "Engine/Texture2D.h"
#include "Engine/TextureRenderTarget2D.h"
#include "GameFramework/Actor.h"
#include "Kismet/KismetRenderingLibrary.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Math/Float16Color.h"
#include "TextureResource.h"
#include "Engine/DirectionalLight.h"
#include "Components/LightComponent.h"
#include "EngineUtils.h"
#include "Engine/PostProcessVolume.h"

namespace { constexpr int32 Resolution = 512; constexpr float Span = 256.f, Step = 1.f / 30.f; }

bool UDnDRomWaterSubsystem::ValidateFields(const TSharedPtr<FJsonObject>& Root)
{
    const TArray<TSharedPtr<FJsonValue>>* Array;
    if (!Root->HasField(TEXT("waterFields"))) return true;
    if (!Root->TryGetArrayField(TEXT("waterFields"), Array) || Array->Num() > 256) return false;
    for (const auto& Entry : *Array) {
        const TSharedPtr<FJsonObject>* F; double X, Y, Size, R;
        if (!Entry->TryGetObject(F) || !(*F)->TryGetNumberField(TEXT("originX"), X) || !(*F)->TryGetNumberField(TEXT("originZ"), Y) || !(*F)->TryGetNumberField(TEXT("size"), Size) || !(*F)->TryGetNumberField(TEXT("resolution"), R)) return false;
        if (!FMath::IsFinite(X) || !FMath::IsFinite(Y) || FMath::Abs(X)>1.e8 || FMath::Abs(Y)>1.e8 || !FMath::IsFinite(Size) || Size<=0 || Size>16384 || !FMath::IsFinite(R) || R<1 || R>64 || R!=FMath::FloorToDouble(R)) return false;
        for (const TCHAR* Key : {TEXT("depths"), TEXT("distances"), TEXT("heights")}) {
            const TArray<TSharedPtr<FJsonValue>>* Values;
            if (!(*F)->TryGetArrayField(Key, Values) || Values->Num()!=(int32(R)+1)*(int32(R)+1)) return false;
            for (const auto& V : *Values) { double N; if (!V->TryGetNumber(N) || !FMath::IsFinite(N) || FMath::Abs(N)>60000) return false; }
        }
    }
    return true;
}

void UDnDRomWaterSubsystem::RegisterFields(AActor* Owner, const TSharedPtr<FJsonObject>& Root)
{
    Fields.RemoveAll([Owner](const FField& F) { return !F.Owner.IsValid() || F.Owner==Owner; });
    const TArray<TSharedPtr<FJsonValue>>* Array;
    if (!ValidateFields(Root) || !Root->TryGetArrayField(TEXT("waterFields"), Array)) return;
    for (const auto& Entry : *Array) {
        if (Fields.Num() >= 1024) break;
        const auto Json = Entry->AsObject(); FField F;
        F.Owner=Owner; F.X=Json->GetNumberField(TEXT("originX")); F.Y=Json->GetNumberField(TEXT("originZ")); F.Size=Json->GetNumberField(TEXT("size")); F.Resolution=Json->GetIntegerField(TEXT("resolution"));
        const auto& D=Json->GetArrayField(TEXT("depths")); const auto& S=Json->GetArrayField(TEXT("distances")); const auto& H=Json->GetArrayField(TEXT("heights"));
        F.Values.Reserve(D.Num());
        for (int32 I=0; I<D.Num(); ++I) F.Values.Add(FVector3f(D[I]->AsNumber(),S[I]->AsNumber(),H[I]->AsNumber()));
        Fields.Add(MoveTemp(F));
    }
    bDirty=true;
}

bool UDnDRomWaterSubsystem::InitializeResources()
{
    if (WaterMaterial) return true;
    auto* W=LoadObject<UMaterialInterface>(nullptr,TEXT("/Game/DnDRom/Materials/M_water.M_water"));
    auto* U=LoadObject<UMaterialInterface>(nullptr,TEXT("/Game/DnDRom/Materials/M_foam_update.M_foam_update"));
    auto* G=LoadObject<UMaterialInterface>(nullptr,TEXT("/Game/DnDRom/Materials/M_terrain.M_terrain"));
    if (!W || !U || !G) return false;
    WaterMaterial=UMaterialInstanceDynamic::Create(W,this); UpdateMaterial=UMaterialInstanceDynamic::Create(U,this); GroundMaterial=UMaterialInstanceDynamic::Create(G,this);
    if(auto* M=LoadObject<UMaterialInterface>(nullptr,TEXT("/Game/DnDRom/Materials/M_underwater.M_underwater"))){
        UnderwaterMaterial=UMaterialInstanceDynamic::Create(M,this);
        UnderwaterVolume=GetWorld()->SpawnActor<APostProcessVolume>();
        UnderwaterVolume->bUnbound=true;UnderwaterVolume->Priority=50;UnderwaterVolume->BlendWeight=0;
        UnderwaterVolume->Settings.AddBlendable(UnderwaterMaterial,1.f);
    }
    Info=UTexture2D::CreateTransient(Resolution,Resolution,PF_FloatRGBA);
    Info->SRGB=false; Info->Filter=TF_Bilinear; Info->AddressX=TA_Clamp; Info->AddressY=TA_Clamp;
    Info->NeverStream=true; Info->UpdateResource();
    for (int32 I=0; I<2; ++I) History[I]=UKismetRenderingLibrary::CreateRenderTarget2D(this,Resolution,Resolution,RTF_RG16f,FLinearColor::Black);
    Bind(WaterMaterial); Bind(GroundMaterial); Bind(UpdateMaterial);
    return true;
}

UMaterialInstanceDynamic* UDnDRomWaterSubsystem::Material(bool Terrain)
{
    return InitializeResources() ? (Terrain ? GroundMaterial.Get() : WaterMaterial.Get()) : nullptr;
}

void UDnDRomWaterSubsystem::Bind(UMaterialInstanceDynamic* Target)
{
    if (!Target) return;
    Target->SetTextureParameterValue(TEXT("CoastalInfo"),Info);
    Target->SetTextureParameterValue(TEXT("FoamState"),History[ReadIndex]);
    Target->SetVectorParameterValue(TEXT("WaterWindow"),FLinearColor(Origin.X,Origin.Y,Span,bReady?1.f:0.f));
    Target->SetScalarParameterValue(TEXT("WaveTime"),SimTime);
    Target->SetScalarParameterValue(TEXT("WaterReady"),bReady?1.f:0.f);
    Target->SetVectorParameterValue(TEXT("WaterWind"),FLinearColor(Wind.X,Wind.Y,Wind.Z,0));
    Target->SetScalarParameterValue(TEXT("CoastalSediment"),CoastalSediment);
}

void UDnDRomWaterSubsystem::SetWind(float Speed,float Direction)
{
    if(!FMath::IsFinite(Speed)||!FMath::IsFinite(Direction))return;
    const float Angle=FMath::DegreesToRadians(FMath::Fmod(Direction,360.f));
    // Bound displacement to the coastal mesh's run-up allowance. Storm-scale
    // ocean breakers require separate geometry, not unbounded shader offsets.
    TargetWind=FVector(FMath::Cos(Angle),FMath::Sin(Angle),FMath::Clamp(FMath::Sqrt(FMath::Clamp(Speed,0.f,40.f)/3.f),0.f,1.1f));
}

void UDnDRomWaterSubsystem::RefreshField(const FVector2D& NextOrigin)
{
    const double Start=FPlatformTime::Seconds();
    if (bReady && !Origin.Equals(NextOrigin)) ++Reprojections;
    Origin=NextOrigin;
    auto* Pixels=new FFloat16Color[Resolution*Resolution];
    for (int32 I=0; I<Resolution*Resolution; ++I) Pixels[I]=FFloat16Color(FLinearColor(32,24,0,0));
    TArray<const FField*> Active;
    for (const auto& F : Fields) if (F.Owner.IsValid() && !F.Owner->IsHidden() && F.X<Origin.X+Span && F.Y<Origin.Y+Span && F.X+F.Size>Origin.X && F.Y+F.Size>Origin.Y) Active.Add(&F);
    // Fine authoritative samples overwrite coarse fields. Equal-resolution
    // tiles do not overlap except at their shared edge (pixel centers exclude it).
    Active.StableSort([](const FField& A,const FField& B) { return A.Size/A.Resolution>B.Size/B.Resolution; });
    for (const auto* F : Active) {
        const int32 X0=FMath::Clamp(FMath::CeilToInt((F->X-Origin.X)*Resolution/Span-.5),0,Resolution),Y0=FMath::Clamp(FMath::CeilToInt((F->Y-Origin.Y)*Resolution/Span-.5),0,Resolution);
        const int32 X1=FMath::Clamp(FMath::CeilToInt((F->X+F->Size-Origin.X)*Resolution/Span-.5),0,Resolution),Y1=FMath::Clamp(FMath::CeilToInt((F->Y+F->Size-Origin.Y)*Resolution/Span-.5),0,Resolution);
        for (int32 Y=Y0;Y<Y1;++Y) for (int32 X=X0;X<X1;++X) {
            const double U=(Origin.X+(X+.5)*Span/Resolution-F->X)/F->Size*F->Resolution,V=(Origin.Y+(Y+.5)*Span/Resolution-F->Y)/F->Size*F->Resolution;
            const int32 IX=FMath::Clamp(FMath::FloorToInt(U),0,F->Resolution-1),IY=FMath::Clamp(FMath::FloorToInt(V),0,F->Resolution-1),I=IY*(F->Resolution+1)+IX;
            const float FX=FMath::Clamp(U-IX,0.,1.),FY=FMath::Clamp(V-IY,0.,1.);
            const auto A=F->Values[I],B=F->Values[I+1],C=F->Values[I+F->Resolution+1],D=F->Values[I+F->Resolution+2];
            const FVector3f Value=FX+FY<=1?A+(B-A)*FX+(C-A)*FY:D*(FX+FY-1)+B*(1-FY)+C*(1-FX);
            Pixels[Y*Resolution+X]=FFloat16Color(FLinearColor(Value.X,Value.Y,Value.Z,1));
        }
    }
    auto* Region=new FUpdateTextureRegion2D(0,0,0,0,Resolution,Resolution);
    Info->UpdateTextureRegions(0,1,Region,Resolution*sizeof(FFloat16Color),sizeof(FFloat16Color),reinterpret_cast<uint8*>(Pixels),[](uint8* Data,const FUpdateTextureRegion2D* Regions){ delete[] reinterpret_cast<FFloat16Color*>(Data); delete Regions; });
    bReady=true; bDirty=false; RefreshAge=0; ++FieldUploads; LastFieldMilliseconds=(FPlatformTime::Seconds()-Start)*1000;
}

void UDnDRomWaterSubsystem::Advance(float DeltaSeconds,const FVector& Focus)
{
    if (!WaterMaterial) return;
    Wind=FMath::VInterpTo(Wind,TargetWind,DeltaSeconds,.7f);
    Fields.RemoveAll([](const FField& F){return !F.Owner.IsValid();});
    uint32 Signature=0;
    for (const auto& F : Fields) if (!F.Owner->IsHidden()) Signature=HashCombineFast(Signature,F.Owner->GetUniqueID());
    bDirty|=Signature!=FieldSignature; FieldSignature=Signature;
    const FVector Center=bUnderwater?ViewPosition:Focus;
    const FVector2D NextOrigin(FMath::FloorToDouble((Center.X*.01-Span*.5)/32)*32,FMath::FloorToDouble((Center.Y*.01-Span*.5)/32)*32);
    RefreshAge+=DeltaSeconds;
    if (!bReady || !Origin.Equals(NextOrigin) || (bDirty && RefreshAge>.25)) RefreshField(NextOrigin);
    Accumulator=FMath::Min(Accumulator+DeltaSeconds,Step*3); // bounded stall recovery
    while (Accumulator>=Step) {
        SimTime+=Step; Accumulator-=Step;
        Bind(UpdateMaterial);
        UpdateMaterial->SetVectorParameterValue(TEXT("PreviousWindow"),FLinearColor(HistoryOrigin.X,HistoryOrigin.Y,Span,Steps?1.f:0.f));
        UpdateMaterial->SetScalarParameterValue(TEXT("DeltaTime"),Step);
        UpdateMaterial->SetScalarParameterValue(TEXT("FoamEmission"),Emission);
        UpdateMaterial->SetScalarParameterValue(TEXT("HistoryReady"),Steps?1.f:0.f);
        UKismetRenderingLibrary::DrawMaterialToRenderTarget(this,History[1-ReadIndex],UpdateMaterial);
        ReadIndex=1-ReadIndex; HistoryOrigin=Origin; ++Steps;
    }
    Bind(WaterMaterial); Bind(GroundMaterial);
    float Sun=0,Irradiance=0;
    for(TActorIterator<ADirectionalLight> It(GetWorld());It;++It) if(auto* Light=It->GetLightComponent()){
        const float Elevation=FMath::Clamp(float(-It->GetActorForwardVector().Z),0.f,1.f);
        Sun=FMath::Max(Sun,FMath::Clamp(Light->Intensity/10000.f,0.f,1.f)*Elevation);
        Irradiance=FMath::Max(Irradiance,Light->Intensity*Elevation);
    }
    WaterMaterial->SetScalarParameterValue(TEXT("SunStrength"),Sun);
    Bind(UnderwaterMaterial);
    if(UnderwaterMaterial){UnderwaterMaterial->SetScalarParameterValue(TEXT("SunStrength"),Sun);UnderwaterMaterial->SetScalarParameterValue(TEXT("WaterRadiance"),20.f+Irradiance*.1f);}
}

void UDnDRomWaterSubsystem::Reset()
{
    EnvironmentCapturedAt=-100;
    if(UnderwaterMaterial)UnderwaterMaterial->SetScalarParameterValue(TEXT("EnvironmentReady"),0);
    bDirty=true; bReady=false; Steps=0; Accumulator=0; Emission=1;
    if (WaterMaterial) for (auto& H : History) UKismetRenderingLibrary::ClearRenderTarget2D(this,H,FLinearColor::Black);
}

TSharedPtr<FJsonObject> UDnDRomWaterSubsystem::Diagnostics(bool Readback) const
{
    auto R=MakeShared<FJsonObject>();
    R->SetNumberField(TEXT("steps"),Steps); R->SetNumberField(TEXT("fields"),Fields.Num()); R->SetNumberField(TEXT("uploads"),FieldUploads);
    R->SetNumberField(TEXT("reprojections"),Reprojections); R->SetNumberField(TEXT("fieldMilliseconds"),LastFieldMilliseconds);
    R->SetNumberField(TEXT("time"),SimTime); R->SetNumberField(TEXT("originX"),Origin.X); R->SetNumberField(TEXT("originZ"),Origin.Y);
    R->SetNumberField(TEXT("textureBytes"),Resolution*Resolution*(8+4*2)); R->SetBoolField(TEXT("ready"),bReady);
    R->SetNumberField(TEXT("windStrength"),Wind.Z);
    R->SetBoolField(TEXT("underwater"),bUnderwater);R->SetNumberField(TEXT("cameraDepth"),ViewDepth);
    R->SetBoolField(TEXT("underwaterMaterial"),UnderwaterMaterial!=nullptr);
    R->SetNumberField(TEXT("environmentCaptures"),EnvironmentCaptures);
    R->SetNumberField(TEXT("environmentTextureBytes"),WaterViewEnvironment?128*128*6*8:0);
    if (Readback && History[ReadIndex]) {
        TArray<FLinearColor> Pixels;
        if (History[ReadIndex]->GameThread_GetRenderTargetResource()->ReadLinearColorPixels(Pixels)) {
            double Sum=0,Wet=0,MX=0,MY=0;float Maximum=0;
            for(int32 I=0;I<Pixels.Num();++I){const auto P=Pixels[I];Sum+=P.R;Wet+=P.G;Maximum=FMath::Max(Maximum,P.R);MX+=P.R*(Origin.X+(I%Resolution+.5)*Span/Resolution);MY+=P.R*(Origin.Y+(I/Resolution+.5)*Span/Resolution);}
            R->SetNumberField(TEXT("foamSum"),Sum); R->SetNumberField(TEXT("foamMax"),Maximum); R->SetNumberField(TEXT("wetSum"),Wet);
            if(Sum>0){R->SetNumberField(TEXT("foamCenterX"),MX/Sum);R->SetNumberField(TEXT("foamCenterZ"),MY/Sum);}
        }
    }
    return R;
}
