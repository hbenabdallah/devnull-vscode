import * as path from 'node:path';
import * as vscode from 'vscode';
import { selectionBody, MaxBodyLength, type Selection } from './body';
import { ApiError, DevNullClient } from './client';
import { gitHubPermalink } from './github';
import { signIn } from './sign-in';
import { DeviceKey } from './signing';

const KeySecret = 'devnull.key';
const AccountState = 'devnull.account';

type Account = { url: string; handle: string };

function siteUrl(): string {
    return vscode.workspace.getConfiguration('devnull').get<string>('url', 'https://dev-null.sh').replace(/\/+$/, '');
}

export function activate(context: vscode.ExtensionContext): void {
    const account = (): Account | undefined => context.globalState.get<Account>(AccountState);

    // The key belongs to one site, so switching devnull.url asks for a new sign-in.
    const client = async (): Promise<DevNullClient | null> => {
        const pem = await context.secrets.get(KeySecret);

        return pem !== undefined && account()?.url === siteUrl() ? new DevNullClient(siteUrl(), DeviceKey.fromPem(pem)) : null;
    };

    const forget = async () => {
        await context.secrets.delete(KeySecret);
        await context.globalState.update(AccountState, undefined);
    };

    const runSignIn = async (): Promise<DevNullClient | null> => {
        try {
            const { key, author } = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: '/dev/null: approve VS Code in your browser…' },
                () => signIn(siteUrl(), (url) => Promise.resolve(vscode.env.openExternal(vscode.Uri.parse(url)))),
            );

            await context.secrets.store(KeySecret, key.toPem());
            await context.globalState.update(AccountState, { url: siteUrl(), handle: author.handle } satisfies Account);
            void vscode.window.showInformationMessage(`/dev/null: signed in as @${author.handle}.`);

            return new DevNullClient(siteUrl(), key);
        } catch (error) {
            void vscode.window.showErrorMessage(`/dev/null: ${error instanceof Error ? error.message : 'could not sign in.'}`);

            return null;
        }
    };

    const post = async (body: string): Promise<void> => {
        let signedIn = await client();

        if (signedIn === null) {
            const choice = await vscode.window.showInformationMessage('/dev/null: sign in to commit.', 'Sign In');
            signedIn = choice === 'Sign In' ? await runSignIn() : null;
        }

        if (signedIn === null) {
            return;
        }

        try {
            const commit = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: '/dev/null: committing…' },
                () => signedIn.commit(body),
            );
            const message = commit.status === 'pending'
                ? `/dev/null: committed ${commit.short_hash}. Everyone will see it once it is approved.`
                : `/dev/null: committed ${commit.short_hash}.`;

            if ((await vscode.window.showInformationMessage(message, 'Open')) === 'Open') {
                await vscode.env.openExternal(vscode.Uri.parse(commit.html_url));
            }
        } catch (error) {
            if (error instanceof ApiError && error.status === 401) {
                await forget();
                if ((await vscode.window.showErrorMessage('/dev/null: this device was revoked. Sign in again to commit.', 'Sign In')) === 'Sign In') {
                    await runSignIn();
                }

                return;
            }

            const choice = await vscode.window.showErrorMessage(
                `/dev/null: ${error instanceof Error ? error.message : 'could not commit.'}`,
                'Open /dev/null',
            );

            if (choice === 'Open /dev/null') {
                await vscode.env.openExternal(vscode.Uri.parse(siteUrl()));
            }
        }
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('devnull.signIn', runSignIn),

        vscode.commands.registerCommand('devnull.signOut', async () => {
            const handle = account()?.handle;
            await forget();

            const choice = await vscode.window.showInformationMessage(
                `/dev/null: signed out${handle === undefined ? '' : ` of @${handle}`}. Revoke this device in Settings → Devices to remove its key for good.`,
                'Open Devices',
            );

            if (choice === 'Open Devices') {
                await vscode.env.openExternal(vscode.Uri.parse(`${siteUrl()}/settings/devices`));
            }
        }),

        vscode.commands.registerCommand('devnull.commit', async () => {
            const body = await vscode.window.showInputBox({
                title: 'Commit to /dev/null',
                prompt: 'What are you working on?',
                validateInput: (value) => (value.length > MaxBodyLength ? `At most ${MaxBodyLength} characters.` : null),
            });

            if (body !== undefined && body.trim() !== '') {
                await post(body);
            }
        }),

        vscode.commands.registerCommand('devnull.commitSelection', async () => {
            const editor = vscode.window.activeTextEditor;

            if (editor === undefined || editor.selection.isEmpty) {
                return;
            }

            const selection = await selectionOf(editor);
            const message = await vscode.window.showInputBox({
                title: 'Commit selection to /dev/null',
                prompt: `Say something about ${selection.path} (optional)`,
            });

            if (message === undefined) {
                return;
            }

            const body = selectionBody(message, selection);

            if (body === null) {
                void vscode.window.showErrorMessage(`/dev/null: a commit holds at most ${MaxBodyLength} characters. Select fewer lines.`);

                return;
            }

            await post(body);
        }),
    );
}

type GitRepository = {
    rootUri: vscode.Uri;
    state: {
        HEAD?: { commit?: string; upstream?: unknown; ahead?: number };
        remotes: { name: string; fetchUrl?: string }[];
        workingTreeChanges: { uri: vscode.Uri }[];
        indexChanges: { uri: vscode.Uri }[];
    };
};

/**
 * The selected lines, with a GitHub link to them when they are exactly what is pushed.
 */
async function selectionOf(editor: vscode.TextEditor): Promise<Selection> {
    const { document, selection } = editor;
    const startLine = selection.start.line + 1;
    // A selection ending at the start of a line doesn't take that line.
    const endLine = selection.end.character === 0 && selection.end.line > selection.start.line ? selection.end.line : selection.end.line + 1;
    const range = new vscode.Range(startLine - 1, 0, endLine - 1, document.lineAt(endLine - 1).text.length);
    const repository = gitRepository(document.uri);
    const relativePath = repository === undefined
        ? vscode.workspace.asRelativePath(document.uri, false)
        : path.relative(repository.rootUri.fsPath, document.uri.fsPath).split(path.sep).join('/');

    return {
        code: document.getText(selection.isSingleLine ? selection : range),
        languageId: document.languageId,
        path: relativePath,
        startLine,
        endLine,
        permalink: repository === undefined ? null : permalinkFor(repository, document, relativePath, startLine, endLine),
    };
}

function gitRepository(uri: vscode.Uri): GitRepository | undefined {
    const git = vscode.extensions.getExtension<{ getAPI(version: 1): { getRepository(uri: vscode.Uri): GitRepository | null } }>('vscode.git');

    return git?.isActive ? git.exports.getAPI(1).getRepository(uri) ?? undefined : undefined;
}

function permalinkFor(repository: GitRepository, document: vscode.TextDocument, relativePath: string, startLine: number, endLine: number): string | null {
    const head = repository.state.HEAD;
    const isChanged = document.isDirty || [...repository.state.workingTreeChanges, ...repository.state.indexChanges]
        .some((change) => change.uri.fsPath === document.uri.fsPath);
    const remote = repository.state.remotes.find((candidate) => candidate.name === 'origin') ?? repository.state.remotes[0];

    if (!vscode.workspace.getConfiguration('devnull').get<boolean>('linkToGitHub', true)
        || isChanged || head?.commit === undefined || head.upstream === undefined || (head.ahead ?? 0) > 0 || remote?.fetchUrl === undefined) {
        return null;
    }

    return gitHubPermalink(remote.fetchUrl, head.commit, relativePath, startLine, endLine);
}

export function deactivate(): void {}
