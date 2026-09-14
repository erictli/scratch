import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ClaudeIcon,
  CodexIcon,
  OpenCodeIcon,
  OllamaIcon,
  XIcon,
  CheckIcon,
  ArrowUpIcon,
  SpinnerIcon,
} from "../icons";
import {
  Button,
  IconButton,
  Input,
  Select,
  TextEffect,
  TextScramble,
  TextShimmer,
  Tooltip,
} from "../ui";
import type { SelectProps } from "../ui/Select";
import { cn } from "../../lib/utils";
import {
  AI_PROVIDER_LABELS,
  AI_PROVIDER_MODELS,
  AI_PROVIDER_ORDER,
  DEFAULT_AI_EFFORT,
  DEFAULT_AI_MODELS,
  supportsEffort,
  getAvailableAiProviders,
  type AiEffort,
  type AiExecutionResult,
  type AiProvider,
} from "../../services/ai";
import type { Settings } from "../../types/note";
import {
  onAiStreamLine,
  parseStreamLine,
  supportsStreaming,
  type AiStreamEvent,
} from "../../services/aiStream";
import { parseMarkdown } from "./markdown";

interface AiSidebarProps {
  open: boolean;
  provider: AiProvider;
  noteTitle?: string;
  /** Identifies the open note, so the title only re-scrambles on a switch. */
  noteId?: string;
  onProviderChange: (provider: AiProvider) => void;
  onClose: () => void;
  onExecute: (
    prompt: string,
    runId: string,
    model: string | undefined,
    effort: AiEffort | undefined,
  ) => Promise<AiExecutionResult | null>;
  isExecuting: boolean;
}

type RunStatus = "running" | "done" | "error";

// A step is one thing the agent did: a line of prose, or a tool call.
type Step =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; detail: string };

interface Run {
  id: string;
  prompt: string;
  provider: AiProvider;
  model: string;
  status: RunStatus;
  steps: Step[];
  output: string;
  error: string | null;
}

const providerIcons: Record<AiProvider, typeof ClaudeIcon> = {
  claude: ClaudeIcon,
  codex: CodexIcon,
  opencode: OpenCodeIcon,
  ollama: OllamaIcon,
};

function ToolStep({ step }: { step: { name: string; detail: string } }) {
  const chip = (
    <div className="flex items-center gap-1.5 text-xs text-text-muted min-w-0">
      <span className="font-medium text-text/80 shrink-0">{step.name}</span>
      {step.detail && (
        <span className="font-mono truncate text-text-muted/80">{step.detail}</span>
      )}
    </div>
  );

  return step.detail.length > 40 ? (
    <Tooltip content={step.detail}>{chip}</Tooltip>
  ) : (
    chip
  );
}

// A bare spinner reads as "hung" on runs that can take minutes, so show
// elapsed time as proof the process is still alive.
function ElapsedTime() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(id);
  }, []);

  return <span className="tabular-nums text-text-muted/70">{elapsed}s</span>;
}

// Each run is an independent CLI invocation with no memory of the previous
// one, so runs are shown as a timeline rather than a threaded conversation.
function RunCard({ run }: { run: Run }) {
  const Icon = providerIcons[run.provider];
  const running = run.status === "running";

  return (
    <div className="space-y-2">
      <div className="rounded-lg bg-bg-muted px-3 py-2 text-sm text-text whitespace-pre-wrap break-words">
        {run.prompt}
      </div>

      <div className="flex gap-2.5 px-0.5">
        <Icon
          className={`w-4 h-4 shrink-0 mt-0.5 text-text-muted ${
            running ? "animate-spin-slow" : ""
          }`}
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          {run.steps.map((step, index) =>
            step.kind === "tool" ? (
              <ToolStep key={index} step={step} />
            ) : (
              <div key={index} className="text-text-muted">
                {parseMarkdown(step.text)}
              </div>
            ),
          )}

          {running && (
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <TextShimmer>
                {`${AI_PROVIDER_LABELS[run.provider]}${
                  run.model ? ` · ${run.model}` : ""
                } is working…`}
              </TextShimmer>
              <ElapsedTime />
            </div>
          )}

          {run.status === "error" && (
            <p className="text-xs text-red-500">
              {run.error || "Something went wrong"}
            </p>
          )}

          {run.status === "done" && (
            <div className="text-text-muted">
              {run.steps.length === 0 && run.output.trim() ? (
                parseMarkdown(run.output)
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-text-muted/70 pt-0.5">
                  <CheckIcon className="w-3.5 h-3.5" />
                  Done
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Compact in-composer dropdown: a native <select> stripped down to a pill, so
// keyboard and accessibility behaviour come for free.
function PickerSelect({
  icon,
  className,
  children,
  ...props
}: SelectProps & { icon?: ReactNode }) {
  return (
    <div className="flex items-center gap-1 min-w-0 rounded-md hover:bg-bg-muted transition-colors">
      {icon && <span className="pl-1.5 flex items-center">{icon}</span>}
      <Select
        {...props}
        className={cn(
          "h-7 w-auto max-w-40 border-0 bg-transparent py-0 pl-1.5 pr-6 text-xs leading-none text-text-muted hover:text-text focus:outline-none",
          icon && "pl-0",
          className,
        )}
      >
        {children}
      </Select>
    </div>
  );
}

// Sentinel option that swaps the model dropdown for a free-text field, so a
// model that postdates AI_PROVIDER_MODELS is still reachable.
const CUSTOM_MODEL_VALUE = "__custom__";

function defaultModelFor(provider: AiProvider): string {
  return DEFAULT_AI_MODELS[provider];
}

export function AiSidebar({
  open,
  provider,
  noteTitle,
  noteId,
  onProviderChange,
  onClose,
  onExecute,
  isExecuting,
}: AiSidebarProps) {
  const [prompt, setPrompt] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [models, setModels] = useState<Partial<Record<AiProvider, string>>>({});
  const [installed, setInstalled] = useState<AiProvider[] | null>(null);
  const [customModelOpen, setCustomModelOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const Icon = providerIcons[provider];

  useEffect(() => {
    if (open && !isExecuting) inputRef.current?.focus();
  }, [open, isExecuting]);

  // Which harnesses are actually on this machine. Uninstalled ones stay in the
  // picker but are disabled, so the list explains itself rather than hiding.
  useEffect(() => {
    if (!open) return;
    let active = true;
    getAvailableAiProviders()
      .then((providers) => active && setInstalled(providers))
      .catch(() => active && setInstalled([]));
    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    invoke<Settings>("get_settings")
      .then((settings) => {
        if (!active) return;
        const stored: Partial<Record<AiProvider, string>> = {
          ...(settings.aiModels as Partial<Record<AiProvider, string>>),
        };
        // Pre-dates per-harness models: carry the standalone Ollama model over.
        if (settings.ollamaModel && !stored.ollama) stored.ollama = settings.ollamaModel;
        setModels(stored);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open]);

  // Close the custom-model field when switching harness; it belongs to one list.
  useEffect(() => setCustomModelOpen(false), [provider]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [runs]);

  const model = models[provider] ?? defaultModelFor(provider);

  const modelOptions = useMemo(() => {
    const options = [...AI_PROVIDER_MODELS[provider]];
    // A custom or previously saved model keeps its own entry so it stays visible.
    if (model && !options.some((option) => option.id === model)) {
      options.push({ id: model, label: model });
    }
    return options;
  }, [provider, model]);

  const selectModel = useCallback(
    (next: string) => {
      const updated = { ...models, [provider]: next };
      setModels(updated);
      invoke<Settings>("get_settings")
        .then((settings) =>
          invoke("update_settings", {
            newSettings: { ...settings, aiModels: updated },
          }),
        )
        .catch(() => {});
    },
    [models, provider],
  );

  if (!open) return null;

  const appendStep = (runId: string, event: AiStreamEvent) => {
    if (event.kind === "done") return;
    setRuns((current) =>
      current.map((run) =>
        run.id === runId
          ? {
              ...run,
              steps: [
                ...run.steps,
                event.kind === "tool"
                  ? { kind: "tool" as const, name: event.name, detail: event.detail }
                  : { kind: "text" as const, text: event.text },
              ],
            }
          : run,
      ),
    );
  };

  const submit = async () => {
    const value = prompt.trim();
    if (!value || isExecuting) return;

    const runId = crypto.randomUUID();
    const runProvider = provider;
    const runModel = model;
    // Effort isn't exposed in the UI; medium suits note-sized work.
    const runEffort = supportsEffort(runProvider) ? DEFAULT_AI_EFFORT : null;
    setPrompt("");
    setRuns((current) => [
      ...current,
      {
        id: runId,
        prompt: value,
        provider: runProvider,
        model: runModel,
        status: "running",
        steps: [],
        output: "",
        error: null,
      },
    ]);

    const unlisten = supportsStreaming(runProvider)
      ? await onAiStreamLine(runId, (line) => {
          for (const event of parseStreamLine(runProvider, line)) {
            appendStep(runId, event);
          }
        })
      : undefined;

    try {
      const result = await onExecute(
        value,
        runId,
        runModel || undefined,
        runEffort ?? undefined,
      );
      setRuns((current) =>
        current.map((run) =>
          run.id === runId
            ? {
                ...run,
                status: result?.success ? "done" : "error",
                output: result?.output ?? "",
                error: result?.error ?? "Run failed",
              }
            : run,
        ),
      );
    } finally {
      unlisten?.();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <aside
      className="w-90 shrink-0 border-l border-border bg-bg-secondary flex flex-col min-h-0"
      aria-label="AI assistant"
    >
      <header className="h-11 shrink-0 border-b border-border flex items-center justify-between px-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="w-4.5 h-4.5 shrink-0 stroke-[1.5] text-text-muted" />
          <span className="text-sm font-medium text-text">Assistant</span>
          {noteTitle && (
            <span className="text-xs text-text-muted truncate">
              ·{" "}
              <TextScramble trigger={noteId}>{noteTitle}</TextScramble>
            </span>
          )}
        </div>
        <div className="flex items-center gap-px shrink-0">
          {runs.length > 0 && (
            <Button
              variant="link"
              size="xs"
              onClick={() => setRuns([])}
              disabled={isExecuting}
              className="text-xs"
            >
              Clear
            </Button>
          )}
          <IconButton onClick={onClose} title="Close AI assistant">
            <XIcon className="w-4 h-4" />
          </IconButton>
        </div>
      </header>

      <div
        ref={transcriptRef}
        className="flex-1 min-h-0 overflow-y-auto scrollbar-minimal p-3 space-y-5"
      >
        {runs.length === 0 ? (
          <TextEffect className="text-sm text-text-muted px-1 pt-1">
            Ask an agent to edit this note.
          </TextEffect>
        ) : (
          runs.map((run) => <RunCard key={run.id} run={run} />)
        )}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <div className="rounded-lg border border-border bg-bg focus-within:border-text-muted/50 transition-colors">
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            disabled={isExecuting}
            placeholder="What should the agent do?"
            className="w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-sm text-text placeholder:text-text-muted/70 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />

          <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 px-1.5 pb-1.5">
            <PickerSelect
              aria-label="Agent harness"
              value={provider}
              onChange={(event) =>
                onProviderChange(event.target.value as AiProvider)
              }
              disabled={isExecuting}
              icon={<Icon className="w-3.5 h-3.5 shrink-0 text-text-muted" />}
            >
              {AI_PROVIDER_ORDER.map((item) => {
                const missing = installed !== null && !installed.includes(item);
                return (
                  <option key={item} value={item} disabled={missing}>
                    {AI_PROVIDER_LABELS[item]}
                    {missing ? " (not installed)" : ""}
                  </option>
                );
              })}
            </PickerSelect>

            {customModelOpen ? (
              <Input
                autoFocus
                aria-label="Custom model"
                defaultValue={model}
                placeholder="model name"
                disabled={isExecuting}
                onBlur={(event) => {
                  selectModel(event.target.value.trim());
                  setCustomModelOpen(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setCustomModelOpen(false);
                  }
                }}
                className="h-7 flex-1 min-w-0 px-2 text-xs"
              />
            ) : (
              <PickerSelect
                aria-label="Model"
                value={model}
                onChange={(event) => {
                  if (event.target.value === CUSTOM_MODEL_VALUE) {
                    setCustomModelOpen(true);
                    return;
                  }
                  selectModel(event.target.value);
                }}
                disabled={isExecuting}
              >
                {modelOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
                <option value={CUSTOM_MODEL_VALUE}>Custom…</option>
              </PickerSelect>
            )}

            <div className="flex-1" />

            <IconButton
              variant="primary"
              size="sm"
              title={isExecuting ? "Running…" : "Run agent (⌘↵)"}
              onClick={() => void submit()}
              disabled={!prompt.trim() || isExecuting}
            >
              {isExecuting ? (
                <SpinnerIcon className="w-3.5 h-3.5" />
              ) : (
                <ArrowUpIcon className="w-4 h-4" />
              )}
            </IconButton>
          </div>
        </div>
      </div>
    </aside>
  );
}
