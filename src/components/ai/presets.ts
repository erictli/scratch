export interface AiPreset {
  label: string;
  instruction: string;
}

export const DEFAULT_AI_PRESETS: AiPreset[] = [
  {
    label: "Fix grammar",
    instruction:
      "Fix spelling and grammar mistakes. Keep the meaning, tone, and language; change only what is incorrect.",
  },
  {
    label: "Summarize",
    instruction:
      "Summarize this into a concise version, keeping the key points and the original language.",
  },
  {
    label: "Rephrase",
    instruction:
      "Rephrase to improve clarity and flow while preserving the meaning and the original language.",
  },
];
