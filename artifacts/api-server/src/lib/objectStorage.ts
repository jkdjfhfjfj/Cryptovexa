import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  chmod,
  link,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { File, Storage } from '@google-cloud/storage';

import {
  canAccessObject,
  getObjectAclPolicy,
  ObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
} from './objectAcl';

const REPLIT_SIDECAR_ENDPOINT = 'http://127.0.0.1:1106';
const LOCAL_UPLOAD_TTL_SECONDS = 900;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const objectStorageClient = new Storage({
  credentials: {
    audience: 'replit',
    subject_token_type: 'access_token',
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: 'external_account',
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: 'json',
        subject_token_field_name: 'access_token',
      },
    },
    universe_domain: 'googleapis.com',
  },
  projectId: '',
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super('Object not found');
    this.name = 'ObjectNotFoundError';
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

type StoredMetadata = {
  contentType?: string;
  metadata?: Record<string, string>;
};

class LocalStoredFile {
  readonly name: string;
  private readonly filePath: string;
  private readonly metadataPath: string;

  constructor(root: string, id: string) {
    this.name = id;
    this.filePath = join(root, id);
    this.metadataPath = join(root, `${id}.metadata.json`);
  }

  async exists(): Promise<[boolean]> {
    try {
      await stat(this.filePath);
      return [true];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [false];
      throw error;
    }
  }

  async getMetadata(): Promise<[Record<string, unknown>]> {
    const fileStat = await stat(this.filePath);
    const stored = await this.readStoredMetadata();
    return [{
      size: fileStat.size,
      contentType: stored.contentType,
      metadata: stored.metadata ?? {},
    }];
  }

  createReadStream() {
    return createReadStream(this.filePath);
  }

  async setContentType(contentType: string): Promise<void> {
    await this.saveStoredMetadata({ contentType, metadata: {} });
  }

  async setMetadata({
    metadata,
  }: {
    metadata: Record<string, string>;
  }): Promise<void> {
    const stored = await this.readStoredMetadata();
    await this.saveStoredMetadata({
      ...stored,
      metadata: { ...(stored.metadata ?? {}), ...metadata },
    });
  }

  async delete(options: { ignoreNotFound?: boolean } = {}): Promise<void> {
    try {
      await unlink(this.filePath);
      await unlink(this.metadataPath).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    } catch (error) {
      if (
        options.ignoreNotFound &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) return;
      throw error;
    }
  }

  private async readStoredMetadata(): Promise<StoredMetadata> {
    try {
      return JSON.parse(await readFile(this.metadataPath, 'utf8')) as StoredMetadata;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }

  private async saveStoredMetadata(value: StoredMetadata): Promise<void> {
    const temporaryPath = `${this.metadataPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(value), {
        flag: 'wx',
        mode: 0o600,
      });
      await rename(temporaryPath, this.metadataPath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}

export class ObjectStorageService {
  constructor() {}

  isLocalStorageEnabled(): boolean {
    return Boolean(process.env.LOCAL_OBJECT_STORAGE_DIR?.trim());
  }

  private getLocalObjectRoot(): string {
    const root = process.env.LOCAL_OBJECT_STORAGE_DIR?.trim();
    if (!root) throw new Error('LOCAL_OBJECT_STORAGE_DIR is not configured');
    return resolve(root);
  }

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || '';
    const paths = Array.from(
      new Set(
        pathsStr
          .split(',')
          .map((path) => path.trim())
          .filter((path) => path.length > 0),
      ),
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          'tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths).',
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || '';
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          'tool and set PRIVATE_OBJECT_DIR env var.',
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(
    file: File,
    cacheTtlSec: number = 3600,
  ): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === 'public';

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      'Content-Type':
        (metadata.contentType as string) || 'application/octet-stream',
      'Cache-Control': `${isPublic ? 'public' : 'private'}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers['Content-Length'] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL({
    origin,
    contentType,
    size,
  }: {
    origin?: string;
    contentType?: string;
    size?: number;
  } = {}): Promise<string> {
    if (this.isLocalStorageEnabled()) {
      if (!origin || !contentType || !Number.isSafeInteger(size) || !size) {
        throw new Error('Local upload requires origin, content type and size');
      }
      const objectId = randomUUID();
      const expires = Math.floor(Date.now() / 1000) + LOCAL_UPLOAD_TTL_SECONDS;
      const signature = signLocalUpload(objectId, expires, contentType, size);
      const uploadUrl = new URL(`/api/v1/uploads/local/${objectId}`, origin);
      uploadUrl.searchParams.set('expires', String(expires));
      uploadUrl.searchParams.set('contentType', contentType);
      uploadUrl.searchParams.set('size', String(size));
      uploadUrl.searchParams.set('signature', signature);
      return uploadUrl.toString();
    }

    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          'tool and set PRIVATE_OBJECT_DIR env var.',
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: 'PUT',
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith('/objects/')) {
      throw new ObjectNotFoundError();
    }

    if (this.isLocalStorageEnabled()) {
      const entityId = objectPath.slice('/objects/'.length);
      if (!UUID_PATTERN.test(entityId)) throw new ObjectNotFoundError();
      const localFile = new LocalStoredFile(this.getLocalObjectRoot(), entityId);
      const [exists] = await localFile.exists();
      if (!exists) throw new ObjectNotFoundError();
      return localFile as unknown as File;
    }

    const parts = objectPath.slice(1).split('/');
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join('/');
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith('/')) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (this.isLocalStorageEnabled()) {
      try {
        const url = new URL(rawPath);
        const match = url.pathname.match(
          /^\/api\/v1\/uploads\/local\/([0-9a-f-]{36})$/i,
        );
        if (match && UUID_PATTERN.test(match[1])) {
          return `/objects/${match[1]}`;
        }
      } catch {
        // Continue to the existing normalized/GCS path handling.
      }
    }

    if (!rawPath.startsWith('https://storage.googleapis.com/')) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith('/')) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async storeLocalUpload({
    objectId,
    expires,
    contentType,
    size,
    signature,
    requestContentType,
    stream,
  }: {
    objectId: string;
    expires: string;
    contentType: string;
    size: number;
    signature: string;
    requestContentType: string | undefined;
    stream: NodeJS.ReadableStream;
  }): Promise<'stored' | 'invalid' | 'expired' | 'forbidden' | 'size_mismatch' | 'exists' | 'unavailable'> {
    if (!this.isLocalStorageEnabled()) return 'unavailable';
    if (
      !UUID_PATTERN.test(objectId) ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > MAX_UPLOAD_BYTES ||
      !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(contentType) ||
      requestContentType !== contentType ||
      !/^\d{10}$/.test(expires) ||
      !/^[a-f0-9]{64}$/.test(signature)
    ) return 'invalid';

    const expiry = Number(expires);
    const now = Math.floor(Date.now() / 1000);
    if (expiry <= now || expiry > now + LOCAL_UPLOAD_TTL_SECONDS) return 'expired';
    if (!verifyLocalUpload(objectId, expiry, contentType, size, signature)) {
      return 'forbidden';
    }

    const root = this.getLocalObjectRoot();
    await mkdir(root, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);
    const localFile = new LocalStoredFile(root, objectId);
    const [alreadyExists] = await localFile.exists();
    if (alreadyExists) return 'exists';

    const temporaryPath = join(root, `.${objectId}.${randomUUID()}.upload`);
    let receivedBytes = 0;
    const sizeGuard = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        receivedBytes += chunk.length;
        if (receivedBytes > size || receivedBytes > MAX_UPLOAD_BYTES) {
          callback(new Error('upload_size_mismatch'));
          return;
        }
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        stream,
        sizeGuard,
        createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }),
      );
      if (receivedBytes !== size) {
        await rm(temporaryPath, { force: true });
        return 'size_mismatch';
      }
      try {
        await link(temporaryPath, join(root, objectId));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'exists';
        throw error;
      }
      try {
        await localFile.setContentType(contentType);
      } catch (error) {
        await rm(join(root, objectId), { force: true });
        throw error;
      }
      return 'stored';
    } catch (error) {
      if ((error as Error).message === 'upload_size_mismatch') return 'size_mismatch';
      throw error;
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith('/')) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function signLocalUpload(
  objectId: string,
  expires: number,
  contentType: string,
  size: number,
): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is required for local uploads');
  return createHmac('sha256', secret)
    .update(`local-upload-v1\n${objectId}\n${expires}\n${contentType}\n${size}`)
    .digest('hex');
}

function verifyLocalUpload(
  objectId: string,
  expires: number,
  contentType: string,
  size: number,
  signature: string,
): boolean {
  const expected = signLocalUpload(objectId, expires, contentType, size);
  const expectedBytes = Buffer.from(expected, 'hex');
  const receivedBytes = Buffer.from(signature, 'hex');
  return expectedBytes.length === receivedBytes.length &&
    timingSafeEqual(expectedBytes, receivedBytes);
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  const pathParts = path.split('/');
  if (pathParts.length < 3) {
    throw new Error('Invalid path: must contain at least a bucket name');
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join('/');

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`,
    );
  }

  const { signed_url: signedURL } = await response.json() as { signed_url: string };
  return signedURL;
}
