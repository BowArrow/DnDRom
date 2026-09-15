#pragma once
#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "AudioCaptureCore.h"
#include "DnDRomAppBridge.generated.h"

class ADnDRomPlayerController;
class SWebBrowser;
class IWebBrowserSchemeHandlerFactory;

/** Bound only to the packaged application origin, never to reference websites. */
UCLASS()
class DNDROM_API UDnDRomAppBridge : public UObject
{
    GENERATED_BODY()
public:
    TSharedPtr<SWebBrowser> Create(ADnDRomPlayerController* InController);
    void Shutdown();
    UFUNCTION() FString Dispatch(const FString& Json);
    UFUNCTION() void RuntimeEvent(const FString& Json);
    void Emit(const FString& Json);
    bool Ready = false;
private:
    UPROPERTY() TObjectPtr<ADnDRomPlayerController> Controller;
    TSharedPtr<SWebBrowser> Browser;
    TSharedPtr<IWebBrowserSchemeHandlerFactory> Files;
    TUniquePtr<FArchive> Upload;
    FString UploadPath;
    FString UploadId;
    FString UploadKind;
    FString UploadName,UploadCacheKey;
    FString CachedImportPath(const FString& Key) const;
    void CacheImport(const FString& Key,const FString& Path);
    int64 UploadBytes = 0;
    int32 UploadUncompressedBytes = 0;
    FString DataDirectory;
    TUniquePtr<Audio::FAudioCaptureSynth> Capture;
    Audio::FCaptureDeviceInfo CaptureInfo;
};
