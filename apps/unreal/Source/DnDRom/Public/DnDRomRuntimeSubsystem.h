#pragma once
#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Containers/Ticker.h"
#include "HAL/PlatformProcess.h"
#include "DnDRomRuntimeSubsystem.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FDnDRomRuntimeEvent, const FString&, Json);

/** Each game owns one private-pipe host; the host owns its model processes. */
UCLASS()
class DNDROM_API UDnDRomRuntimeSubsystem : public UGameInstanceSubsystem
{
    GENERATED_BODY()
public:
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;
    UFUNCTION(BlueprintCallable) bool StartHost();
    UFUNCTION(BlueprintCallable) FString Request(const FString& Method, const FString& ParamsJson = TEXT("{}"));
    UFUNCTION(BlueprintCallable) void StopHost();
    UPROPERTY(BlueprintAssignable) FDnDRomRuntimeEvent OnRuntimeEvent;
    UPROPERTY(BlueprintReadOnly) FString Status;
private:
    FProcHandle Process;
    void* ReadPipe = nullptr;
    void* WritePipe = nullptr;
    FTSTicker::FDelegateHandle TickHandle;
    FString Pending;
    uint64 NextId = 0;
    TSet<FString> ActiveRequests;
    bool Tick(float Delta);
};
