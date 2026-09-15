#include "DnDRomGameMode.h"
#include "DnDRomSceneActor.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Engine/World.h"
#include "Engine/GameViewportClient.h"
#include "DrawDebugHelpers.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"

namespace {
FVector ReadVector(const TSharedPtr<FJsonObject>& O,const TCHAR* Key,FVector Default=FVector::ZeroVector){
 const TSharedPtr<FJsonObject>* P;double X,Y,Z;
 if(!O->TryGetObjectField(Key,P)||!(*P)->TryGetNumberField(TEXT("x"),X)||!(*P)->TryGetNumberField(TEXT("y"),Y)||!(*P)->TryGetNumberField(TEXT("z"),Z)||!FMath::IsFinite(X+Y+Z))return Default;
 return FVector(X,Z,Y);
}
FTransform ReadTransform(const TSharedPtr<FJsonObject>& O){
 const auto R=ReadVector(O,TEXT("rotation"))*PI/180.;
 return FTransform(FQuat(FVector::RightVector,-R.Y)*FQuat(FVector::UpVector,-R.Z)*FQuat(FVector::ForwardVector,-R.X),ReadVector(O,TEXT("position"))*100,ReadVector(O,TEXT("scale"),FVector::OneVector).ComponentMax(FVector(.001)));
}
}
FString ADnDRomPlayerController::AppEditor(const TSharedPtr<FJsonObject>& Input)
{
 FString Kind;Input->TryGetStringField(TEXT("kind"),Kind);
 if(Kind==TEXT("entities")){
  FString Identity;Input->TryGetStringField(TEXT("streamId"),Identity);
  if(!Scene||Identity!=Scene->StreamIdentity)return TEXT("{\"error\":\"Stale scene edit\"}");
  const TArray<TSharedPtr<FJsonValue>>* Values;
  if(Input->TryGetArrayField(TEXT("remove"),Values))for(const auto& Value:*Values){
   const FString Id=Value->AsString(),Key=TEXT("edit:")+Id;Scene->RemoveEntity(Id);
   for(const auto& Entry:WorldTiles)Entry.Value->RemoveEntity(Id);
   if(auto* Pending=PendingWorldTiles.Find(Key))(*Pending)->Destroy();PendingWorldTiles.Remove(Key);
   if(auto* Existing=WorldTiles.Find(Key))(*Existing)->Destroy();WorldTiles.Remove(Key);
  }
  if(Input->TryGetArrayField(TEXT("transforms"),Values))for(const auto& Value:*Values){
   const auto O=Value->AsObject();const TSharedPtr<FJsonObject> *Before,*After;FString Id;
   if(!O||!O->TryGetStringField(TEXT("id"),Id)||!O->TryGetObjectField(TEXT("before"),Before)||!O->TryGetObjectField(TEXT("after"),After))continue;
   const auto B=ReadTransform(*After);
   const auto A=EditorPreviews.Contains(Id)?EditorPreviews[Id]:ReadTransform(*Before);
   bool Preview=false;Input->TryGetBoolField(TEXT("preview"),Preview);
   if(Preview)EditorPreviews.Add(Id,B);else EditorPreviews.Remove(Id);
   if(Id==EditorEntity)EditorPosition=B.GetLocation();
   Scene->TransformEntity(Id,A,B);
   for(const auto& Entry:WorldTiles)Entry.Value->TransformEntity(Id,A,B);
  }
  return TEXT("{}");
 }
 Input->TryGetBoolField(TEXT("grid"),bEditorGrid);
 double Spacing=1;Input->TryGetNumberField(TEXT("gridSize"),Spacing);EditorGridSize=FMath::Clamp(Spacing,.1,100.);
 Input->TryGetStringField(TEXT("gridShape"),EditorGridShape);
 FVector2D Size;GetWorld()->GetGameViewport()->GetViewportSize(Size);
 FString Selected;Input->TryGetStringField(TEXT("entityId"),Selected);EditorEntity=Selected;
 Input->TryGetStringField(TEXT("tool"),EditorTool);
 if(!EditorPreviews.Contains(EditorEntity))EditorPosition=ReadVector(Input,TEXT("position"))*100;
 const auto P=EditorPosition;
 const double Length=FMath::Clamp(FVector::Distance(P,GetPawn()->GetActorLocation())*.12,40.,100000.);
 const auto Project=[&](FVector V){FVector2D S;const bool Valid=ProjectWorldLocationToScreen(V,S,false);auto O=MakeShared<FJsonObject>();O->SetBoolField(TEXT("visible"),Valid);O->SetNumberField(TEXT("x"),S.X/FMath::Max(1.,Size.X));O->SetNumberField(TEXT("y"),S.Y/FMath::Max(1.,Size.Y));return MakeShared<FJsonValueObject>(O);};
 auto Result=MakeShared<FJsonObject>();Result->SetField(TEXT("origin"),Project(P));Result->SetNumberField(TEXT("length"),Length/100);
 TArray<TSharedPtr<FJsonValue>> Axes,Rings;
 const FVector Directions[]={FVector::ForwardVector,FVector::UpVector,FVector::RightVector};
 for(int32 Axis=0;Axis<3;Axis++){
  Axes.Add(Project(P+Directions[Axis]*Length));TArray<TSharedPtr<FJsonValue>> Ring;
  for(int32 I=0;I<=48;I++){const double A=I*2*PI/48;Ring.Add(Project(P+(Directions[(Axis+1)%3]*FMath::Cos(A)+Directions[(Axis+2)%3]*FMath::Sin(A))*Length*.8));}
  Rings.Add(MakeShared<FJsonValueArray>(Ring));
 }
 Result->SetArrayField(TEXT("axes"),Axes);Result->SetArrayField(TEXT("rings"),Rings);Result->SetBoolField(TEXT("grid"),bEditorGrid);Result->SetNumberField(TEXT("gridSegments"),EditorGridLines.Num()/2);
 FString Json;FJsonSerializer::Serialize(Result,TJsonWriterFactory<>::Create(&Json));return Json;
}
void ADnDRomPlayerController::TickEditor()
{
 if(!Scene)return;
 if(!bEditorGrid)return;
 const double Step=EditorGridSize*100;
 FVector Focus=CameraPivot;
 // Fly navigation can leave the orbit pivot beyond the visible ground. Place
 // the overlay beneath the view, keeping its sampling on a bounded cadence.
 if(GetWorld()->TimeSeconds-EditorGridBuiltAt>2&&GetPawn()){
  double Distance=10000000;FVector Hit;
  if(Scene->GroundRayHit(GetPawn()->GetActorLocation(),GetControlRotation().Vector(),Distance,Hit))Focus=Hit;
  for(const auto& Entry:WorldTiles)if(Entry.Value->GroundRayHit(GetPawn()->GetActorLocation(),GetControlRotation().Vector(),Distance,Hit))Focus=Hit;
 }else if(EditorGridBuiltAt>=0)Focus=EditorGridCenter;
 const FVector Center(FMath::GridSnap(Focus.X,Step),FMath::GridSnap(Focus.Y,Step),0);
 if(!Center.Equals(EditorGridCenter,Step*.5)||GetWorld()->TimeSeconds-EditorGridBuiltAt>2){
  EditorGridCenter=Center;EditorGridBuiltAt=GetWorld()->TimeSeconds;EditorGridLines.Reset();
  const auto Ground=[&](FVector P){double H=0;if(!Scene->GroundHeightAt(FVector2D(P),H))for(const auto& Entry:WorldTiles)if(Entry.Value->GroundHeightAt(FVector2D(P),H))break;P.Z=H+5;return P;};
  // Bounded local overlay; no meshes, collision cooking or terrain reimports.
  if(EditorGridShape==TEXT("hex")){
   for(int32 X=-8;X<=8;X++)for(int32 Y=-8;Y<=8;Y++){
    const FVector C=Center+FVector(X*Step*1.5,(Y+(X&1)*.5)*Step*FMath::Sqrt(3.),0);
    for(int32 I=0;I<3;I++){const double A=I*PI/3,B=(I+1)*PI/3;EditorGridLines.Add(Ground(C+FVector(FMath::Cos(A),FMath::Sin(A),0)*Step));EditorGridLines.Add(Ground(C+FVector(FMath::Cos(B),FMath::Sin(B),0)*Step));}
   }
  }else{
   FVector Nodes[21][21];for(int32 X=0;X<=20;X++)for(int32 Y=0;Y<=20;Y++)Nodes[X][Y]=Ground(Center+FVector((X-10)*Step,(Y-10)*Step,0));
   for(int32 X=0;X<=20;X++)for(int32 Y=0;Y<=20;Y++){if(X<20){EditorGridLines.Add(Nodes[X][Y]);EditorGridLines.Add(Nodes[X+1][Y]);}if(Y<20){EditorGridLines.Add(Nodes[X][Y]);EditorGridLines.Add(Nodes[X][Y+1]);}}
  }
 }
 for(int32 I=0;I<EditorGridLines.Num();I+=2)DrawDebugLine(GetWorld(),EditorGridLines[I],EditorGridLines[I+1],FColor(220,211,158,130),false,0,0,1.4);
}

void ADnDRomEditorHUD::DrawHUD(){Super::DrawHUD();if(auto* P=Cast<ADnDRomPlayerController>(GetOwningPlayerController()))P->DrawEditorHUD(Canvas);}
void ADnDRomPlayerController::DrawEditorHUD(UCanvas* Canvas)
{
 if(!Canvas||EditorEntity.IsEmpty()||!GetPawn())return;
 const auto P=EditorPosition;FVector2D O;if(!ProjectWorldLocationToScreen(P,O,false))return;
 const double L=FMath::Clamp(FVector::Distance(P,GetPawn()->GetActorLocation())*.12,40.,100000.);
 const FVector D[]={FVector::ForwardVector,FVector::UpVector,FVector::RightVector};
 const FLinearColor C[]={FLinearColor(1,.22,.22,1),FLinearColor(.25,.9,.4,1),FLinearColor(.25,.55,1,1)};
 const auto Line=[&](FVector2D A,FVector2D B,FLinearColor Color,float Width){Canvas->K2_DrawLine(A,B,Width+2,FLinearColor(.025,.025,.025,1));Canvas->K2_DrawLine(A,B,Width,Color);};
 const auto Tri=[&](FVector2D A,FVector2D B,FVector2D E,FLinearColor Color){FCanvasUVTri T;T.V0_Pos=A;T.V1_Pos=B;T.V2_Pos=E;T.V0_Color=T.V1_Color=T.V2_Color=Color;Canvas->K2_DrawTriangle(nullptr,{T});};
 for(int32 A=0;A<3;A++){
  if(EditorTool==TEXT("rotate")){
   for(int32 I=0;I<64;I++){const double U=I*2*PI/64,V=(I+1)*2*PI/64;FVector2D S,E;
    if(ProjectWorldLocationToScreen(P+(D[(A+1)%3]*FMath::Cos(U)+D[(A+2)%3]*FMath::Sin(U))*L*.8,S,false)&&ProjectWorldLocationToScreen(P+(D[(A+1)%3]*FMath::Cos(V)+D[(A+2)%3]*FMath::Sin(V))*L*.8,E,false))Line(S,E,C[A],3);}
  }else{
   FVector2D E;if(!ProjectWorldLocationToScreen(P+D[A]*L,E,false))continue;
   Line(O,E,C[A],3);
   if(EditorTool==TEXT("scale"))Canvas->K2_DrawPolygon(nullptr,E,FVector2D(8,8),4,C[A]);
   else{
    const auto U=(E-O).GetSafeNormal(),V=FVector2D(-U.Y,U.X);Tri(E,E-U*16+V*6,E-U*16-V*6,C[A]);
    FVector2D Q[4];const auto X=D[A],Y=D[(A+1)%3];const FVector W[]={P+(X+Y)*L*.22,P+(X*.42+Y*.22)*L,P+(X+Y)*L*.42,P+(X*.22+Y*.42)*L};bool Visible=true;
    for(int32 I=0;I<4;I++)Visible&=ProjectWorldLocationToScreen(W[I],Q[I],false);
    if(Visible){auto Fill=C[(A+2)%3];Fill.A=.25;Tri(Q[0],Q[1],Q[2],Fill);Tri(Q[0],Q[2],Q[3],Fill);for(int32 I=0;I<4;I++)Line(Q[I],Q[(I+1)%4],C[(A+2)%3],1.5);}
   }
  }
 }
 Canvas->K2_DrawPolygon(nullptr,O,FVector2D(7,7),16,FLinearColor(1,.83,.4,1));
}
