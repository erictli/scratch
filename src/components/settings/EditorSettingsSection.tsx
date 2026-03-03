import React, { useMemo } from 'react';
import { getHighlighterSync, normalizeLanguage } from 'src/lib/shiki';
import { useTheme } from 'context/ThemeContext'; // Assuming this exists for context

const EditorSettingsSection = () => {
    const { resolvedSyntaxTheme } = useTheme();
    const [highlighter, setHighlighter] = React.useState(null);

    // Initialize the highlighter
    if (!highlighter) {
        setHighlighter(getHighlighterSync());
    }

    // Update code block based on selected theme
    const codeString = `function acquireFood() { ... }`;

    const renderedCode = useMemo(() => {
        if (!highlighter) return codeString;

        const lang = 'javascript'; // Replace with dynamic language if needed
        const tokens = highlighter.codeToThemedTokens(codeString, lang, {
            theme: resolvedSyntaxTheme,
        });

        return (
            <pre>
                <code>
                    {tokens.map((line) => (
                        <span key={line[0].content} style={{ color: line[0].color, fontStyle: line[0].fontStyle }}>
                            {line.map(token => (
                                <span key={token.content} style={{ color: token.color, fontStyle: token.fontStyle }}>
                                    {token.content}
                                </span>
                            ))}
                        </span>
                    ))}
                </code>
            </pre>
        );
    }, [codeString, highlighter, resolvedSyntaxTheme]);

    return (
        <div className="editor-settings-section">
            {/* Preserve existing preview layout */}
            {renderedCode}
        </div>
    );
};

export default EditorSettingsSection;