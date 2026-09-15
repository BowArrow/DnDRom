#include "DnDRomRuntimeSubsystem.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Misc/Paths.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "HAL/FileManager.h"

void UDnDRomRuntimeSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
    Super::Initialize(Collection);
    Status = TEXT("Local runtime stopped");
    TickHandle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateUObject(this, &UDnDRomRuntimeSubsystem::Tick));
}

bool UDnDRomRuntimeSubsystem::StartHost()
{
    if (Process.IsValid() && FPlatformProcess::IsProcRunning(Process)) return true;
    StopHost();
    FString Executable = FPaths::Combine(FPlatformProcess::BaseDir(), TEXT("dndrom-runtime-host.exe"));
    if (!FPaths::FileExists(Executable)) Executable = FPaths::Combine(FPaths::ProjectDir(), TEXT("Binaries/Win64/dndrom-runtime-host.exe"));
    // Explicit override supports portable profiles and existing installations.
    FString Data = FPaths::Combine(FPlatformMisc::GetEnvironmentVariable(TEXT("LOCALAPPDATA")), TEXT("ai.dndrom.desktop"));
    FParse::Value(FCommandLine::Get(), TEXT("DnDRomData="), Data);
    if (!FPaths::FileExists(Executable) || FPaths::IsRelative(Data) || Data.Contains(TEXT("\"")))
    { Status = TEXT("Build the runtime host and provide an absolute DnDRom data directory."); return false; }
    void* ChildWrite = nullptr;
    void* ChildRead = nullptr;
    if (!FPlatformProcess::CreatePipe(ReadPipe, ChildWrite) || !FPlatformProcess::CreatePipe(ChildRead, WritePipe, true))
    {
        FPlatformProcess::ClosePipe(ReadPipe, ChildWrite); FPlatformProcess::ClosePipe(ChildRead, WritePipe);
        ReadPipe = WritePipe = nullptr; Status = TEXT("Cannot create local runtime pipes"); return false;
    }
    const FString Arguments = FString::Printf(TEXT("--data-dir \"%s\" --parent-pid %u"), *Data, FPlatformProcess::GetCurrentProcessId());
    Process = FPlatformProcess::CreateProc(*Executable, *Arguments, false, true, true, nullptr, 0, nullptr, ChildWrite, ChildRead);
    FPlatformProcess::ClosePipe(ChildRead, ChildWrite);
    if (!Process.IsValid()) { StopHost(); Status = TEXT("Cannot launch local runtime host"); return false; }
    Status = TEXT("Connecting to owned local runtime…");
    Request(TEXT("system.hello"));
    return true;
}

FString UDnDRomRuntimeSubsystem::Request(const FString& Method, const FString& ParamsJson)
{
    if (!Process.IsValid() || !FPlatformProcess::IsProcRunning(Process)) { Status = TEXT("Local runtime host is not running"); return {}; }
    TSharedPtr<FJsonObject> Params;
    if (ParamsJson.Len() > 256 * 1024 || !FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(ParamsJson), Params) || !Params.IsValid())
    { Status = TEXT("Invalid runtime parameters"); return {}; }
    const FString Id = FString::Printf(TEXT("ue-%llu"), ++NextId);
    auto Envelope = MakeShared<FJsonObject>();
    Envelope->SetNumberField(TEXT("version"), 1); Envelope->SetStringField(TEXT("id"), Id);
    Envelope->SetStringField(TEXT("method"), Method); Envelope->SetObjectField(TEXT("params"), Params);
    FString Json; FJsonSerializer::Serialize(Envelope, TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Json));
    const FString Frame = Json + TEXT("\n");
    const FTCHARToUTF8 Utf8(*Frame);
    int32 Written = 0;
    if (!FPlatformProcess::WritePipe(WritePipe, reinterpret_cast<const uint8*>(Utf8.Get()), Utf8.Length(), &Written) || Written != Utf8.Length())
    { StopHost(); Status = TEXT("Runtime pipe closed before the request was sent"); return {}; }
    ActiveRequests.Add(Id); return Id;
}

bool UDnDRomRuntimeSubsystem::Tick(float Delta)
{
    if (!Process.IsValid()) return true;
    Pending += FPlatformProcess::ReadPipe(ReadPipe);
    if (Pending.Len() > 2 * 1024 * 1024) { StopHost(); Status = TEXT("Runtime response exceeded framing limit"); return true; }
    int32 End;
    while (Pending.FindChar(TEXT('\n'), End))
    {
        FString Line = Pending.Left(End).TrimStartAndEnd(); Pending.RightChopInline(End + 1);
        TSharedPtr<FJsonObject> Message;
        if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Line), Message) || !Message.IsValid())
        { StopHost(); Status = TEXT("Invalid runtime protocol response"); return true; }
        double Version = 0;
        if (!Message->TryGetNumberField(TEXT("version"), Version) || Version != 1)
        { StopHost(); Status = TEXT("Unsupported runtime protocol"); return true; }
        bool Ok;
        if (Message->TryGetBoolField(TEXT("ok"), Ok))
        {
            FString Error;
            if (!Ok && Message->TryGetStringField(TEXT("error"), Error)) Status = Error;
            else if (Ok)
            {
                Status = TEXT("Local runtime connected");
                const TSharedPtr<FJsonObject>* Result; FString State, Detail;
                if (Message->TryGetObjectField(TEXT("result"), Result) && (*Result)->TryGetStringField(TEXT("state"), State))
                {
                    (*Result)->TryGetStringField(TEXT("message"), Detail);
                    Status = State + TEXT(": ") + Detail;
                }
            }
        }
        FString ResponseId;
        if (Message->TryGetStringField(TEXT("id"), ResponseId) && Message->TryGetBoolField(TEXT("ok"), Ok)) ActiveRequests.Remove(ResponseId);
        OnRuntimeEvent.Broadcast(Line);
    }
    if (!FPlatformProcess::IsProcRunning(Process)) { StopHost(); Status = TEXT("Local runtime host exited"); }
    return true;
}

void UDnDRomRuntimeSubsystem::StopHost()
{
    auto Interrupted = MoveTemp(ActiveRequests); ActiveRequests.Empty();
    for (const auto& Id : Interrupted)
        OnRuntimeEvent.Broadcast(FString::Printf(TEXT("{\"version\":1,\"id\":\"%s\",\"ok\":false,\"error\":\"The local runtime stopped before completing this request. Try again.\"}"), *Id));
    // Closing stdin requests orderly shutdown. Do not block the render thread
    // waiting for downloads; Windows job handles also clean up on forced exit.
    FPlatformProcess::ClosePipe(nullptr, WritePipe); WritePipe = nullptr;
    if (Process.IsValid())
    {
        if (FPlatformProcess::IsProcRunning(Process)) FPlatformProcess::TerminateProc(Process, true);
        FPlatformProcess::CloseProc(Process); Process.Reset();
    }
    FPlatformProcess::ClosePipe(ReadPipe, nullptr); ReadPipe = nullptr; Pending.Empty();
    Status = TEXT("Local runtime stopped");
}

void UDnDRomRuntimeSubsystem::Deinitialize()
{
    FTSTicker::GetCoreTicker().RemoveTicker(TickHandle); StopHost(); Super::Deinitialize();
}
