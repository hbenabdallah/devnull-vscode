import { DeviceKey, signedHeaders } from './signing';

export type Author = { handle: string; name: string };

export type Commit = {
    id: string;
    short_hash: string;
    html_url: string;
    status?: string;
};

export class ApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}

/**
 * A client of the /dev/null API that signs every request with the device key.
 */
export class DevNullClient {
    constructor(
        readonly baseUrl: string,
        private readonly key: DeviceKey,
        private readonly fetcher: typeof fetch = fetch,
    ) {}

    /**
     * Redeems the code the web sent back after the device was approved, which makes the key a device of the user.
     */
    async approveDevice(code: string, verifier: string): Promise<Author> {
        return this.request<Author>('POST', '/api/v1/devices', { code, code_verifier: verifier });
    }

    async me(): Promise<Author> {
        return this.request<Author>('GET', '/api/v1/me');
    }

    async commit(body: string): Promise<Commit> {
        return this.request<Commit>('POST', '/api/v1/commits', { body });
    }

    private async request<T>(method: string, path: string, payload?: unknown): Promise<T> {
        const body = payload === undefined ? '' : JSON.stringify(payload);
        const response = await this.fetcher(new URL(path, this.baseUrl), {
            method,
            headers: {
                Accept: 'application/json',
                ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
                ...signedHeaders(this.key, method, path, body),
            },
            body: payload === undefined ? undefined : body,
        });

        const json = (await response.json().catch(() => null)) as { data?: T; message?: string; errors?: Record<string, string[]> } | null;

        if (!response.ok) {
            const firstError = json?.errors === undefined ? undefined : Object.values(json.errors)[0]?.[0];

            throw new ApiError(firstError ?? json?.message ?? `/dev/null answered ${response.status}.`, response.status);
        }

        return (json?.data ?? json) as T;
    }
}
