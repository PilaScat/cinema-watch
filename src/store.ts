import * as nodeFs from "node:fs/promises";
import { dirname, join } from "node:path";
import { copy } from "./copy.js";

const PRIVATE_MODE = 0o600;

export type StoreFs = Pick<
  typeof nodeFs,
  "mkdir" | "writeFile" | "rename" | "readFile" | "open" | "appendFile" | "rm" | "readdir" | "chmod" | "copyFile"
>;

export type StoreErrorKind = "corrupt" | "path" | "io";

export class StoreError extends Error {
  override readonly name = "StoreError";

  constructor(
    readonly kind: StoreErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface StoreOptions {
  fs?: StoreFs;
  platform?: NodeJS.Platform;
}

export function createStore(dir: string, options: StoreOptions = {}) {
  const fs = options.fs ?? nodeFs;
  const platform = options.platform ?? process.platform;

  function path(name: string): string {
    const parts = name.split("/");
    if (
      name === "" ||
      name.includes("\\") ||
      name.startsWith("/") ||
      /^[A-Za-z]:/.test(name) ||
      parts.some((part) => part === ".." || part === "." || part === "")
    ) {
      throw new StoreError("path", copy.storage.invalidPath(name));
    }
    return join(dir, ...parts);
  }

  async function readJson(name: string): Promise<unknown> {
    const text = await readText(name);
    if (text === null) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new StoreError("corrupt", copy.storage.notJson(name));
    }
  }

  const locks = new Map<string, Promise<unknown>>();
  let counter = 0;

  function serialized<T>(file: string, task: () => Promise<T>): Promise<T> {
    const previous = locks.get(file) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.catch(() => undefined);
    locks.set(file, tail);
    void tail.then(() => {
      if (locks.get(file) === tail) locks.delete(file);
    });
    return run;
  }

  async function atomicWrite(file: string, content: string, isPrivate: boolean): Promise<void> {
    await fs.mkdir(dirname(file), { recursive: true });
    counter += 1;
    const temp = `${file}.tmp-${process.pid}-${counter}`;
    try {
      const handle = await (isPrivate ? fs.open(temp, "w", PRIVATE_MODE) : fs.open(temp, "w"));
      try {
        await handle.writeFile(content);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temp, file);
    } catch {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      throw new StoreError("io", copy.storage.writeFailed(file));
    }
    if (isPrivate && platform !== "win32") {
      await fs.chmod(file, PRIVATE_MODE).catch(() => {
        throw new StoreError("io", copy.storage.permissionsNotApplied(file));
      });
    }
  }

  async function writeJson(name: string, value: unknown, writeOptions: { private?: boolean } = {}): Promise<void> {
    const file = path(name);
    await serialized(file, () => atomicWrite(file, JSON.stringify(value), writeOptions.private === true));
  }

  async function appendLine(name: string, line: string): Promise<void> {
    const file = path(name);
    await serialized(file, async () => {
      try {
        await fs.mkdir(dirname(file), { recursive: true });
        await fs.appendFile(file, `${line}\n`, "utf8");
      } catch {
        throw new StoreError("io", copy.storage.appendFailed(name));
      }
    });
  }

  async function readText(name: string): Promise<string | null> {
    try {
      return await fs.readFile(path(name), "utf8");
    } catch (error) {
      if (isNotFound(error)) return null;
      if (error instanceof StoreError) throw error;
      throw new StoreError("io", copy.storage.readFailed(name));
    }
  }

  async function readLines(name: string): Promise<string[]> {
    const text = await readText(name);
    return text === null ? [] : splitLines(text);
  }

  async function keepLastLines(name: string, count: number): Promise<void> {
    const file = path(name);
    await serialized(file, async () => {
      const text = await readText(name);
      if (text === null) return;
      const lines = splitLines(text);
      const kept = count <= 0 ? [] : lines.slice(-count);
      await atomicWrite(file, kept.map((line) => `${line}\n`).join(""), false);
    });
  }

  async function remove(name: string): Promise<void> {
    const file = path(name);
    await serialized(file, async () => {
      try {
        await fs.rm(file, { force: true });
      } catch {
        throw new StoreError("io", copy.storage.removeFailed(name));
      }
    });
  }

  async function list(subdir: string): Promise<string[]> {
    const folder = path(subdir);
    try {
      return await fs.readdir(folder);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw new StoreError("io", copy.storage.listFailed(subdir));
    }
  }

  async function backup(name: string, suffix: string): Promise<string | null> {
    const source = path(name);
    const backupName = `${name}.bak-${suffix}`;
    const target = path(backupName);
    return serialized(source, async () => {
      try {
        await fs.copyFile(source, target);
        return backupName;
      } catch (error) {
        if (isNotFound(error)) return null;
        throw new StoreError("io", copy.storage.backupFailed(name));
      }
    });
  }

  return { readJson, writeJson, appendLine, readLines, keepLastLines, remove, list, backup, path };
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.trim() !== "");
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";
}
