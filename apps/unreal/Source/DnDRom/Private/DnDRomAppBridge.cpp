#include "DnDRomAppBridge.h"
#include "DnDRomGameMode.h"
#include "DnDRomRuntimeSubsystem.h"
#include "SWebBrowser.h"
#include "IWebBrowserSingleton.h"
#include "IWebBrowserSchemeHandler.h"
#include "WebBrowserModule.h"
#include "GenericPlatform/GenericPlatformHttp.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Misc/FileHelper.h"
#include "Misc/Base64.h"
#include "Misc/Compression.h"
#include "Misc/Paths.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "HAL/FileManager.h"
#include "Engine/GameInstance.h"
#include "UnrealClient.h"
#include "Misc/Base64.h"

namespace
{
    const FString Origin = TEXT("https://dndrom.local/");
    FString Encode(const TSharedPtr<FJsonObject>& Value)
    {
        FString Text; FJsonSerializer::Serialize(Value.ToSharedRef(), TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Text)); return Text;
    }
    FString Failure(const FString& Error) { auto R = MakeShared<FJsonObject>(); R->SetStringField(TEXT("error"), Error); return Encode(R); }
    class FAppResource final : public IWebBrowserSchemeHandler
    {
        FString Root, Mime; TArray<uint8> Bytes; int32 Offset = 0, Status = 404;
    public:
        explicit FAppResource(FString InRoot) : Root(MoveTemp(InRoot)) {}
        bool ProcessRequest(const FString& Verb, const FString& Url, const FSimpleDelegate& Complete) override
        {
            if (Verb != TEXT("GET") || !Url.StartsWith(Origin)) return false;
            FString Relative = Url.Mid(Origin.Len());
            int32 Query; if (Relative.FindChar(TEXT('?'), Query)) Relative.LeftInline(Query);
            Relative = FGenericPlatformHttp::UrlDecode(Relative);
            if (Relative.IsEmpty()) Relative = TEXT("index.html");
            if (Relative.Contains(TEXT("..")) || Relative.Contains(TEXT(":")) || Relative.Contains(TEXT("\\")) || Relative.StartsWith(TEXT("/"))) return false;
            const FString Path = FPaths::Combine(Root, Relative);
            if (FFileHelper::LoadFileToArray(Bytes, *Path)) Status = 200;
            const FString Ext = FPaths::GetExtension(Path).ToLower();
            Mime = Ext == TEXT("html") ? TEXT("text/html") : (Ext == TEXT("js") || Ext == TEXT("mjs")) ? TEXT("text/javascript") : Ext == TEXT("css") ? TEXT("text/css") : Ext == TEXT("json") ? TEXT("application/json") : Ext == TEXT("svg") ? TEXT("image/svg+xml") : Ext == TEXT("png") ? TEXT("image/png") : Ext == TEXT("jpg") ? TEXT("image/jpeg") : Ext == TEXT("wasm") ? TEXT("application/wasm") : TEXT("application/octet-stream");
            Complete.ExecuteIfBound(); return true;
        }
        void GetResponseHeaders(IHeaders& Headers) override
        {
            Headers.SetStatusCode(Status); Headers.SetMimeType(*Mime); Headers.SetContentLength(Bytes.Num());
            Headers.SetHeader(TEXT("Cache-Control"), TEXT("no-cache"));
            Headers.SetHeader(TEXT("X-Content-Type-Options"), TEXT("nosniff"));
        }
        bool ReadResponse(uint8* Out, int32 Count, int32& Read, const FSimpleDelegate&) override
        { Read = FMath::Min(Count, Bytes.Num() - Offset); if (Read > 0) FMemory::Memcpy(Out, Bytes.GetData() + Offset, Read); Offset += Read; return Read > 0; }
        void Cancel() override { Bytes.Empty(); Offset = 0; }
    };
    class FAppFiles final : public IWebBrowserSchemeHandlerFactory
    {
        FString Root;
    public:
        explicit FAppFiles(FString InRoot) : Root(MoveTemp(InRoot)) {}
        TUniquePtr<IWebBrowserSchemeHandler> Create(FString Verb, FString Url) override { return MakeUnique<FAppResource>(Root); }
    };
}

TSharedPtr<SWebBrowser> UDnDRomAppBridge::Create(ADnDRomPlayerController* InController)
{
    Controller = InController;
    DataDirectory = FPaths::Combine(FPlatformMisc::GetEnvironmentVariable(TEXT("LOCALAPPDATA")), TEXT("ai.dndrom.desktop"));
    FParse::Value(FCommandLine::Get(), TEXT("DnDRomData="), DataDirectory);
    auto* Web = IWebBrowserModule::Get().GetSingleton();
    // UE's CEF wrapper keeps a raw factory pointer. Unregister removes its
    // bookkeeping entry but pending CEF requests can still invoke Create()
    // after this UObject shuts down. This immutable, non-UObject factory must
    // survive until process teardown, after CEF has finished its IO threads.
    static const TSharedRef<FAppFiles> ProcessFiles = MakeShared<FAppFiles>(FPaths::Combine(FPaths::ProjectDir(), TEXT("WebUI")));
    Files = ProcessFiles;
    Web->RegisterSchemeHandlerFactory(TEXT("https"), TEXT("dndrom.local"), Files.Get());
    FCreateBrowserWindowSettings Settings;
    Settings.InitialURL = TEXT("about:blank"); Settings.bUseTransparency = true; Settings.BackgroundColor = FColor::Transparent; Settings.BrowserFrameRate = 60;
    // CEF silently downgrades a cache outside root_cache_path to memory-only.
    // The default persistent context stores campaigns and asset databases.
    auto Window = Web->CreateBrowserWindow(Settings);
    // Automation injects browser events through CDP. Exclude real desktop mouse
    // events so a user's cursor cannot race the test's drag sequence.
    SAssignNew(Browser, SWebBrowser, Window).ShowControls(false).SupportsTransparency(true)
        .Visibility(FParse::Param(FCommandLine::Get(), TEXT("DnDRomAutomation")) ? EVisibility::HitTestInvisible : EVisibility::Visible)
        .OnBeforeNavigation_Lambda([](const FString& Url, const FWebNavigationRequest&) { return !Url.StartsWith(Origin) && Url != TEXT("about:blank"); })
        .OnBeforePopup_Lambda([](FString, FString) { return true; });
    Browser->BindUObject(TEXT("dndrom"), this, true);
    Controller->GetGameInstance()->GetSubsystem<UDnDRomRuntimeSubsystem>()->OnRuntimeEvent.AddDynamic(this, &UDnDRomAppBridge::RuntimeEvent);
    Browser->LoadURL(Origin + TEXT("?native=1"));
    return Browser;
}

void UDnDRomAppBridge::Emit(const FString& Json)
{
    if (Browser && Ready) Browser->ExecuteJavascript(TEXT("window.dispatchEvent(new CustomEvent('dndrom:native',{detail:") + Json + TEXT("}));"));
}
void UDnDRomAppBridge::RuntimeEvent(const FString& Json) { Emit(Json); }

FString UDnDRomAppBridge::Dispatch(const FString& Json)
{
    TSharedPtr<FJsonObject> Request;
    if (Json.Len() > 512 * 1024 || !FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), Request) || !Request.IsValid()) return Failure(TEXT("Invalid native request"));
    FString Method; if (!Request->TryGetStringField(TEXT("method"), Method)) return Failure(TEXT("Missing native method"));
    const TSharedPtr<FJsonObject>* ParamsPtr;
    const auto Params = Request->TryGetObjectField(TEXT("params"), ParamsPtr) ? *ParamsPtr : MakeShared<FJsonObject>();
    if (Method == TEXT("app.ready")) { Ready = true; return TEXT("{\"ready\":true}"); }
    if (Method == TEXT("audio.start"))
    {
        if (Capture) Capture->AbortCapturing();
        Capture = MakeUnique<Audio::FAudioCaptureSynth>();
        if (!Capture->GetDefaultCaptureDeviceInfo(CaptureInfo) || !Capture->OpenDefaultStream() || !Capture->StartCapturing()) { Capture.Reset(); return Failure(TEXT("Cannot open the microphone. Check Windows microphone permission and the selected input device.")); }
        return TEXT("{\"capturing\":true}");
    }
    if (Method == TEXT("audio.pull"))
    {
        if (!Capture) return Failure(TEXT("Microphone is stopped"));
        TArray<float> Samples; Capture->GetAudioData(Samples);
        const int32 Channels = FMath::Max(1, CaptureInfo.InputChannels);
        if (Samples.Num() > CaptureInfo.PreferredSampleRate * Channels * 2) { Capture->AbortCapturing(); Capture.Reset(); return Failure(TEXT("Speech capture could not keep up and was stopped")); }
        TArray<int16> Mono; Mono.SetNumUninitialized(Samples.Num() / Channels);
        for (int32 I = 0; I < Mono.Num(); ++I) { float Sum = 0; for (int32 C = 0; C < Channels; ++C) Sum += Samples[I * Channels + C]; Mono[I] = FMath::Clamp(Sum / Channels, -1.f, 1.f) * 32767; }
        auto R = MakeShared<FJsonObject>(); R->SetStringField(TEXT("pcm"), FBase64::Encode((const uint8*)Mono.GetData(), Mono.Num() * sizeof(int16))); R->SetNumberField(TEXT("sampleRate"), CaptureInfo.PreferredSampleRate); return Encode(R);
    }
    if (Method == TEXT("audio.stop")) { if (Capture) Capture->AbortCapturing(); Capture.Reset(); return TEXT("{}"); }
    if (Method == TEXT("app.diagnostics")) return Encode(Controller->AppDiagnostics());
    if (Method == TEXT("world.sync"))
    {
        if (Params->HasTypedField<EJson::Array>(TEXT("visible"))) Controller->AppWorld(TEXT("world.visible"), Params);
        return Encode(Controller->AppDiagnostics());
    }
    if (Method == TEXT("app.capture"))
    {
        const FString Path = FPaths::Combine(DataDirectory, TEXT("native-capture.png"));
        FScreenshotRequest::RequestScreenshot(Path, true, false);
        auto R = MakeShared<FJsonObject>(); R->SetStringField(TEXT("path"), Path); return Encode(R);
    }
    if (Method.StartsWith(TEXT("runtime.")) || Method.StartsWith(TEXT("rules.")))
    {
        auto* Runtime = Controller->GetGameInstance()->GetSubsystem<UDnDRomRuntimeSubsystem>();
        const FString Id = Runtime->Request(Method, Encode(Params));
        if (Id.IsEmpty()) return Failure(Runtime->Status);
        auto R = MakeShared<FJsonObject>(); R->SetStringField(TEXT("requestId"), Id); return Encode(R);
    }
    if (Method == TEXT("scene.input")) return Controller->AppInput(Params);
    if (Method == TEXT("scene.viewport")) return Controller->AppViewport(Params);
    if (Method == TEXT("scene.environment")) { Controller->AppEnvironment(Params); return TEXT("{}"); }
    if (Method == TEXT("world.visible") || Method == TEXT("world.clear") || Method == TEXT("world.reveal")) { Controller->AppWorld(Method, Params); return TEXT("{}"); }
    if(Method==TEXT("upload.cached")){
        FString Key,Kind,Name,Identity;Params->TryGetStringField(TEXT("cacheKey"),Key);Params->TryGetStringField(TEXT("kind"),Kind);Params->TryGetStringField(TEXT("name"),Name);Params->TryGetStringField(TEXT("streamId"),Identity);
        if(Kind!=TEXT("scene")&&Kind!=TEXT("tile"))return Failure(TEXT("Invalid cache import kind"));
        const auto Path=CachedImportPath(Key);if(Path.IsEmpty()||!IFileManager::Get().FileExists(*Path))return TEXT("{\"hit\":false}");
        const bool Loaded=Kind==TEXT("scene")?Controller->AppLoadScene(Path):Controller->AppLoadTile(Name,Path,Identity);
        if(!Loaded){IFileManager::Get().Delete(*Path);return TEXT("{\"hit\":false}");}
        Controller->RebindCachedImport(Kind,Name,Identity);IFileManager::Get().SetTimeStamp(*Path,FDateTime::UtcNow());
        return TEXT("{\"hit\":true,\"loaded\":true}");
    }
    if (Method == TEXT("upload.inline"))
    {
        FString Kind, Name, Text, Encoding; double RawBytes = 0;
        if (!Params->TryGetStringField(TEXT("kind"), Kind) || (Kind != TEXT("scene") && Kind != TEXT("tile")) || !Params->TryGetStringField(TEXT("text"), Text)) return Failure(TEXT("Invalid inline scene"));
        Params->TryGetStringField(TEXT("name"), Name); Params->TryGetStringField(TEXT("encoding"), Encoding);
        TArray<uint8> Raw;
        if (Encoding == TEXT("gzip-base64")) {
            if (!Params->TryGetNumberField(TEXT("uncompressedBytes"), RawBytes) || !FMath::IsFinite(RawBytes) || RawBytes < 1 || RawBytes > 128ll*1024*1024 || RawBytes != FMath::FloorToDouble(RawBytes)) return Failure(TEXT("Invalid decompressed transfer size"));
            TArray<uint8> Compressed; Raw.SetNumUninitialized((int32)RawBytes);
            if (!FBase64::Decode(Text, Compressed) || !FCompression::UncompressMemory(NAME_Gzip, Raw.GetData(), Raw.Num(), Compressed.GetData(), Compressed.Num())) return Failure(TEXT("Invalid compressed scene transfer"));
        } else if (Encoding.IsEmpty()) { FTCHARToUTF8 Bytes(*Text); Raw.Append((const uint8*)Bytes.Get(), Bytes.Length()); }
        else return Failure(TEXT("Unsupported inline encoding"));
        const FString Dir = FPaths::Combine(DataDirectory, TEXT("native-transfer")); IFileManager::Get().MakeDirectory(*Dir, true);
        const FString Filename = FPaths::Combine(Dir, FGuid::NewGuid().ToString(EGuidFormats::Digits) + TEXT(".tmp"));
        if (!FFileHelper::SaveArrayToFile(Raw, *Filename)) return Failure(TEXT("Cannot save inline scene"));
        const bool Loaded = Kind == TEXT("tile") ? Controller->AppLoadTile(Name, Filename) : Controller->AppLoadScene(Filename);
        FString CacheKey;Params->TryGetStringField(TEXT("cacheKey"),CacheKey);if(Loaded)CacheImport(CacheKey,Filename);
        IFileManager::Get().Delete(*Filename);
        return Loaded ? TEXT("{\"loaded\":true}") : Failure(TEXT("Scene import failed validation"));
    }
    if (Method == TEXT("upload.begin"))
    {
        FString Kind, Name;
        if (!Params->TryGetStringField(TEXT("kind"), Kind) || (Kind != TEXT("scene") && Kind != TEXT("download") && Kind != TEXT("tile") && Kind != TEXT("material"))) return Failure(TEXT("Unsupported upload kind"));
        Params->TryGetStringField(TEXT("name"), Name);
        if (Kind == TEXT("download") && (Name.IsEmpty() || Name != FPaths::GetCleanFilename(Name) || Name.Contains(TEXT(":")) || Name.Len() > 120)) return Failure(TEXT("Invalid download name"));
        FString Encoding; double RawBytes = 0; UploadUncompressedBytes = 0;
        if (Params->TryGetStringField(TEXT("acceptEncoding"), Encoding) && Encoding == TEXT("gzip-base64") && (Kind == TEXT("scene") || Kind == TEXT("tile"))) {
            if (!Params->TryGetNumberField(TEXT("uncompressedBytes"), RawBytes) || !FMath::IsFinite(RawBytes) || RawBytes < 1 || RawBytes > 128ll*1024*1024 || RawBytes != FMath::FloorToDouble(RawBytes)) return Failure(TEXT("Invalid decompressed transfer size"));
            UploadUncompressedBytes = (int32)RawBytes;
        }
        Upload.Reset(); if (!UploadPath.IsEmpty()) IFileManager::Get().Delete(*UploadPath);
        UploadCacheKey.Empty();Params->TryGetStringField(TEXT("cacheKey"),UploadCacheKey);
        UploadId = FGuid::NewGuid().ToString(EGuidFormats::Digits); UploadKind = Kind; UploadName = Name; UploadBytes = 0;
        const FString Dir = FPaths::Combine(DataDirectory, TEXT("native-transfer")); IFileManager::Get().MakeDirectory(*Dir, true);
        UploadPath = FPaths::Combine(Dir, UploadId + TEXT(".tmp")); Upload.Reset(IFileManager::Get().CreateFileWriter(*UploadPath));
        if (!Upload) return Failure(TEXT("Cannot write native transfer"));
        auto R = MakeShared<FJsonObject>(); R->SetStringField(TEXT("id"), UploadId); R->SetBoolField(TEXT("inline"), true); if (UploadUncompressedBytes) R->SetStringField(TEXT("encoding"), TEXT("gzip-base64")); return Encode(R);
    }
    if (Method.StartsWith(TEXT("upload.")))
    {
        FString Id; if (!Upload || !Params->TryGetStringField(TEXT("id"), Id) || Id != UploadId) return Failure(TEXT("Transfer expired"));
        if (Method == TEXT("upload.abort")) { Upload.Reset(); IFileManager::Get().Delete(*UploadPath); UploadPath.Empty(); return TEXT("{}"); }
        if (Method == TEXT("upload.chunk"))
        {
            FString Part; if (!Params->TryGetStringField(TEXT("text"), Part)) return Failure(TEXT("Missing transfer chunk"));
            FTCHARToUTF8 Bytes(*Part); UploadBytes += Bytes.Length();
            if (UploadBytes > 128ll * 1024 * 1024) { Upload.Reset(); IFileManager::Get().Delete(*UploadPath); return Failure(TEXT("Transfer exceeds 128 MiB")); }
            Upload->Serialize((void*)Bytes.Get(), Bytes.Length()); if (Upload->IsError()) return Failure(TEXT("Transfer write failed"));
            return TEXT("{}");
        }
        if (Method == TEXT("upload.commit"))
        {
            const bool Written = Upload->Close(); Upload.Reset();
            if (!Written) return Failure(TEXT("Transfer could not be saved"));
            if (UploadUncompressedBytes) {
                FString Encoded; TArray<uint8> Compressed, Raw; Raw.SetNumUninitialized(UploadUncompressedBytes);
                const bool Decoded = FFileHelper::LoadFileToString(Encoded, *UploadPath) && FBase64::Decode(Encoded, Compressed) && FCompression::UncompressMemory(NAME_Gzip, Raw.GetData(), Raw.Num(), Compressed.GetData(), Compressed.Num());
                if (!Decoded || !FFileHelper::SaveArrayToFile(Raw, *UploadPath)) { IFileManager::Get().Delete(*UploadPath); UploadPath.Empty(); return Failure(TEXT("Invalid compressed scene transfer")); }
            }
            if (UploadKind == TEXT("material"))
            {
                const bool Loaded = Controller->AppLoadMaterial(UploadPath); IFileManager::Get().Delete(*UploadPath); UploadPath.Empty();
                return Loaded ? TEXT("{\"loaded\":true}") : Failure(TEXT("Material import failed"));
            }
            if (UploadKind == TEXT("scene") || UploadKind == TEXT("tile"))
            {
                const bool Loaded = UploadKind == TEXT("tile") ? Controller->AppLoadTile(UploadName, UploadPath) : Controller->AppLoadScene(UploadPath);
                if(Loaded)CacheImport(UploadCacheKey,UploadPath);
                IFileManager::Get().Delete(*UploadPath); UploadPath.Empty();
                return Loaded ? TEXT("{\"loaded\":true}") : Failure(TEXT("Scene import failed validation"));
            }
            const FString Dir = FPaths::Combine(DataDirectory, TEXT("exports")); IFileManager::Get().MakeDirectory(*Dir, true);
            const FString Destination = FPaths::Combine(Dir, UploadId.Left(8) + TEXT("-") + UploadName);
            if (!IFileManager::Get().Move(*Destination, *UploadPath, false)) return Failure(TEXT("Cannot finish export"));
            UploadPath.Empty(); auto R = MakeShared<FJsonObject>(); R->SetStringField(TEXT("path"), Destination); return Encode(R);
        }
    }
    return Failure(TEXT("Unsupported native command: ") + Method);
}

void UDnDRomAppBridge::Shutdown()
{
    if (Capture) Capture->AbortCapturing(); Capture.Reset();
    Upload.Reset(); if (!UploadPath.IsEmpty()) IFileManager::Get().Delete(*UploadPath);
    if (Controller) Controller->GetGameInstance()->GetSubsystem<UDnDRomRuntimeSubsystem>()->OnRuntimeEvent.RemoveDynamic(this, &UDnDRomAppBridge::RuntimeEvent);
    if (Browser) Browser->UnbindUObject(TEXT("dndrom"), this, true);
    Browser.Reset();
    if (Files) IWebBrowserModule::Get().GetSingleton()->UnregisterSchemeHandlerFactory(Files.Get());
    Files.Reset();
}

FString UDnDRomAppBridge::CachedImportPath(const FString& Key) const {
 if(Key.Len()!=64)return FString();for(TCHAR C:Key)if(!FChar::IsHexDigit(C))return FString();
 return FPaths::Combine(DataDirectory,TEXT("native-render-cache-v1"),Key+TEXT(".json"));
}
void UDnDRomAppBridge::CacheImport(const FString& Key,const FString& Source){
 const auto Target=CachedImportPath(Key);if(Target.IsEmpty())return;const auto Dir=FPaths::GetPath(Target);IFileManager::Get().MakeDirectory(*Dir,true);
 if(IFileManager::Get().Copy(*Target,*Source,true,true)!=COPY_OK)return;
 TArray<FString> Names;IFileManager::Get().FindFiles(Names,*FPaths::Combine(Dir,TEXT("*.json")),true,false);
 Names.Sort([&](const FString& A,const FString& B){return IFileManager::Get().GetTimeStamp(*FPaths::Combine(Dir,A))>IFileManager::Get().GetTimeStamp(*FPaths::Combine(Dir,B));});
 int64 Total=0;for(const auto& Name:Names){const auto File=FPaths::Combine(Dir,Name);Total+=FMath::Max(int64(0),IFileManager::Get().FileSize(*File));if(Total>1024ll*1024*1024)IFileManager::Get().Delete(*File);}
}
