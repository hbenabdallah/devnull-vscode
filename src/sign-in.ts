import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostname } from 'node:os';
import { type Author, DevNullClient } from './client';
import { DeviceKey, pkce } from './signing';

const TimeoutMs = 5 * 60_000;

const page = (title: string, text: string): string =>
    `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:ui-monospace,monospace;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><p>${text}</p></body>`;

/**
 * Signs in like the /dev/null command line does: a new key is approved on the web as a device, which sends a one-time
 * code back to a port on the loopback address, and the code is exchanged for the device with the PKCE verifier.
 */
export async function signIn(
    baseUrl: string,
    openBrowser: (url: string) => Promise<unknown>,
    deviceName = `VS Code on ${hostname()}`,
): Promise<{ key: DeviceKey; author: Author }> {
    const key = DeviceKey.generate();
    const { verifier, challenge } = pkce();
    const state = randomBytes(16).toString('hex');

    const code = await new Promise<string>((resolve, reject) => {
        const server = createServer((request, response) => {
            const url = new URL(request.url ?? '/', 'http://127.0.0.1');

            if (url.pathname !== '/callback') {
                response.writeHead(404).end();

                return;
            }

            const finish = (error: Error | null, value?: string) => {
                clearTimeout(timeout);
                server.close();
                error === null ? resolve(value ?? '') : reject(error);
            };

            if (url.searchParams.get('state') !== state) {
                response.writeHead(400, { 'Content-Type': 'text/html' }).end(page('/dev/null', 'This sign-in was not started here.'));

                return;
            }

            const received = url.searchParams.get('code');

            if (received === null) {
                response.writeHead(200, { 'Content-Type': 'text/html' }).end(page('/dev/null', 'Sign-in cancelled. You can close this tab.'));
                finish(new Error('Sign-in was cancelled.'));

                return;
            }

            response.writeHead(200, { 'Content-Type': 'text/html' }).end(page('/dev/null', 'Signed in. You can close this tab and go back to VS Code.'));
            finish(null, received);
        });

        const timeout = setTimeout(() => {
            server.close();
            reject(new Error('Sign-in timed out.'));
        }, TimeoutMs);

        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as AddressInfo;
            const url = new URL('/mobile/authorize', baseUrl);
            url.search = new URLSearchParams({
                fingerprint: key.fingerprint(),
                device_name: deviceName.slice(0, 100),
                code_challenge: challenge,
                code_challenge_method: 'S256',
                state,
                redirect_uri: `http://127.0.0.1:${port}/callback`,
            }).toString();

            openBrowser(url.toString()).catch(reject);
        });
    });

    const author = await new DevNullClient(baseUrl, key).approveDevice(code, verifier);

    return { key, author };
}
