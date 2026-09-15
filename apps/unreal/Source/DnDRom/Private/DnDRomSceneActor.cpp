#include "DnDRomSceneActor.h"
#include "ProceduralMeshComponent.h"
#include "DnDRomGameMode.h"
#include "DnDRomWaterSubsystem.h"
#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "StaticMeshResources.h"
#include "StaticMeshAttributes.h"
#include "MeshDescription.h"
#include "PhysicsEngine/BodySetup.h"
#include "Materials/MaterialInterface.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Misc/FileHelper.h"
#include "HAL/FileManager.h"
#include "Misc/SecureHash.h"

namespace
{
    // Weak entries share GPU buffers while live tile components own the meshes.
    // Content hashes include geometry, LODs, material and collision flags.
    TMap<FString, TWeakObjectPtr<UStaticMesh>> PrototypeMeshes;
    struct FPrototypeDefinition { TSharedPtr<FJsonObject> Json; int32 Bytes = 0; };
    TMap<FString, FPrototypeDefinition> PrototypeDefinitions;
    TArray<FString> PrototypeDefinitionOrder;
    int32 PrototypeDefinitionBytes = 0;
    bool IsStreamPrototype(const FString& Id) { return Id.StartsWith(TEXT("native-tree-v2/")) || Id.StartsWith(TEXT("native-crown-v3-")); }
    uint64 ImportBudgetFrame = MAX_uint64;
    double ImportDeadline = 0;
    constexpr int64 MaxFileBytes = 128ll * 1024 * 1024;
    bool Numbers(const TSharedPtr<FJsonObject>& Object, const TCHAR* Key, int32 Width, int32 Max, const TArray<TSharedPtr<FJsonValue>>*& Out)
    {
        if (!Object->TryGetArrayField(Key, Out) || Out->Num() > Max || Out->Num() % Width) return false;
        for (const auto& Item : *Out) { double Value; if (!Item->TryGetNumber(Value) || !FMath::IsFinite(Value) || FMath::Abs(Value) > 1.e12) return false; }
        return true;
    }
    bool Vector(const TSharedPtr<FJsonObject>& Object, const TCHAR* Key, FVector& Out)
    {
        const TSharedPtr<FJsonObject>* V;
        double X, Y, Z;
        if (!Object->TryGetObjectField(Key, V) || !(*V)->TryGetNumberField(TEXT("x"), X) || !(*V)->TryGetNumberField(TEXT("y"), Y) || !(*V)->TryGetNumberField(TEXT("z"), Z)) return false;
        Out = FVector(X, Z, Y);
        return !Out.ContainsNaN() && Out.GetAbsMax() < 1.e10;
    }
    double At(const TArray<TSharedPtr<FJsonValue>>& Values, int32 I) { return Values[I]->AsNumber(); }
    bool Validate(const TSharedPtr<FJsonObject>& Root, FString& Error)
    {
        if (!UDnDRomWaterSubsystem::ValidateFields(Root)) { Error=TEXT("Invalid coastal water field"); return false; }
        FString Format, Coordinates; double Version;
        const TArray<TSharedPtr<FJsonValue>>* Meshes; const TArray<TSharedPtr<FJsonValue>>* Instances;
        if (!Root->TryGetStringField(TEXT("format"), Format) || Format != TEXT("dndrom.scene") || !Root->TryGetNumberField(TEXT("version"), Version) || Version != 1 || !Root->TryGetStringField(TEXT("coordinates"), Coordinates) || Coordinates != TEXT("right-handed-y-up-metres") || !Root->TryGetArrayField(TEXT("meshes"), Meshes) || !Root->TryGetArrayField(TEXT("instances"), Instances))
        { Error = TEXT("Unsupported DnDRom scene format"); return false; }
        if (Meshes->Num() > 20000 || Instances->Num() > 1000000) { Error = TEXT("Scene exceeds import budget"); return false; }
        TSet<FString> Ids; int64 Vertices = 0; int64 Triangles = 0;
        for (const auto& Value : *Meshes)
        {
            const TSharedPtr<FJsonObject>* Mesh; FString Id, Material; bool Collision;
            const TArray<TSharedPtr<FJsonValue>>* Lods;
            if (!Value->TryGetObject(Mesh) || !(*Mesh)->TryGetStringField(TEXT("id"), Id) || Id.IsEmpty() || Ids.Contains(Id) || !(*Mesh)->TryGetStringField(TEXT("material"), Material) || !(*Mesh)->TryGetBoolField(TEXT("collision"), Collision) || !(*Mesh)->TryGetArrayField(TEXT("lods"), Lods) || Lods->IsEmpty() || Lods->Num() > 3) return false;
            for (TCHAR Ch : Material) if (!FChar::IsAlnum(Ch) && Ch != TEXT('-')) return false;
            Ids.Add(Id);
            for (const auto& L : *Lods)
            {
                const TSharedPtr<FJsonObject>* Lod;
                const TArray<TSharedPtr<FJsonValue>> *P, *N, *UV, *C, *I;
                if (!L->TryGetObject(Lod) || !Numbers(*Lod, TEXT("positions"), 3, 3000000, P) || !Numbers(*Lod, TEXT("normals"), 3, 3000000, N) || !Numbers(*Lod, TEXT("uvs"), 2, 2000000, UV) || !Numbers(*Lod, TEXT("colors"), 4, 4000000, C) || !Numbers(*Lod, TEXT("indices"), 3, 12000000, I)) return false;
                const int32 Count = P->Num() / 3;
                if ((*Lod)->HasField(TEXT("biomeUVs"))) { const TArray<TSharedPtr<FJsonValue>>* Biome; if (!Numbers(*Lod,TEXT("biomeUVs"),2,2000000,Biome) || Biome->Num()!=Count*2) return false; }
                if (!Count || I->IsEmpty() || N->Num() != P->Num() || UV->Num() != Count * 2 || C->Num() != Count * 4) return false;
                for (const auto& Color : *C) { const double D = Color->AsNumber(); if (D < 0 || D > 255 || D != FMath::FloorToDouble(D)) return false; }
                for (const auto& Index : *I) { const double D = Index->AsNumber(); if (D < 0 || D >= Count || D != FMath::FloorToDouble(D)) return false; }
                Vertices += Count; Triangles += I->Num() / 3;
                if (Vertices > 2000000 || Triangles > 4000000) { Error = TEXT("Scene geometry exceeds import budget; export fewer resident regions"); return false; }
            }
        }
        for (const auto& Value : *Instances)
        {
            const TSharedPtr<FJsonObject>* I; FString Id, Entity; FVector P, S; const TArray<TSharedPtr<FJsonValue>>* Q;
            if (!Value->TryGetObject(I) || !(*I)->TryGetStringField(TEXT("meshId"), Id) || !Ids.Contains(Id) || !(*I)->TryGetStringField(TEXT("entityId"), Entity) || !Vector(*I, TEXT("position"), P) || !Vector(*I, TEXT("scale"), S) || S.GetAbsMin() < .00001 || !Numbers(*I, TEXT("rotation"), 4, 4, Q) || Q->Num() != 4) return false;
            const double Norm = FMath::Square(At(*Q, 0)) + FMath::Square(At(*Q, 1)) + FMath::Square(At(*Q, 2)) + FMath::Square(At(*Q, 3));
            if (FMath::Abs(Norm - 1) > .001) return false;
        }
        return true;
    }
}

ADnDRomSceneActor::ADnDRomSceneActor()
{
    PrimaryActorTick.bCanEverTick = true;
    RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("SceneRoot"));
    Status = TEXT("Export a campaign with Export to Unreal, then open its .dndscene file.");
}

bool ADnDRomSceneActor::LoadScene(const FString& Filename)
{
    const int64 Size = IFileManager::Get().FileSize(*Filename);
    if (Size <= 0 || Size > MaxFileBytes) { Status = TEXT("Scene is missing, empty or larger than the 128 MiB import limit"); return false; }
    FString Text; TSharedPtr<FJsonObject> Incoming;
    if (!FFileHelper::LoadFileToString(Text, *Filename) || !FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), Incoming) || !Incoming.IsValid()) { Status = TEXT("Invalid scene JSON"); return false; }
    // References are expanded only from previously validated, bounded local
    // definitions. The normal full-scene validator still checks every import.
    const TArray<TSharedPtr<FJsonValue>>* IncomingMeshes;
    if (Incoming->TryGetArrayField(TEXT("meshes"), IncomingMeshes)) {
        TArray<TSharedPtr<FJsonValue>> Expanded = *IncomingMeshes;
        for (auto& Value : Expanded) {
            const TSharedPtr<FJsonObject>* Object; FString Reference, Id;
            if (Value->TryGetObject(Object) && (*Object)->TryGetStringField(TEXT("prototypeRef"), Reference)) {
                const auto* Cached = PrototypeDefinitions.Find(Reference);
                if (!Cached || !(*Object)->TryGetStringField(TEXT("id"), Id) || Id != Reference) { Status = TEXT("Missing native prototype; resend its geometry"); return false; }
                Value = MakeShared<FJsonValueObject>(Cached->Json);
            }
        }
        Incoming->SetArrayField(TEXT("meshes"), Expanded);
    }
    FString Error = TEXT("Invalid scene mesh or instance data");
    if (!Validate(Incoming, Error)) { Status = Error; return false; }
    for (const auto& Value : Incoming->GetArrayField(TEXT("meshes"))) {
        const auto Definition = Value->AsObject(); const FString Id = Definition->GetStringField(TEXT("id"));
        if (!IsStreamPrototype(Id) || PrototypeDefinitions.Contains(Id)) continue;
        FString Serialized; FJsonSerializer::Serialize(Definition.ToSharedRef(), TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Serialized));
        const int32 Bytes = Serialized.Len()*sizeof(TCHAR);
        if (Bytes > 4*1024*1024) continue;
        while (!PrototypeDefinitionOrder.IsEmpty() && (PrototypeDefinitionBytes + Bytes > 16*1024*1024 || PrototypeDefinitions.Num() >= 64)) {
            const FString Old = PrototypeDefinitionOrder[0]; PrototypeDefinitionOrder.RemoveAt(0);
            PrototypeDefinitionBytes -= PrototypeDefinitions[Old].Bytes; PrototypeDefinitions.Remove(Old);
        }
        PrototypeDefinitions.Add(Id, {Definition, Bytes}); PrototypeDefinitionOrder.Add(Id); PrototypeDefinitionBytes += Bytes;
    }
    // Validate the complete replacement before removing the displayed scene.
    for (const auto& Group : Groups) if (Group) Group->DestroyComponent();
    for(const auto& Collision:TerrainCollision)if(Collision)Collision->DestroyComponent();TerrainCollision.Empty();
    Groups.Empty(); EntityIds.Empty(); Placements.Empty(); RouteMotions.Empty(); GroundPatches.Empty(); Document = Incoming; Incoming->TryGetStringField(TEXT("replaceEntityId"),ReplaceEntityId); NextMesh = 0; bImportComplete = false;
    GetWorld()->GetSubsystem<UDnDRomWaterSubsystem>()->RegisterFields(this,Incoming);
    VertexColorsChecked = 0; VertexColorMismatches = 0; MeshBuildMilliseconds = 0; MeshesBuilt = 0; PrototypeCacheHits = 0;
    Incoming->TryGetStringField(TEXT("name"), SceneName);
    Incoming->TryGetStringField(TEXT("streamId"), StreamIdentity);
    const TSharedPtr<FJsonObject>* Source;const TSharedPtr<FJsonObject>* Map;
    if(Incoming->TryGetObjectField(TEXT("source"),Source)&&(*Source)->TryGetObjectField(TEXT("map"),Map))(*Map)->TryGetStringField(TEXT("id"),SceneIdentity);
    for (const auto& Value : Document->GetArrayField(TEXT("instances")))
    {
        const auto I = Value->AsObject(); Placements.FindOrAdd(I->GetStringField(TEXT("meshId"))).Add(I);
    }
    const TArray<TSharedPtr<FJsonValue>>* Warnings;
    WarningCount = Document->TryGetArrayField(TEXT("warnings"), Warnings) ? Warnings->Num() : 0;
    const auto& Instances = Document->GetArrayField(TEXT("instances"));
    if (!Instances.IsEmpty()) { Vector(Instances[0]->AsObject(), TEXT("position"), SuggestedCamera); SuggestedCamera *= 100; SuggestedCamera += FVector(-1500, -1500, 1800); }
    Status = TEXT("Building imported sceneÃ¢â‚¬Â¦"); return true;
}

bool ADnDRomSceneActor::BuildMesh(const TSharedPtr<FJsonObject>& Definition)
{
    const double BuildStart = FPlatformTime::Seconds();
    const FString MaterialRole = Definition->GetStringField(TEXT("material"));
    const FString MeshId = Definition->GetStringField(TEXT("id"));
    FString CacheKey;
    UStaticMesh* Mesh = nullptr;
    if (IsStreamPrototype(MeshId) || MeshId.StartsWith(TEXT("tree:")) || MeshId.StartsWith(TEXT("glb-world-forest-")) || MaterialRole == TEXT("grass-blades"))
    {
        FString Serialized; FJsonSerializer::Serialize(Definition.ToSharedRef(), TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Serialized));
        FTCHARToUTF8 Bytes(*Serialized); FSHAHash Hash; FSHA1::HashBuffer(Bytes.Get(), Bytes.Length(), Hash.Hash); CacheKey = Hash.ToString();
        if (auto* Cached = PrototypeMeshes.Find(CacheKey)) Mesh = Cached->Get();
    }
    if (Mesh) ++PrototypeCacheHits;
    else {
    TArray<FMeshDescription> Descriptions;
    double SurfaceArea = 0, UVArea = 0;
    const auto& Lods = Definition->GetArrayField(TEXT("lods")); Descriptions.SetNum(Lods.Num());
    TArray<TArray<FColor>> ExpectedColors; ExpectedColors.SetNum(Lods.Num());
    for (int32 Level = 0; Level < Lods.Num(); ++Level)
    {
        auto& Description = Descriptions[Level]; FStaticMeshAttributes A(Description); A.Register();
        auto Positions = A.GetVertexPositions(); auto Normals = A.GetVertexInstanceNormals(); auto Tangents = A.GetVertexInstanceTangents();
        auto Signs = A.GetVertexInstanceBinormalSigns(); auto UVs = A.GetVertexInstanceUVs(); UVs.SetNumChannels(2); auto Colors = A.GetVertexInstanceColors();
        const FPolygonGroupID Group = Description.CreatePolygonGroup(); A.GetPolygonGroupMaterialSlotNames()[Group] = TEXT("Surface");
        const auto Lod = Lods[Level]->AsObject(); const auto& P = Lod->GetArrayField(TEXT("positions")); const auto& N = Lod->GetArrayField(TEXT("normals"));
        const auto& U = Lod->GetArrayField(TEXT("uvs")); const auto& C = Lod->GetArrayField(TEXT("colors")); const auto& I = Lod->GetArrayField(TEXT("indices"));
        const TArray<TSharedPtr<FJsonValue>>* Biome=nullptr; Lod->TryGetArrayField(TEXT("biomeUVs"),Biome);
        TArray<FVertexID> Vertices;
        for (int32 V = 0; V < P.Num() / 3; ++V)
        { auto Id = Description.CreateVertex(); Vertices.Add(Id); Positions[Id] = FVector3f(At(P, V * 3) * 100, At(P, V * 3 + 2) * 100, At(P, V * 3 + 1) * 100); }
        for (int32 T = 0; T < I.Num(); T += 3)
        {
            TArray<FVertexInstanceID, TInlineAllocator<3>> Corners;
            // The axis reflection converts PlayCanvas CCW to Unreal CW.
            // Preserve index order: reversing again exposes the underside and
            // makes Chaos (which flips triangle normals) miss downward traces.
            for (int32 Corner : { 0, 1, 2 })
            {
                const int32 V = At(I, T + Corner); const auto Id = Description.CreateVertexInstance(Vertices[V]); Corners.Add(Id);
                const FVector3f Normal = FVector3f(At(N, V * 3), At(N, V * 3 + 2), At(N, V * 3 + 1)).GetSafeNormal();
                Normals[Id] = Normal;
                // Tangents are computed from UV gradients below; never use a
                // fixed world axis for bark/roof normal-map orientation.
                UVs.Set(Id, 0, FVector2f(At(U, V * 2), At(U, V * 2 + 1)));
                UVs.Set(Id, 1, Biome?FVector2f(At(*Biome,V*2),At(*Biome,V*2+1)):FVector2f::ZeroVector);
                const FColor Color(At(C, V * 4), At(C, V * 4 + 1), At(C, V * 4 + 2), At(C, V * 4 + 3));
                // Fast static-mesh build encodes mesh-description colors with
                // ToFColor(true), but the vertex shader reads normalized bytes.
                // Decode here so that build preserves our linear albedo/mask bytes.
                Colors[Id] = FVector4f(FLinearColor(Color));
                ExpectedColors[Level].Add(Color);
            }
            const FVector3f E1 = Positions[Description.GetVertexInstanceVertex(Corners[1])] - Positions[Description.GetVertexInstanceVertex(Corners[0])];
            const FVector3f E2 = Positions[Description.GetVertexInstanceVertex(Corners[2])] - Positions[Description.GetVertexInstanceVertex(Corners[0])];
            const FVector2f D1 = UVs.Get(Corners[1], 0) - UVs.Get(Corners[0], 0), D2 = UVs.Get(Corners[2], 0) - UVs.Get(Corners[0], 0);
            const float Det = D1.X * D2.Y - D1.Y * D2.X;
            if (Level == 0 && FMath::Abs(Det) > SMALL_NUMBER) { SurfaceArea += FVector3f::CrossProduct(E1, E2).Length(); UVArea += FMath::Abs(Det); }
            const FVector3f Tangent = FMath::Abs(Det) > SMALL_NUMBER ? (E1 * D2.Y - E2 * D1.Y) / Det : E1;
            const FVector3f B = FMath::Abs(Det) > SMALL_NUMBER ? (E2 * D1.X - E1 * D2.X) / Det : E2;
            for (auto Corner : Corners) { const auto Nrm = Normals[Corner]; const auto Tan = (Tangent - Nrm * FVector3f::DotProduct(Nrm, Tangent)).GetSafeNormal(); Tangents[Corner] = Tan; Signs[Corner] = FVector3f::DotProduct(FVector3f::CrossProduct(Nrm, Tan), B) < 0 ? -1 : 1; }
            Description.CreateTriangle(Group, Corners);
        }
    }
    // Chaos runtime cooking requires the body setup's mesh to resolve a game
    // world. A transient-package outer silently skips runtime triangle cooking.
    Mesh = NewObject<UStaticMesh>(GetWorld());
    Mesh->bAllowCPUAccess = Definition->GetBoolField(TEXT("collision"));
    FString AssetName = MaterialRole; AssetName.ReplaceInline(TEXT("-"), TEXT("_"));
    UMaterialInterface* Material = nullptr;
    if (const auto* Controller = Cast<ADnDRomPlayerController>(GetWorld()->GetFirstPlayerController())) if (auto* Custom = Controller->AppMaterial(MaterialRole)) Material = Custom;
    if (!Material) Material = LoadObject<UMaterialInterface>(nullptr, *FString::Printf(TEXT("/Game/DnDRom/Materials/M_%s.M_%s"), *AssetName, *AssetName));
    if (!Material) { ++WarningCount; UE_LOG(LogTemp, Warning, TEXT("Missing cooked DnDRom material: %s"), *MaterialRole); }
    Mesh->GetStaticMaterials().Add(FStaticMaterial(Material, TEXT("Surface")));
    // Runtime fast builds do not initialize editor-derived UV streaming data.
    Mesh->GetStaticMaterials()[0].UVChannelData = FMeshUVChannelInfo(UVArea > SMALL_NUMBER ? FMath::Sqrt(SurfaceArea / UVArea) : 100.f);
    Mesh->CreateBodySetup(); Mesh->GetBodySetup()->CollisionTraceFlag = CTF_UseComplexAsSimple;
    UStaticMesh::FBuildMeshDescriptionsParams Params; Params.bFastBuild = true; Params.bAllowCpuAccess = true; Params.bBuildSimpleCollision = false; Params.bCommitMeshDescription = false; Params.bMarkPackageDirty = false;
    Params.PerLODOverrides.SetNum(Descriptions.Num());
    for (auto& LodParams : Params.PerLODOverrides) LodParams.bUseFullPrecisionUVs = MaterialRole == TEXT("terrain") || MaterialRole.Contains(TEXT("-aged-"));
    TArray<const FMeshDescription*> Pointers; for (const auto& D : Descriptions) Pointers.Add(&D);
    Mesh->BuildFromMeshDescriptions(Pointers, Params);
    // Fast runtime builds only cook physics when their optional bounding box
    // is requested. Cook the actual triangle surface for terrain and buildings.
    if (Definition->GetBoolField(TEXT("collision"))) Mesh->GetBodySetup()->CreatePhysicsMeshes();
    if (Mesh->GetRenderData()) for (int32 Lod = 0; Lod < Lods.Num(); ++Lod)
    {
        Mesh->GetRenderData()->ScreenSize[Lod].Default = Lod == 0 ? 1.f : Lod == 1 ? .25f : .07f;
        if (MaterialRole == TEXT("forest-crown")) Mesh->GetRenderData()->ScreenSize[Lod].Default = Lod == 0 ? 1.f : Lod == 1 ? .035f : .012f;
        const auto& Buffer = Mesh->GetRenderData()->LODResources[Lod].VertexBuffers.ColorVertexBuffer;
        for (int32 V = 0; V < ExpectedColors[Lod].Num(); ++V)
        {
            const FColor Actual = Buffer.GetNumVertices() == 0 ? FColor::White : Buffer.VertexColor(V);
            ++VertexColorsChecked;
            if (Actual != ExpectedColors[Lod][V]) ++VertexColorMismatches;
        }
    }
    if (!CacheKey.IsEmpty()) {
        if (PrototypeMeshes.Num() >= 256) for (auto It = PrototypeMeshes.CreateIterator(); It; ++It) if (!It.Value().IsValid()) It.RemoveCurrent();
        if (PrototypeMeshes.Num() < 256) PrototypeMeshes.Add(CacheKey, Mesh);
    }
    ++MeshesBuilt;
    }
    auto* Component = NewObject<UHierarchicalInstancedStaticMeshComponent>(this);
    Component->SetupAttachment(RootComponent); Component->SetStaticMesh(Mesh);
    Component->SetCollisionEnabled(MaterialRole!=TEXT("terrain") && Definition->GetBoolField(TEXT("collision")) ? ECollisionEnabled::QueryAndPhysics : ECollisionEnabled::NoCollision);
    Component->SetCollisionResponseToAllChannels(ECR_Block);
    bool CastShadow = true; Definition->TryGetBoolField(TEXT("castShadow"), CastShadow);
    Component->SetCastShadow(CastShadow && MaterialRole != TEXT("water") && MaterialRole != TEXT("grass-blades") && !MaterialRole.StartsWith(TEXT("glb-world-forest-")));
    // Static-mesh instances use supplied conventional LODs. Runtime imported
    // mesh descriptions do not acquire Nanite data by enabling a project flag.
    if (MaterialRole == TEXT("grass-blades")) Component->SetCullDistances(6000, 9000);
    if (MaterialRole == TEXT("settlement-flora")) Component->SetCullDistances(11000, 12000);
    Component->RegisterComponent(); Groups.Add(Component);
    TArray<FTransform> Transforms; TArray<FString> SemanticIds;
    if (const auto* List = Placements.Find(Definition->GetStringField(TEXT("id")))) for (const auto& Instance : *List)
    {
        FVector Position, Scale; Vector(Instance, TEXT("position"), Position); Vector(Instance, TEXT("scale"), Scale);
        const auto& Q = Instance->GetArrayField(TEXT("rotation"));
        Transforms.Add(FTransform(FQuat(-At(Q, 0), -At(Q, 2), -At(Q, 1), At(Q, 3)), Position * 100, Scale));
        if(MaterialRole==TEXT("terrain")&&!Definition->GetStringField(TEXT("id")).EndsWith(TEXT("-skirt"))){
            FGroundPatch Patch; const auto Lod=Definition->GetArrayField(TEXT("lods"))[0]->AsObject();
            const auto& Vertices=Lod->GetArrayField(TEXT("positions"));
            for(int32 I=0;I<Vertices.Num();I+=3){const FVector P=Transforms.Last().TransformPosition(FVector(At(Vertices,I),At(Vertices,I+2),At(Vertices,I+1))*100);Patch.Vertices.Add(P);Patch.Bounds+=P;}
            for(const auto& Index:Lod->GetArrayField(TEXT("indices")))Patch.Indices.Add(int32(Index->AsNumber()));
            GroundPatches.Add(MoveTemp(Patch));
        }
        SemanticIds.Add(Instance->GetStringField(TEXT("entityId")));
        const TSharedPtr<FJsonObject>* Motion;
        if (Instance->TryGetObjectField(TEXT("routeMotion"), Motion))
        {
            FRouteMotion Route; Route.Component=Component; Route.Instance=Transforms.Num()-1; Route.Scale=Scale;
            double Speed=3,Dwell=12; (*Motion)->TryGetNumberField(TEXT("speed"),Speed); (*Motion)->TryGetNumberField(TEXT("dwell"),Dwell);
            Route.Speed=FMath::Clamp(Speed, .1, 20.)*100; Route.Dwell=FMath::Clamp(Dwell, 0., 120.);
            const TArray<TSharedPtr<FJsonValue>>* Points;
            if ((*Motion)->TryGetArrayField(TEXT("points"),Points) && Points->Num()<=20000) for (const auto& Value:*Points)
            {
                const TSharedPtr<FJsonObject>* Point; double X,Y,Z;
                if (!Value->TryGetObject(Point) || !(*Point)->TryGetNumberField(TEXT("x"),X) || !(*Point)->TryGetNumberField(TEXT("y"),Y) || !(*Point)->TryGetNumberField(TEXT("z"),Z) || !FMath::IsFinite(X+Y+Z)) { Route.Points.Empty(); break; }
                const FVector P(X*100,Z*100,Y*100); if (!Route.Points.IsEmpty()) Route.Length+=FVector::Distance(Route.Points.Last(),P); Route.Points.Add(P);
            }
            if (Route.Points.Num()>1 && Route.Length>1) RouteMotions.Add(MoveTemp(Route));
        }
    }
    Component->AddInstances(Transforms, false, false, false); EntityIds.Add(Component, MoveTemp(SemanticIds));
    MeshBuildMilliseconds += (FPlatformTime::Seconds() - BuildStart) * 1000;
    return true;
}

void ADnDRomSceneActor::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    UpdateTerrainCollision();
    for (const FRouteMotion& Route:RouteMotions) if (auto* Component=Route.Component.Get())
    {
        const double Leg=Route.Length/Route.Speed, Phase=FMath::Fmod(GetWorld()->GetTimeSeconds(),2*(Leg+Route.Dwell));
        const bool Reverse=Phase>=Leg+Route.Dwell; double Remaining=FMath::Clamp(FMath::Fmod(Phase,Leg+Route.Dwell)-Route.Dwell,0.,Leg)*Route.Speed;
        for (int32 I=1;I<Route.Points.Num();I++)
        {
            const FVector A=Route.Points[Reverse?Route.Points.Num()-I:I-1],B=Route.Points[Reverse?Route.Points.Num()-I-1:I]; const double Length=FVector::Distance(A,B);
            if (Remaining<=Length || I==Route.Points.Num()-1) { const FVector P=FMath::Lerp(A,B,FMath::Clamp(Remaining/FMath::Max(1.,Length),0.,1.)); const double Yaw=FMath::RadiansToDegrees(FMath::Atan2((B-A).Y,(B-A).X))-90.; Component->UpdateInstanceTransform(Route.Instance,FTransform(FRotator(0,Yaw,0),P,Route.Scale),false,true,false); break; } Remaining-=Length;
        }
    }
    if (!Document.IsValid()) return;
    const auto& Meshes = Document->GetArrayField(TEXT("meshes"));
    // One budget shared by all tile actors, rather than 4 ms per actor.
    if (ImportBudgetFrame != GFrameCounter) { ImportBudgetFrame = GFrameCounter; ImportDeadline = FPlatformTime::Seconds() + .004; }
    while (NextMesh < Meshes.Num() && FPlatformTime::Seconds() < ImportDeadline) BuildMesh(Meshes[NextMesh++]->AsObject());
    Status = FString::Printf(TEXT("Imported %d / %d mesh groups Ã‚Â· %d compatibility notices"), NextMesh, Meshes.Num(), WarningCount);
    if (NextMesh == Meshes.Num()) { Document.Reset(); Placements.Empty(); bImportComplete = true; }
}

FString ADnDRomSceneActor::EntityForHit(UPrimitiveComponent* Component, int32 InstanceIndex) const
{
    const auto* Ids = EntityIds.Find(Component); return Ids && Ids->IsValidIndex(InstanceIndex) ? (*Ids)[InstanceIndex] : FString();
}

TSharedPtr<FJsonObject> ADnDRomSceneActor::ImportDiagnostics() const
{
    auto Result = MakeShared<FJsonObject>();
    int64 Instances = 0, Triangles = 0;
    int32 MissingMaterials = 0;
    for (const auto& Group : Groups) if (Group && Group->GetStaticMesh())
    {
        Instances += Group->GetInstanceCount();
        if (!Group->GetStaticMesh()->GetStaticMaterials()[0].MaterialInterface) ++MissingMaterials;
        Triangles += Group->GetStaticMesh()->GetRenderData()->LODResources[0].GetNumTriangles();
    }
    int32 CollisionReady=0,CollisionPending=0;int64 CollisionTriangles=0;
    for(int32 I=0;I<TerrainCollision.Num();I++)if(auto* C=TerrainCollision[I].Get()){if(C->GetBodyInstance()&&C->GetBodyInstance()->IsValidBodyInstance())CollisionReady++;else CollisionPending++;if(GroundPatches.IsValidIndex(I))CollisionTriangles+=GroundPatches[I].Indices.Num()/3;}
    Result->SetNumberField(TEXT("terrainCollisionReady"),CollisionReady);Result->SetNumberField(TEXT("terrainCollisionPending"),CollisionPending);Result->SetNumberField(TEXT("terrainCollisionTriangles"),CollisionTriangles);
    Result->SetNumberField(TEXT("meshBuildMilliseconds"), MeshBuildMilliseconds);
    Result->SetNumberField(TEXT("meshesBuilt"), MeshesBuilt);
    Result->SetNumberField(TEXT("prototypeCacheHits"), PrototypeCacheHits);
    Result->SetBoolField(TEXT("importComplete"), IsImportComplete());
    Result->SetNumberField(TEXT("meshGroups"), Groups.Num());
    Result->SetNumberField(TEXT("instances"), Instances);
    Result->SetNumberField(TEXT("prototypeTrianglesLOD0"), Triangles);
    Result->SetNumberField(TEXT("missingMaterials"), MissingMaterials);
    Result->SetNumberField(TEXT("compatibilityNotices"), WarningCount);
    Result->SetNumberField(TEXT("vertexColorsChecked"), VertexColorsChecked);
    Result->SetNumberField(TEXT("vertexColorMismatches"), VertexColorMismatches);
    return Result;
}

TArray<FString> ADnDRomSceneActor::CachedPrototypeIds() { return PrototypeDefinitionOrder; }

void ADnDRomSceneActor::RemoveEntity(const FString& Id)
{
    for(auto& Entry:EntityIds)if(auto* C=Cast<UHierarchicalInstancedStaticMeshComponent>(Entry.Key.Get())){
        for(int32 I=Entry.Value.Num()-1;I>=0;--I)if(Entry.Value[I]==Id||Entry.Value[I].StartsWith(Id+TEXT("/"))){
            const int32 Last=Entry.Value.Num()-1;C->RemoveInstance(I);Entry.Value.RemoveAtSwap(I);
            RouteMotions.RemoveAll([&](const auto& M){return M.Component==C&&M.Instance==I;});
            for(auto& Motion:RouteMotions)if(Motion.Component==C&&Motion.Instance==Last)Motion.Instance=I;
        }
    }
}
void ADnDRomSceneActor::TransformEntity(const FString& Id,const FTransform& Before,const FTransform& After)
{
    for(auto& Entry:EntityIds)if(auto* C=Cast<UHierarchicalInstancedStaticMeshComponent>(Entry.Key.Get())){
        for(int32 I=0;I<Entry.Value.Num();I++)if(Entry.Value[I]==Id||Entry.Value[I].StartsWith(Id+TEXT("/"))){
            FTransform Existing;C->GetInstanceTransform(I,Existing,false);
            C->UpdateInstanceTransform(I,Existing.GetRelativeTransform(Before)*After,false,true,true);
        }
    }
}
