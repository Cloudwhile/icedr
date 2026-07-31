import { describe, expect, it } from "vitest";
import {
  clearAllUploadRecoveryDescriptors,
  clearUploadRecoveryBatch,
  createLightweightUploadFingerprint,
  createUploadRecoveryDescriptor,
  createUploadResumeIdentityV2,
  matchesUploadRecoveryFile,
  matchesUploadRecoveryFileMetadata,
  matchesUploadRecoveryIdentity,
  readUploadRecoveryDescriptors,
  removeUploadRecoveryDescriptor,
  saveUploadRecoveryDescriptor,
  type UploadRecoveryDescriptor,
} from "./upload-recovery";

describe("upload recovery identity", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  ])("computes the standard full-file SHA-256 for %j", async (content, digest) => {
    await expect(
      createLightweightUploadFingerprint(createFile(content)),
    ).resolves.toBe(`sha256:${digest}`);
  });

  it("uses full content as well as file metadata for the v2 identity", async () => {
    const left = createFile("prefix-left-suffix", {
      lastModified: 100,
      name: "notes.txt",
    });
    const right = createFile("prefix-right-suffix", {
      lastModified: 100,
      name: "notes.txt",
    });

    const leftIdentity = await createUploadResumeIdentityV2({
      file: left,
      parentNodeId: "folder-1",
      spaceScope: "workspace",
      workspaceId: "workspace-1",
    });
    const rightIdentity = await createUploadResumeIdentityV2({
      file: right,
      parentNodeId: "folder-1",
      spaceScope: "workspace",
      workspaceId: "workspace-1",
    });

    expect(leftIdentity.contentFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(leftIdentity.resumeIdentity).toMatch(
      /^drive-upload-v2:[a-f0-9]{64}$/,
    );
    expect(leftIdentity).not.toEqual(rightIdentity);
  });

  it("keeps the v2 identity stable when only lastModified changes", async () => {
    const input = {
      parentNodeId: "folder-1",
      spaceScope: "workspace" as const,
      workspaceId: "workspace-1",
    };

    await expect(
      createUploadResumeIdentityV2({
        ...input,
        file: createFile("same content", {
          lastModified: 100,
          name: "same.txt",
          type: "text/plain",
        }),
      }),
    ).resolves.toEqual(
      await createUploadResumeIdentityV2({
        ...input,
        file: createFile("same content", {
          lastModified: 999,
          name: "same.txt",
          type: "text/plain",
        }),
      }),
    );
  });

  it("uses the canonical NFC file name for identity and recovery matching", async () => {
    const decomposed = createFile("same content", {
      name: "Café.txt",
      type: "text/plain",
    });
    const composed = createFile("same content", {
      name: "Café.txt",
      type: "text/plain",
    });
    const input = {
      parentNodeId: null,
      spaceScope: "personal" as const,
      workspaceId: "workspace-1",
    };
    const identity = await createUploadResumeIdentityV2({
      ...input,
      file: decomposed,
    });
    const composedIdentity = await createUploadResumeIdentityV2({
      ...input,
      file: composed,
    });
    const descriptor = createDescriptor({
      ...identity,
      fileName: "Café.txt",
      fileSize: decomposed.size,
      mimeType: decomposed.type,
      parentNodeId: null,
      spaceScope: "personal",
    });

    expect(identity).toEqual(composedIdentity);
    expect(matchesUploadRecoveryFileMetadata(descriptor, decomposed)).toBe(
      true,
    );
    await expect(
      matchesUploadRecoveryFile(descriptor, decomposed),
    ).resolves.toBe(true);
  });

  it("hashes the complete contents of a large file", async () => {
    const bytes = new Uint8Array(64 * 1024 * 4);
    const baseline = createFile(bytes, { name: "large.bin" });
    const changed = new Uint8Array(bytes);
    changed[Math.floor(changed.length / 2)] = 1;

    await expect(createLightweightUploadFingerprint(baseline)).resolves.not.toBe(
      await createLightweightUploadFingerprint(
        createFile(changed, { name: "large.bin" }),
      ),
    );
  });

  it("rejects a large recovery file changed outside the legacy sample windows", async () => {
    const bytes = new Uint8Array(512 * 1024);
    const baseline = createFile(bytes, {
      lastModified: 100,
      name: "large.bin",
    });
    const identity = await createUploadResumeIdentityV2({
      file: baseline,
      parentNodeId: "folder-1",
      spaceScope: "workspace",
      workspaceId: "workspace-1",
    });
    const descriptor = createDescriptor({
      ...identity,
      fileLastModified: baseline.lastModified,
      fileName: baseline.name,
      fileSize: baseline.size,
      mimeType: baseline.type,
    });
    const changedBytes = new Uint8Array(bytes);
    changedBytes[100 * 1024] = 1;
    const changed = createFile(changedBytes, {
      lastModified: baseline.lastModified,
      name: baseline.name,
      type: baseline.type,
    });

    await expect(matchesUploadRecoveryFile(descriptor, changed)).resolves.toBe(
      false,
    );
  });

  it("keeps bounded chunk reads while matching the platform SHA-256", async () => {
    const bytes = new Uint8Array(2 * 1024 * 1024 + 17);
    bytes[bytes.length - 1] = 1;
    const file = createFile(bytes, { name: "chunked.bin" });
    const slice = file.slice.bind(file);
    const sliceCalls: Array<[number, number]> = [];
    Object.defineProperty(file, "slice", {
      configurable: true,
      value: (start: number, end: number) => {
        sliceCalls.push([start, end]);
        return slice(start, end);
      },
    });
    const expected = await crypto.subtle.digest("SHA-256", bytes);

    await expect(createLightweightUploadFingerprint(file)).resolves.toBe(
      `sha256:${Array.from(new Uint8Array(expected), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("")}`,
    );
    expect(sliceCalls.length).toBeGreaterThan(1);
    expect(
      Math.max(...sliceCalls.map(([start, end]) => end - start)),
    ).toBeLessThanOrEqual(1024 * 1024);
  });

  it("strictly matches metadata and the content-derived identity", async () => {
    const file = createFile("recover me", {
      lastModified: 200,
      name: "recover.txt",
      type: "text/plain",
    });
    const identity = await createUploadResumeIdentityV2({
      file,
      parentNodeId: null,
      spaceScope: "personal",
      workspaceId: "workspace-1",
    });
    const descriptor = createDescriptor({
      ...identity,
      fileLastModified: file.lastModified,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      parentNodeId: null,
      spaceScope: "personal",
    });

    expect(matchesUploadRecoveryFileMetadata(descriptor, file)).toBe(true);
    expect(
      matchesUploadRecoveryFileMetadata(
        descriptor,
        new File(["recover me"], file.name, {
          lastModified: file.lastModified + 100,
          type: file.type,
        }),
      ),
    ).toBe(true);
    expect(matchesUploadRecoveryIdentity(descriptor, identity)).toBe(true);
    await expect(matchesUploadRecoveryFile(descriptor, file)).resolves.toBe(
      true,
    );
    await expect(
      matchesUploadRecoveryFile(
        descriptor,
        createFile("different", {
          lastModified: file.lastModified,
          name: file.name,
          type: file.type,
        }),
      ),
    ).resolves.toBe(false);
  });
});

describe("upload recovery storage", () => {
  it("stores only strict descriptors and replaces a session snapshot", () => {
    const storage = new MemoryStorage();
    const original = createDescriptor();
    const replacement = createDescriptor({
      progress: 55,
      updatedAt: "2026-07-30T01:00:00.000Z",
      uploadedBytes: 5,
    });

    expect(saveUploadRecoveryDescriptor(original, storage)).toBe(true);
    expect(saveUploadRecoveryDescriptor(replacement, storage)).toBe(true);
    expect(readUploadRecoveryDescriptors(storage)).toEqual([replacement]);

    const serialized = storage.values().join("");
    expect(serialized).not.toContain("objectKey");
    expect(serialized).not.toContain("multipartUploadId");
    expect(serialized).not.toContain("token");
  });

  it("rejects extra keys instead of persisting upload capabilities", () => {
    const storage = new MemoryStorage();
    const unsafeDescriptor = {
      ...createDescriptor(),
      multipartUploadId: "multipart-secret",
      objectKey: "objects/private",
      token: "upload-token",
    } as unknown as UploadRecoveryDescriptor;

    expect(saveUploadRecoveryDescriptor(unsafeDescriptor, storage)).toBe(
      false,
    );
    expect(storage.getItem("icedr.upload.recovery.v2")).toBeNull();

    storage.setItem(
      "icedr.upload.recovery.v2",
      JSON.stringify({
        records: [unsafeDescriptor],
        version: 2,
      }),
    );
    expect(readUploadRecoveryDescriptors(storage)).toEqual([]);
    expect(storage.getItem("icedr.upload.recovery.v2")).toBeNull();
  });

  it("fails closed and removes malformed or unsupported storage", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "icedr.upload.recovery.v2",
      JSON.stringify({
        records: [{ sessionId: "session-1" }],
        version: 2,
      }),
    );

    expect(readUploadRecoveryDescriptors(storage)).toEqual([]);
    expect(storage.getItem("icedr.upload.recovery.v2")).toBeNull();

    storage.setItem(
      "icedr.upload.recovery.v2",
      JSON.stringify({ records: [], version: 1 }),
    );
    expect(readUploadRecoveryDescriptors(storage)).toEqual([]);
    expect(storage.getItem("icedr.upload.recovery.v2")).toBeNull();
  });

  it("clears one session, one batch, or all recovery records", () => {
    const storage = new MemoryStorage();
    const first = createDescriptor();
    const second = createDescriptor({
      batchId: "batch-2",
      sessionId: "session-2",
      transferId: "transfer-2",
    });
    const third = createDescriptor({
      sessionId: "session-3",
      transferId: "transfer-3",
    });
    [first, second, third].forEach((descriptor) =>
      saveUploadRecoveryDescriptor(descriptor, storage),
    );

    expect(removeUploadRecoveryDescriptor("session-3", storage)).toBe(1);
    expect(clearUploadRecoveryBatch("batch-1", storage)).toBe(1);
    expect(readUploadRecoveryDescriptors(storage)).toEqual([second]);

    clearAllUploadRecoveryDescriptors(storage);
    expect(readUploadRecoveryDescriptors(storage)).toEqual([]);
  });

  it("rejects descriptors with unknown failure codes or unsafe numbers", () => {
    const storage = new MemoryStorage();
    const descriptor = createDescriptor();

    expect(
      saveUploadRecoveryDescriptor(
        { ...descriptor, uploadedBytes: descriptor.fileSize + 1 },
        storage,
      ),
    ).toBe(false);
    expect(
      saveUploadRecoveryDescriptor(
        {
          ...descriptor,
          failureCode: "UNKNOWN_FAILURE",
        } as unknown as UploadRecoveryDescriptor,
        storage,
      ),
    ).toBe(false);
    expect(readUploadRecoveryDescriptors(storage)).toEqual([]);
  });
});

function createDescriptor(
  overrides: Partial<UploadRecoveryDescriptor> = {},
) {
  return createUploadRecoveryDescriptor({
    batchId: "batch-1",
    conflictStrategy: "version",
    contentFingerprint: `sha256:${"a".repeat(64)}`,
    expiresAt: "2026-07-31T00:00:00.000Z",
    failureCode: null,
    fileLastModified: 100,
    fileName: "recover.txt",
    fileSize: 10,
    mimeType: "text/plain",
    ownerUserId: "user-1",
    parentNodeId: "folder-1",
    progress: 0,
    resumeIdentity: `drive-upload-v2:${"b".repeat(64)}`,
    sessionId: "session-1",
    spaceScope: "workspace",
    status: "running",
    transferId: "transfer-1",
    updatedAt: "2026-07-30T00:00:00.000Z",
    uploadedBytes: 0,
    workspaceId: "workspace-1",
    ...overrides,
  });
}

function createFile(
  content: BlobPart,
  options: {
    lastModified?: number;
    name?: string;
    type?: string;
  } = {},
) {
  return new File([content], options.name ?? "file.bin", {
    lastModified: options.lastModified ?? 1,
    type: options.type ?? "application/octet-stream",
  });
}

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length() {
    return this.data.size;
  }

  clear() {
    this.data.clear();
  }

  getItem(key: string) {
    return this.data.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.data.delete(key);
  }

  setItem(key: string, value: string) {
    this.data.set(key, value);
  }

  values() {
    return Array.from(this.data.values());
  }
}
