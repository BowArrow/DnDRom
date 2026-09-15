#include "DnDRomGameMode.h"
#include "Engine/PostProcessVolume.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "EngineUtils.h"
#include "Engine/DirectionalLight.h"
#include "Components/LightComponent.h"
#include "Dom/JsonObject.h"
void ADnDRomPlayerController::SetWorldReveal(const TSharedPtr<FJsonObject>& Input)
{
    FString UpdateIdentity;
    if(Input->TryGetStringField(TEXT("revealIdentity"),UpdateIdentity)&&UpdateIdentity!=RevealIdentity)return;
    bool Enabled=bRevealEnabled;Input->TryGetBoolField(TEXT("enabled"),Enabled);
    if(!Enabled){bRevealEnabled=false;RevealOpacity=0;if(RevealVolume)RevealVolume->BlendWeight=0;return;}
    FString Identity;Input->TryGetStringField(TEXT("identity"),Identity);
    if(!Identity.IsEmpty()&&Identity!=RevealIdentity){RevealIdentity=Identity;RevealRadius=0;RevealTarget=0;RevealTime=0;bRevealComplete=false;RevealOpacity=1;}
    bRevealEnabled=true;
    bool Complete=false;if(Input->TryGetBoolField(TEXT("revealComplete"),Complete)&&Complete)bRevealComplete=true;
    double Radius=0;if(Input->TryGetNumberField(TEXT("revealRadius"),Radius))RevealTarget=FMath::Max(RevealTarget,float(FMath::Clamp(Radius,0.,200000.)));
    if(!RevealMaterial){auto* Base=LoadObject<UMaterialInterface>(nullptr,TEXT("/Game/DnDRom/Materials/M_world_reveal.M_world_reveal"));if(!Base)return;RevealMaterial=UMaterialInstanceDynamic::Create(Base,this);RevealVolume=GetWorld()->SpawnActor<APostProcessVolume>();RevealVolume->bUnbound=true;RevealVolume->Priority=45;RevealVolume->Settings.AddBlendable(RevealMaterial,1.f);}
    RevealVolume->BlendWeight=RevealOpacity>0?1:0;
}
void ADnDRomPlayerController::TickWorldReveal(float DeltaSeconds)
{
    if(!RevealMaterial||!RevealVolume||RevealVolume->BlendWeight==0)return;
    RevealTime+=DeltaSeconds;
    RevealRadius=FMath::Min(RevealTarget,RevealRadius+DeltaSeconds*FMath::Max(40.f,RevealRadius*(bRevealComplete?2.f:.4f)));
    if(bRevealComplete)RevealOpacity=FMath::Max(0.f,RevealOpacity-DeltaSeconds/2.5f);
    RevealMaterial->SetScalarParameterValue(TEXT("RevealOpacity"),RevealOpacity);
    if(RevealOpacity==0){RevealVolume->BlendWeight=0;return;}
    RevealMaterial->SetScalarParameterValue(TEXT("RevealRadius"),RevealRadius);
    RevealMaterial->SetScalarParameterValue(TEXT("RevealTime"),RevealTime);
    float Irradiance=0;for(TActorIterator<ADirectionalLight> It(GetWorld());It;++It)if(auto* Light=It->GetLightComponent())Irradiance=FMath::Max(Irradiance,Light->Intensity*FMath::Clamp(-It->GetActorForwardVector().Z,0.f,1.f));
    RevealMaterial->SetScalarParameterValue(TEXT("FogRadiance"),20.f+Irradiance*.08f);
}
