import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  SpinnerIcon,
  ClaudeIcon,
  CodexIcon,
  OpenCodeIcon,
  OllamaIcon,
} from "../icons";
import {
  aiTransformSelection,
  getAvailableAiProviders,
  type AiProvider,
} from "../../services/ai";
import type { Settings } from "../../types/note";
import { DEFAULT_AI_PRESETS, type AiPreset } from "./presets";

interface AiSelectionModalProps {
  open: boolean;
  selectedText: string;
  onClose: () => void;
  onApply: (text: string) => void;
}

function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/Thinking\.\.\.[\s\S]*?\.\.\.done thinking\./gi, "")
    .trim();
}

export function AiSelectionModal({
  open,
  selectedText,
  onClose,
  onApply,
}: AiSelectionModalProps) {
  const [provider, setProvider] = useState<AiProvider | null>(null);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [model, setModel] = useState<string>("");
  const [guidance, setGuidance] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<AiPreset[]>(DEFAULT_AI_PRESETS);
  const inputRef = useRef<HTMLInputElement>(null);

  const ProviderIcon =
    provider === "codex"
      ? CodexIcon
      : provider === "opencode"
        ? OpenCodeIcon
        : provider === "ollama"
          ? OllamaIcon
          : ClaudeIcon;
  const providerName =
    provider === "codex"
      ? "Codex"
      : provider === "opencode"
        ? "OpenCode"
        : provider === "ollama"
          ? "Ollama"
          : "Claude";

  useEffect(() => {
    if (!open) return;
    setLoadingProviders(true);
    Promise.all([getAvailableAiProviders(), invoke<Settings>("get_settings")])
      .then(([providers, settings]) => {
        const preferred = settings.defaultAiProvider;
        setProvider(
          preferred && providers.includes(preferred)
            ? preferred
            : (providers[0] ?? null),
        );
        setPresets(
          settings.aiSelectionPresets?.length
            ? settings.aiSelectionPresets
            : DEFAULT_AI_PRESETS,
        );
      })
      .catch(() => setProvider(null))
      .finally(() => setLoadingProviders(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    invoke<Settings>("get_settings")
      .then((settings) => {
        if (provider === "ollama")
          setModel(settings.ollamaModel || "qwen3:8b");
        else if (provider === "opencode")
          setModel(settings.opencodeModel || "");
        else setModel("");
      })
      .catch(() => {});
  }, [open, provider]);

  useEffect(() => {
    if (!open) {
      setGuidance("");
      setError(null);
      return;
    }
    const focus = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(focus);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open, onClose]);

  const run = async (instruction: string) => {
    const trimmed = instruction.trim();
    if (!provider || isRunning || !trimmed) return;

    setError(null);
    setIsRunning(true);
    try {
      const result = await aiTransformSelection(
        provider,
        selectedText,
        trimmed,
        model || undefined,
      );
      if (result.success) {
        const cleaned = stripThinking(result.output);
        if (cleaned) {
          onApply(cleaned);
        } else {
          setError("The AI returned an empty result.");
        }
      } else {
        setError(result.error || "The AI request failed. Please try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The AI request failed.");
    } finally {
      setIsRunning(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      run(guidance);
    }
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-text/50 backdrop-blur-sm z-40 animate-fade-in"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center py-11 px-4 pointer-events-none">
        <div className="relative w-full max-w-2xl bg-bg rounded-xl shadow-2xl overflow-hidden border border-border animate-slide-down pointer-events-auto">
          <div className="border-b border-border">
            <div className="flex items-center gap-3 px-4.5 py-3.5">
              <ProviderIcon className="w-5 h-5 text-text-muted" />
              <input
                ref={inputRef}
                type="text"
                value={guidance}
                onChange={(e) => {
                  setGuidance(e.target.value);
                  setError(null);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Tell the AI how to edit the selection..."
                disabled={isRunning || (!loadingProviders && !provider)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="flex-1 text-[17px] bg-transparent outline-none text-text placeholder-text-muted/50 disabled:opacity-50"
              />
            </div>
          </div>

          <div className="p-4.5 space-y-3">
            {loadingProviders ? (
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <SpinnerIcon className="w-4 h-4 animate-spin" />
                <span>Detecting AI providers...</span>
              </div>
            ) : !provider ? (
              <div className="text-sm p-3 bg-orange-500/10 rounded-md text-orange-700 dark:text-orange-400">
                No AI provider installed. Add one from Settings to use this
                feature.
              </div>
            ) : isRunning ? (
              <div className="py-1">
                <span className="text-shimmer text-sm font-medium">
                  {providerName} is editing your selection...
                </span>
              </div>
            ) : (
              <>
                {error && (
                  <div className="text-sm p-3 bg-red-500/10 rounded-md text-red-500">
                    {error}
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {presets
                    .filter((p) => p.label.trim() && p.instruction.trim())
                    .map((preset, i) => (
                      <button
                        key={`${preset.label}-${i}`}
                        onClick={() => {
                          setGuidance(preset.instruction);
                          run(preset.instruction);
                        }}
                        disabled={isRunning}
                        className="px-2.5 py-1 text-sm rounded-md bg-bg-muted text-text hover:bg-bg-emphasis disabled:opacity-50 transition-colors"
                      >
                        {preset.label}
                      </button>
                    ))}
                </div>

                <div className="text-sm text-text-muted line-clamp-3 p-3 bg-bg-muted rounded-md">
                  {selectedText}
                </div>

                <div className="w-full flex justify-between">
                  <div className="flex items-center gap-1.5 text-sm text-text-muted">
                    <kbd className="text-xs px-1.5 py-0.5 rounded-md bg-bg-muted text-text-muted">
                      Esc
                    </kbd>
                    <span>to close</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm text-text-muted">
                    <kbd className="text-xs px-1.5 py-0.5 rounded-md bg-bg-muted text-text-muted">
                      Enter
                    </kbd>
                    <span>to submit</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
