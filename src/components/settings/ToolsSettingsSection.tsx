import { useState, useEffect, useReducer } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button, Select } from "../ui";
import {
  SpinnerIcon,
  CheckIcon,
  ClaudeIcon,
  CodexIcon,
  OpenCodeIcon,
  OllamaIcon,
} from "../icons";
import { AI_PROVIDER_ORDER, type AiProvider } from "../../services/ai";
import * as aiService from "../../services/ai";
import { mod } from "../../lib/platform";
import * as cliService from "../../services/cli";
import type { CliStatus } from "../../services/cli";
import type { Settings } from "../../types/note";
import { QuickActionsEditor } from "./QuickActionsEditor";

type CliState = {
  status: CliStatus | null;
  loaded: boolean;
  error: boolean;
  operating: boolean;
};

type CliAction =
  | { type: "loaded"; status: CliStatus }
  | { type: "error" }
  | { type: "operating" }
  | { type: "operated"; status: CliStatus }
  | { type: "operate_failed" };

const cliInitialState: CliState = {
  status: null,
  loaded: false,
  error: false,
  operating: false,
};

function cliReducer(state: CliState, action: CliAction): CliState {
  switch (action.type) {
    case "loaded":
      return { ...state, status: action.status, loaded: true, error: false };
    case "error":
      return { ...state, error: true };
    case "operating":
      return { ...state, operating: true };
    case "operated":
      return { ...state, status: action.status, operating: false };
    case "operate_failed":
      return { ...state, operating: false };
  }
}

function CliUsageHint() {
  return (
    <p className="text-sm text-text-muted font-mono">
      scratch file.md # open note
      <br />
      scratch . # open folder
      <br />
      scratch # launch app
    </p>
  );
}

const AI_PROVIDER_INFO: Record<
  AiProvider,
  {
    name: string;
    vendor: string;
    blurb: string;
    icon: React.ComponentType<{ className?: string }>;
    installUrl: string;
  }
> = {
  claude: {
    name: "Claude Code",
    vendor: "Anthropic",
    blurb: "Anthropic's coding agent in your terminal.",
    icon: ClaudeIcon,
    installUrl: "https://code.claude.com/docs/en/quickstart",
  },
  codex: {
    name: "OpenAI Codex",
    vendor: "OpenAI",
    blurb: "OpenAI's coding agent in your terminal.",
    icon: CodexIcon,
    installUrl: "https://github.com/openai/codex",
  },
  opencode: {
    name: "OpenCode",
    vendor: "opencode.ai",
    blurb: "Open-source terminal coding agent.",
    icon: OpenCodeIcon,
    installUrl: "https://opencode.ai",
  },
  ollama: {
    name: "Ollama",
    vendor: "Local",
    blurb: "Run open models locally, fully offline.",
    icon: OllamaIcon,
    installUrl: "https://ollama.com",
  },
};

export function ToolsSettingsSection() {
  const [cli, dispatchCli] = useReducer(cliReducer, cliInitialState);
  const [aiProviders, setAiProviders] = useState<AiProvider[]>([]);
  const [aiProvidersLoading, setAiProvidersLoading] = useState(true);
  const [defaultProvider, setDefaultProvider] = useState<AiProvider | null>(
    null,
  );
  const [ollamaModel, setOllamaModel] = useState("qwen3:8b");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [opencodeModel, setOpencodeModel] = useState("");
  const [opencodeModels, setOpencodeModels] = useState<string[]>([]);

  useEffect(() => {
    cliService
      .getCliStatus()
      .then((status) => dispatchCli({ type: "loaded", status }))
      .catch((err) => {
        console.error("Failed to get CLI status:", err);
        dispatchCli({ type: "error" });
      });
  }, []);

  useEffect(() => {
    aiService
      .getAvailableAiProviders()
      .then(setAiProviders)
      .catch(() => setAiProviders([]))
      .finally(() => setAiProvidersLoading(false));
  }, []);

  useEffect(() => {
    invoke<Settings>("get_settings")
      .then((s) => {
        setDefaultProvider(s.defaultAiProvider ?? null);
        setOllamaModel(s.ollamaModel || "qwen3:8b");
        setOpencodeModel(s.opencodeModel || "");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    aiService
      .listOllamaModels()
      .then(setOllamaModels)
      .catch(() => setOllamaModels([]));
    aiService
      .listOpencodeModels()
      .then(setOpencodeModels)
      .catch(() => setOpencodeModels([]));
  }, []);

  const handleSetDefault = (provider: AiProvider) => {
    setDefaultProvider(provider);
    invoke<Settings>("get_settings")
      .then((s) =>
        invoke("update_settings", {
          newSettings: { ...s, defaultAiProvider: provider },
        }),
      )
      .catch(() => {});
  };

  const handleSetOllamaModel = (model: string) => {
    setOllamaModel(model);
    invoke<Settings>("get_settings")
      .then((s) =>
        invoke("update_settings", {
          newSettings: { ...s, ollamaModel: model },
        }),
      )
      .catch(() => {});
  };

  const handleSetOpencodeModel = (model: string) => {
    setOpencodeModel(model);
    invoke<Settings>("get_settings")
      .then((s) =>
        invoke("update_settings", {
          newSettings: { ...s, opencodeModel: model },
        }),
      )
      .catch(() => {});
  };

  const handleInstallCli = async () => {
    dispatchCli({ type: "operating" });
    try {
      await cliService.installCli();
      const status = await cliService.getCliStatus();
      dispatchCli({ type: "operated", status });
      toast.success(
        "CLI tool installed. Open a new terminal to use `scratch`.",
      );
    } catch (err) {
      dispatchCli({ type: "operate_failed" });
      toast.error(
        err instanceof Error ? err.message : "Failed to install CLI tool",
      );
    }
  };

  const handleUninstallCli = async () => {
    dispatchCli({ type: "operating" });
    try {
      await cliService.uninstallCli();
      const status = await cliService.getCliStatus();
      dispatchCli({ type: "operated", status });
      toast.success("CLI tool uninstalled.");
    } catch (err) {
      dispatchCli({ type: "operate_failed" });
      toast.error(
        err instanceof Error ? err.message : "Failed to uninstall CLI tool",
      );
    }
  };

  return (
    <div className="space-y-8 py-8">
      {/* AI Providers */}
      <section className="pb-2">
        <h2 className="text-xl font-medium mb-0.5">AI Providers</h2>
        <p className="text-sm text-text-muted mb-4">
          Pick a provider to make it your default for AI editing ({mod}P in a
          note, or on a selection). Each one keeps its own model.
        </p>

        {aiProvidersLoading ? (
          <div className="flex items-center gap-2 p-3">
            <SpinnerIcon className="w-4 h-4 animate-spin text-text-muted" />
            <span className="text-sm text-text-muted">
              Detecting installed providers...
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {AI_PROVIDER_ORDER.map((provider) => {
              const installed = aiProviders.includes(provider);
              const info = AI_PROVIDER_INFO[provider];

              if (!installed) {
                return (
                  <div
                    key={provider}
                    className="flex flex-col gap-3 p-4 rounded-xl border border-dashed border-border bg-bg-secondary min-h-33"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-9 h-9 rounded-[10px] grid place-items-center bg-bg-muted text-text-muted shrink-0">
                        <info.icon className="w-5 h-5" />
                      </span>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-semibold truncate">
                          {info.name}
                        </span>
                        <span className="text-xs text-text-muted">
                          {info.vendor}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-text-muted flex-1 m-0">
                      {info.blurb}
                    </p>
                    <a
                      href={info.installUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="self-start text-xs font-medium px-3 py-1.5 rounded-lg border border-border hover:bg-bg-muted transition-colors"
                    >
                      Install
                    </a>
                  </div>
                );
              }

              const isDefault =
                (defaultProvider ?? aiProviders[0]) === provider;
              const modelSel =
                provider === "ollama"
                  ? {
                      value: ollamaModel,
                      options: ollamaModels,
                      onChange: handleSetOllamaModel,
                    }
                  : provider === "opencode"
                    ? {
                        value: opencodeModel,
                        options: opencodeModels,
                        onChange: handleSetOpencodeModel,
                      }
                    : null;

              return (
                <div
                  key={provider}
                  onClick={() => handleSetDefault(provider)}
                  className={`flex flex-col gap-3 p-4 rounded-xl border cursor-pointer transition-all min-h-33 ${
                    isDefault
                      ? "border-text/30 bg-bg-muted shadow-lg"
                      : "border-border hover:border-text-muted/50"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="w-10 h-10 rounded-[11px] grid place-items-center bg-bg border border-border text-text-muted shrink-0">
                      <info.icon className="w-5.5 h-5.5" />
                    </span>
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="text-sm font-semibold truncate">
                        {info.name}
                      </span>
                      <span className="text-xs text-text-muted">
                        {info.vendor}
                      </span>
                    </div>
                    <span
                      className={`w-5.5 h-5.5 rounded-full grid place-items-center shrink-0 transition-all ${
                        isDefault
                          ? "bg-text text-text-inverse"
                          : "border-[1.5px] border-border"
                      }`}
                    >
                      {isDefault && (
                        <CheckIcon className="w-3 h-3 stroke-[2.5]" />
                      )}
                    </span>
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-2">
                    {modelSel ? (
                      <>
                        <span className="text-2xs font-semibold uppercase tracking-wide text-text-muted shrink-0">
                          Model
                        </span>
                        <div
                          className="flex-1 min-w-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Select
                            value={modelSel.value}
                            onChange={(e) =>
                              modelSel.onChange(e.target.value)
                            }
                          >
                            {!modelSel.value && (
                              <option value="">Default model</option>
                            )}
                            {Array.from(
                              new Set(
                                [modelSel.value, ...modelSel.options].filter(
                                  Boolean,
                                ),
                              ),
                            ).map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </Select>
                        </div>
                      </>
                    ) : (
                      <span className="text-xs text-text-muted">
                        Model set in the CLI
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* AI quick actions */}
      <section className="pb-2">
        <h2 className="text-xl font-medium mb-0.5">Quick actions</h2>
        <p className="text-sm text-text-muted mb-4">
          One-click presets shown when editing a selection with AI.
        </p>

        <QuickActionsEditor />
      </section>

      {/* CLI Tool (macOS only) */}
      {(cli.loaded && cli.status?.supported) || cli.error ? (
        <>
          <div className="border-t border-border border-dashed" />

          <section className="pb-2">
            <h2 className="text-xl font-medium mb-0.5">CLI Tool</h2>
            <p className="text-sm text-text-muted mb-4">
              Open notes from the terminal with the{" "}
              <code className="font-mono text-xs bg-bg-muted px-1.5 py-0.5 rounded">
                scratch
              </code>{" "}
              command
            </p>

            {cli.error ? (
              <div className="bg-red-500/10 border border-red-500/20 rounded-md p-3">
                <p className="text-sm text-red-500">
                  Failed to check CLI status. Please restart the app.
                </p>
              </div>
            ) : cli.status === null ? (
              <div className="rounded-[10px] border border-border p-4 flex items-center justify-center">
                <SpinnerIcon className="w-4.5 h-4.5 stroke-[1.5] animate-spin text-text-muted" />
              </div>
            ) : cli.status.installed ? (
              <>
                <div className="rounded-[10px] border border-border p-4 space-y-3 mb-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text font-medium">
                      Status
                    </span>
                    <span className="text-sm text-text-muted">Installed</span>
                  </div>
                  {cli.status.path && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text font-medium">
                        Path
                      </span>
                      <button
                        type="button"
                        className="text-xs font-mono text-text-muted bg-bg-muted px-2 py-0.5 rounded max-w-48 truncate cursor-pointer hover:bg-bg-hover transition-colors"
                        title="Click to copy path"
                        onClick={async () => {
                          try {
                            await invoke("copy_to_clipboard", { text: cli.status!.path! });
                            toast.success("Path copied to clipboard");
                          } catch {
                            toast.error("Failed to copy path");
                          }
                        }}
                      >
                        {cli.status.path}
                      </button>
                    </div>
                  )}
                  <div className="pt-3 border-t border-border border-dashed">
                    <CliUsageHint />
                  </div>
                </div>
                <Button
                  onClick={handleUninstallCli}
                  disabled={cli.operating}
                  variant="outline"
                  size="md"
                >
                  {cli.operating ? (
                    <>
                      <SpinnerIcon className="w-3.25 h-3.25 mr-2 animate-spin" />
                      Uninstalling...
                    </>
                  ) : (
                    "Uninstall CLI Tool"
                  )}
                </Button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2.5 p-2.5 rounded-[10px] border border-border bg-bg-secondary mb-2.5">
                  <CliUsageHint />
                </div>
                <Button
                  onClick={handleInstallCli}
                  disabled={cli.operating}
                  variant="outline"
                  size="md"
                >
                  {cli.operating ? (
                    <>
                      <SpinnerIcon className="w-3.25 h-3.25 mr-2 animate-spin" />
                      Installing...
                    </>
                  ) : (
                    "Install CLI Tool"
                  )}
                </Button>
              </>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
