import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { Encoder } from "cbor-x";

const { encode } = new Encoder({ useRecords: false, mapsAsObjects: false, useTag259ForMaps: false, tagUint8Array: false });

const digest = (value) => createHash("sha256").update(value).digest();
const b64 = (value) => Buffer.from(value).toString("base64url");

export function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const id = randomBytes(32);
  let userHandle;
  let counter = 0;
  return {
    register(options, origin = "http://localhost:8766") {
      userHandle = options.user.id;
      const client = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin, crossOrigin: false }));
      const cose = encode(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]));
      const length = Buffer.alloc(2); length.writeUInt16BE(id.length);
      const authData = Buffer.concat([digest(options.rp.id), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), length, id, cose]);
      return { id: b64(id), rawId: b64(id), type: "public-key", response: { clientDataJSON: b64(client), attestationObject: b64(encode(new Map([["fmt", "none"], ["authData", authData], ["attStmt", new Map()]]))), transports: ["internal"] }, clientExtensionResults: {} };
    },
    login(options, origin = "http://localhost:8766") {
      const client = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin, crossOrigin: false }));
      const count = Buffer.alloc(4); count.writeUInt32BE(++counter);
      const authData = Buffer.concat([digest(options.rpId), Buffer.from([0x05]), count]);
      const signature = sign("sha256", Buffer.concat([authData, digest(client)]), privateKey);
      return { id: b64(id), rawId: b64(id), type: "public-key", response: { clientDataJSON: b64(client), authenticatorData: b64(authData), signature: b64(signature), userHandle }, clientExtensionResults: {} };
    },
  };
}
