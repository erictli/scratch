import { useMemo } from "react";
import { renderMermaidSVG } from "beautiful-mermaid";

interface MermaidRendererProps {
  code: string;
}

export function MermaidRenderer({ code }: MermaidRendererProps) {
  const { svg, error } = useMemo(() => {
    if (!code.trim()) return { svg: null, error: null };
    try {
      return {
        svg: renderMermaidSVG(code.trim(), {
          bg: "var(--color-bg)",
          fg: "var(--color-text)",
          muted: "var(--color-text-muted)",
          border: "var(--color-border-solid)",
          transparent: true,
        }),
        error: null,
      };
    } catch (err) {
      return {
        svg: null,
        error: err instanceof Error ? err.message : "Invalid mermaid syntax",
      };
    }
  }, [code]);

  if (error) {
    return (
      <div className="text-xs text-text-muted italic px-2 pt-6 pb-3 text-center">
        Mermaid syntax error
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="text-xs text-text-muted italic px-2 pt-6 pb-3 text-center">
        Empty mermaid diagram
      </div>
    );
  }

  return (
    <div
      className="mermaid-diagram flex justify-center py-2"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
