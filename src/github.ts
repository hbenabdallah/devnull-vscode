/**
 * The GitHub link to lines of a file at a commit, when the remote is on GitHub.
 */
export function gitHubPermalink(remoteUrl: string, commit: string, path: string, startLine: number, endLine: number): string | null {
    const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(remoteUrl.trim());

    if (match === null || !/^[0-9a-f]{40}$/.test(commit)) {
        return null;
    }

    const lines = startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`;
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');

    return `https://github.com/${match[1]}/${match[2]}/blob/${commit}/${encodedPath}#${lines}`;
}
