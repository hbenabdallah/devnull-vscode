import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, KeyObject, randomBytes, sign } from 'node:crypto';

/**
 * Requests to the /dev/null API are signed with an Ed25519 key kept by the extension, in the SSHSIG format
 * `ssh-keygen -Y sign` produces, so the key never leaves the machine and there is no token to leak.
 */
export const ApiNamespace = 'devnull-api';

function sshString(value: Buffer | string): Buffer {
    const bytes = typeof value === 'string' ? Buffer.from(value) : value;
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);

    return Buffer.concat([length, bytes]);
}

function base64Url(bytes: Buffer): string {
    return bytes.toString('base64url');
}

export class DeviceKey {
    private constructor(private readonly privateKey: KeyObject) {}

    static generate(): DeviceKey {
        return new DeviceKey(generateKeyPairSync('ed25519').privateKey);
    }

    static fromPem(pem: string): DeviceKey {
        return new DeviceKey(createPrivateKey(pem));
    }

    toPem(): string {
        return this.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    }

    /**
     * The public key as SSH writes it: its type, then its 32 bytes.
     */
    publicKeyBlob(): Buffer {
        const jwk = createPublicKey(this.privateKey).export({ format: 'jwk' });

        return Buffer.concat([sshString('ssh-ed25519'), sshString(Buffer.from(jwk.x ?? '', 'base64url'))]);
    }

    /**
     * The fingerprint the web shows when approving the device, as `ssh-keygen -l` prints it.
     */
    fingerprint(): string {
        return `SHA256:${createHash('sha256').update(this.publicKeyBlob()).digest('base64').replace(/=+$/, '')}`;
    }

    /**
     * The message signed in the given namespace, as the base64 body of an SSH signature.
     */
    sign(message: string, namespace = ApiNamespace): string {
        const hash = createHash('sha512').update(message).digest();
        const signedData = Buffer.concat([
            Buffer.from('SSHSIG'),
            sshString(namespace),
            sshString(''),
            sshString('sha512'),
            sshString(hash),
        ]);
        const signature = Buffer.concat([sshString('ssh-ed25519'), sshString(sign(null, signedData, this.privateKey))]);
        const version = Buffer.alloc(4);
        version.writeUInt32BE(1);

        return Buffer.concat([
            Buffer.from('SSHSIG'),
            version,
            sshString(this.publicKeyBlob()),
            sshString(namespace),
            sshString(''),
            sshString('sha512'),
            sshString(signature),
        ]).toString('base64');
    }
}

/**
 * The headers of a signed request. The path includes the query, and the body is the exact JSON sent, or empty.
 */
export function signedHeaders(
    key: DeviceKey,
    method: string,
    path: string,
    body: string,
    now: Date = new Date(),
): Record<string, string> {
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const nonce = randomBytes(16).toString('hex');

    return {
        'X-Devnull-Timestamp': timestamp,
        'X-Devnull-Nonce': nonce,
        'X-SSH-Signature': key.sign([timestamp, nonce, method.toUpperCase(), path, body].join('\n')),
    };
}

/**
 * A PKCE verifier and its S256 challenge, for exchanging the sign-in code for a device.
 */
export function pkce(): { verifier: string; challenge: string } {
    const verifier = base64Url(randomBytes(32));

    return { verifier, challenge: base64Url(createHash('sha256').update(verifier).digest()) };
}
