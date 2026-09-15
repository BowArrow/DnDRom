import { afterEach, describe, expect, it, vi } from "vitest";
import { createStarterCampaign } from "../domain/seed";
import { prepareLanguageSettings } from "./managedLanguage";
const ensure = vi.hoisted(() => vi.fn(async () => ({ endpoint: "http://127.0.0.1:8190/v1" })));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("./localRuntime", () => ({ ensureLocalRuntime: ensure }));
describe("app-owned language runtime", () => {
  afterEach(() => vi.clearAllMocks());
  it("migrates the previous empty endpoint and disabled toggle to the managed default", async () => {
    const settings = await prepareLanguageSettings(createStarterCampaign().settings);
    expect(settings).toMatchObject({ useLocalAiForMaps: true, localAiEndpoint: "http://127.0.0.1:8190/v1", localAiModel: "dndrom-director" });
    expect(ensure).toHaveBeenCalledWith("languageModel",expect.any(Function));
  });
  it("respects explicit procedural mode and cancellation", async () => {
    await prepareLanguageSettings({ ...createStarterCampaign().settings, localAiRuntime: "disabled" });
    const controller = new AbortController(); controller.abort();
    await expect(prepareLanguageSettings(createStarterCampaign().settings, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(ensure).not.toHaveBeenCalled();
  });
  it('cancels planning while shared runtime setup is still pending',async()=>{
    ensure.mockImplementationOnce(()=>new Promise(()=>{}));const controller=new AbortController();
    const pending=prepareLanguageSettings(createStarterCampaign().settings,controller.signal);controller.abort();
    await expect(pending).rejects.toMatchObject({name:'AbortError'});
  });
});
