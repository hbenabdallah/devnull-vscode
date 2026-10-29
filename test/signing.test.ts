import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { test } from 'node:test';
import { DeviceKey, pkce, signedHeaders } from '../src/signing';

function readString(buffer: Buffer, offset: number): [Buffer, number] {
    const length = buffer.readUInt32BE(offset);

    return [buffer.subarray(offset + 4, offset + 4 + length), offset + 4 + length];
}

test('has the fingerprint the web asks to approve, and survives being stored', () => {
    const key = DeviceKey.generate();

    assert.match(key.fingerprint(), /^SHA256:[A-Za-z0-9+/]{43}$/);
    assert.equal(DeviceKey.fromPem(key.toPem()).fingerprint(), key.fingerprint());
});

test('signs in the SSHSIG format, over the namespace and the SHA-512 of the message', () => {
    const key = DeviceKey.generate();
    const blob = Buffer.from(key.sign('hello', 'devnull-api'), 'base64');

    assert.equal(blob.subarray(0, 6).toString(), 'SSHSIG');
    assert.equal(blob.readUInt32BE(6), 1);
    let offset = 10;
    const fields: Buffer[] = [];
    for (let i = 0; i < 5; i++) {
        const [field, next] = readString(blob, offset);
        fields.push(field);
        offset = next;
    }
    const [publicKey, namespace, reserved, algorithm, signature] = fields;
    assert.deepEqual(publicKey, key.publicKeyBlob());
    assert.equal(namespace.toString(), 'devnull-api');
    assert.equal(reserved.length, 0);
    assert.equal(algorithm.toString(), 'sha512');

    const [type, afterType] = readString(signature, 0);
    const [raw] = readString(signature, afterType);
    assert.equal(type.toString(), 'ssh-ed25519');

    const pack = (value: Buffer | string) => {
        const bytes = Buffer.from(value);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(bytes.length);
        return Buffer.concat([length, bytes]);
    };
    const signed = Buffer.concat([Buffer.from('SSHSIG'), pack('devnull-api'), pack(''), pack('sha512'), pack(createHash('sha512').update('hello').digest())]);
    const [, afterKeyType] = readString(publicKey, 0);
    const [rawPublicKey] = readString(publicKey, afterKeyType);
    const verifier = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: rawPublicKey.toString('base64url') }, format: 'jwk' });

    assert.ok(verify(null, signed, verifier, raw));
});

test('signs the timestamp, nonce, method, path and body of a request', () => {
    const headers = signedHeaders(DeviceKey.generate(), 'post', '/api/v1/commits', '{"body":"hi"}', new Date('2026-10-29T12:00:00Z'));

    assert.equal(headers['X-Devnull-Timestamp'], '1793275200');
    assert.match(headers['X-Devnull-Nonce'], /^[0-9a-f]{32}$/);
    assert.ok(headers['X-SSH-Signature'].length > 100);
});

test('makes a PKCE verifier and challenge the web takes', () => {
    const { verifier, challenge } = pkce();

    assert.match(verifier, /^[A-Za-z0-9._~-]{43,128}$/);
    assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
});
