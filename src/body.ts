/**
 * The longest commit /dev/null takes.
 */
export const MaxBodyLength = 4000;

export type Selection = {
    code: string;
    languageId: string;
    path: string;
    startLine: number;
    endLine: number;
    permalink: string | null;
};

// VS Code names a few languages differently from the highlighter /dev/null uses.
const Languages: Record<string, string> = {
    javascriptreact: 'jsx',
    typescriptreact: 'tsx',
    shellscript: 'bash',
    plaintext: '',
};

/**
 * Leading indentation the selected lines share, which a block on its own doesn't need.
 */
function dedent(code: string): string {
    const lines = code.replace(/\s+$/, '').split('\n');
    const indents = lines.filter((line) => line.trim() !== '').map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0);
    const shared = indents.length === 0 ? 0 : Math.min(...indents);

    return lines.map((line) => line.slice(shared)).join('\n');
}

function fenceFor(code: string): string {
    const longest = Math.max(0, ...(code.match(/`{3,}/g) ?? []).map((run) => run.length));

    return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * A commit with the message, then the selected code as a fenced block titled with its path, then a link to the lines.
 * Null when it would be longer than /dev/null takes.
 */
export function selectionBody(message: string, selection: Selection): string | null {
    const code = dedent(selection.code);
    const fence = fenceFor(code);
    const language = Languages[selection.languageId] ?? selection.languageId;
    const lines = selection.startLine === selection.endLine ? `L${selection.startLine}` : `L${selection.startLine}-L${selection.endLine}`;
    const title = `${selection.path}#${lines}`.replace(/"/g, '');

    const body = [
        message.trim(),
        `${fence}${language} title="${title}"\n${code}\n${fence}`,
        selection.permalink ?? '',
    ]
        .filter((part) => part !== '')
        .join('\n\n');

    return body.length > MaxBodyLength ? null : body;
}
