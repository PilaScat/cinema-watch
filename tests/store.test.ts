import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as realFs from "node:fs/promises";
import { createStore, StoreError, type StoreFs } from "../src/store.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cw-store-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("store json", () => {
  it("round-trips a value", async () => {
    const store = createStore(dir);
    await store.writeJson("a.json", { x: 1, y: ["z"] });
    expect(await store.readJson("a.json")).toEqual({ x: 1, y: ["z"] });
  });

  it("returns null for a missing file", async () => {
    expect(await createStore(dir).readJson("nope.json")).toBeNull();
  });
});

describe("store corruption and paths", () => {
  it("throws a corrupt StoreError on invalid json", async () => {
    await writeFile(join(dir, "bad.json"), "{not json");
    await expect(createStore(dir).readJson("bad.json")).rejects.toMatchObject({
      name: "StoreError",
      kind: "corrupt",
    });
  });

  it.each(["../x.json", "a/../../x", "/abs.json", "a\\b.json", "C:/x.json", "", "a//b"])(
    "rejects the path %j",
    async (name) => {
      const store = createStore(dir);
      await expect(store.writeJson(name, 1)).rejects.toBeInstanceOf(StoreError);
      await expect(store.readJson(name)).rejects.toMatchObject({ kind: "path" });
      expect(() => store.path(name)).toThrow(StoreError);
    },
  );

  it("creates subfolders", async () => {
    const store = createStore(dir);
    await store.writeJson("history/5116-575978.jsonl", [1]);
    expect(await store.readJson("history/5116-575978.jsonl")).toEqual([1]);
    expect(store.path("history/a.json")).toBe(join(dir, "history", "a.json"));
  });
});

type Failure = "writeFile" | "sync" | "rename";

function failingFs(failure: Failure): StoreFs {
  return {
    ...realFs,
    rename: async (from, to) => {
      if (failure === "rename") throw new Error("rename boom");
      await realFs.rename(from, to);
    },
    open: (async (...args: Parameters<typeof realFs.open>) => {
      const handle = await realFs.open(...args);
      return new Proxy(handle, {
        get(target, key) {
          if (key === "writeFile" && failure === "writeFile") {
            return () => Promise.reject(new Error("write boom"));
          }
          if (key === "sync" && failure === "sync") {
            return () => Promise.reject(new Error("sync boom"));
          }
          const value: unknown = Reflect.get(target, key);
          return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      });
    }),
  };
}

describe("store atomic writes", () => {
  it.each<Failure>(["writeFile", "sync", "rename"])(
    "keeps the previous content and leaves no temp file when %s fails",
    async (failure) => {
      await createStore(dir).writeJson("a.json", { v: "old" });
      const store = createStore(dir, { fs: failingFs(failure) });
      await expect(store.writeJson("a.json", { v: "new" })).rejects.toMatchObject({ kind: "io" });
      expect(JSON.parse(await readFile(join(dir, "a.json"), "utf8"))).toEqual({ v: "old" });
      expect(await readdir(dir)).toEqual(["a.json"]);
    },
  );

  it("leaves no temp file after a successful write", async () => {
    await createStore(dir).writeJson("sub/a.json", 1);
    expect(await readdir(join(dir, "sub"))).toEqual(["a.json"]);
  });

  it.skipIf(process.platform === "win32")("applies mode 0600 to private files", async () => {
    const store = createStore(dir);
    await store.writeJson("secret.json", 1, { private: true });
    await store.writeJson("open.json", 1);
    expect((await stat(join(dir, "secret.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, "open.json"))).mode & 0o777).not.toBe(0o600);
  });

  it("opens the temp file with mode 0600 only for private writes", async () => {
    const opened: Array<{ path: string; mode: unknown }> = [];
    const fs: StoreFs = {
      ...realFs,
      open: ((path: string, flags: string, mode?: number) => {
        opened.push({ path, mode });
        return realFs.open(path, flags, mode);
      }) as StoreFs["open"],
    };
    const store = createStore(dir, { fs, platform: "win32" });
    await store.writeJson("s.json", 1, { private: true });
    await store.writeJson("o.json", 1);
    expect(opened).toHaveLength(2);
    expect(opened[0]?.path).toContain("s.json.tmp-");
    expect(opened[0]?.mode).toBe(0o600);
    expect(opened[1]?.path).toContain("o.json.tmp-");
    expect(opened[1]?.mode).toBeUndefined();
  });

  it("skips chmod on win32", async () => {
    const chmodCalls: string[] = [];
    const fs: StoreFs = {
      ...realFs,
      chmod: (target) => {
        chmodCalls.push(String(target));
        return Promise.resolve();
      },
    };
    await createStore(dir, { fs, platform: "win32" }).writeJson("s.json", 1, { private: true });
    expect(chmodCalls).toEqual([]);
    await createStore(dir, { fs, platform: "linux" }).writeJson("s.json", 1, { private: true });
    expect(chmodCalls).toEqual([join(dir, "s.json")]);
  });

  it("serializes 20 concurrent writes and keeps the last value", async () => {
    const store = createStore(dir);
    const writes = Array.from({ length: 20 }, (_, index) => store.writeJson("c.json", { n: index }));
    await Promise.all(writes);
    expect(await store.readJson("c.json")).toEqual({ n: 19 });
    expect(await readdir(dir)).toEqual(["c.json"]);
  });
});

describe("store lines", () => {
  it("appends lines and reads them back, dropping blanks", async () => {
    const store = createStore(dir);
    await store.appendLine("h/x.jsonl", "one");
    await store.appendLine("h/x.jsonl", "two");
    await writeFile(join(dir, "h", "x.jsonl"), "one\n\n  \ntwo\n\n", "utf8");
    expect(await store.readLines("h/x.jsonl")).toEqual(["one", "two"]);
  });

  it("returns an empty list for a missing file", async () => {
    expect(await createStore(dir).readLines("nope.jsonl")).toEqual([]);
  });

  it("keeps both lines of concurrent appends", async () => {
    const store = createStore(dir);
    await Promise.all(Array.from({ length: 30 }, (_, index) => store.appendLine("a.jsonl", `line-${index}`)));
    const lines = await store.readLines("a.jsonl");
    expect(lines).toHaveLength(30);
    expect(new Set(lines).size).toBe(30);
  });

  it("serializes appends with writes on the same file", async () => {
    const store = createStore(dir);
    await Promise.all([store.appendLine("m.txt", "a"), store.writeJson("m.txt", "b"), store.appendLine("m.txt", "c")]);
    expect(await readFile(join(dir, "m.txt"), "utf8")).toBe('"b"c\n');
  });
});

describe("store maintenance", () => {
  it("keeps the last lines atomically", async () => {
    const store = createStore(dir);
    for (const line of ["1", "2", "3", "4", "5"]) await store.appendLine("k.jsonl", line);
    await store.keepLastLines("k.jsonl", 2);
    expect(await store.readLines("k.jsonl")).toEqual(["4", "5"]);
    expect(await readdir(dir)).toEqual(["k.jsonl"]);
    await store.keepLastLines("k.jsonl", 10);
    expect(await store.readLines("k.jsonl")).toEqual(["4", "5"]);
    await store.keepLastLines("k.jsonl", 0);
    expect(await store.readLines("k.jsonl")).toEqual([]);
  });

  it("does nothing when keeping lines of a missing file", async () => {
    const store = createStore(dir);
    await store.keepLastLines("none.jsonl", 3);
    expect(await readdir(dir)).toEqual([]);
  });

  it("removes files and tolerates missing ones", async () => {
    const store = createStore(dir);
    await store.writeJson("r.json", 1);
    await store.remove("r.json");
    await store.remove("r.json");
    expect(await readdir(dir)).toEqual([]);
  });

  it("lists a subfolder, empty when it does not exist", async () => {
    const store = createStore(dir);
    expect(await store.list("history")).toEqual([]);
    await store.writeJson("history/b.json", 1);
    await store.writeJson("history/a.json", 1);
    expect((await store.list("history")).sort()).toEqual(["a.json", "b.json"]);
  });

  it("backs up a file with the suffix and returns the name", async () => {
    const store = createStore(dir);
    await store.writeJson("config.json", { a: 1 });
    expect(await store.backup("config.json", "1700")).toBe("config.json.bak-1700");
    expect(JSON.parse(await readFile(join(dir, "config.json.bak-1700"), "utf8"))).toEqual({ a: 1 });
  });

  it("returns null when backing up a missing file", async () => {
    expect(await createStore(dir).backup("none.json", "1")).toBeNull();
  });

  it("wraps unexpected read failures as io errors", async () => {
    await expect(createStore(dir).readJson("sub/../x")).rejects.toMatchObject({ kind: "path" });
    await createStore(dir).writeJson("folder/a.json", 1);
    await expect(createStore(dir).readJson("folder")).rejects.toMatchObject({ kind: "io" });
    await expect(createStore(dir).readLines("folder")).rejects.toMatchObject({ kind: "io" });
  });
});

describe("store io failures", () => {
  function brokenFs(method: keyof StoreFs): StoreFs {
    return {
      ...realFs,
      [method]: () => Promise.reject(new Error("disk boom")),
    };
  }

  it.each([
    ["chmod", (store: ReturnType<typeof createStore>) => store.writeJson("p.json", 1, { private: true })],
    ["appendFile", (store: ReturnType<typeof createStore>) => store.appendLine("l.txt", "x")],
    ["rm", (store: ReturnType<typeof createStore>) => store.remove("p.json")],
    ["readdir", (store: ReturnType<typeof createStore>) => store.list("sub")],
    ["copyFile", (store: ReturnType<typeof createStore>) => store.backup("p.json", "1")],
  ] as const)("reports %s failures as io errors", async (method, action) => {
    const fs = brokenFs(method);
    await createStore(dir).writeJson("p.json", 1);
    await expect(action(createStore(dir, { fs, platform: "linux" }))).rejects.toMatchObject({
      name: "StoreError",
      kind: "io",
    });
  });
});
