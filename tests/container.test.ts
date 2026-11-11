import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

describe("container start like the standard Unraid images", () => {
  it("starts from the entrypoint as root, without a fixed USER", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toContain('ENTRYPOINT ["docker-entrypoint.sh"]');
    expect(dockerfile).toMatch(/apk add [^\n]*su-exec/);
    expect(dockerfile).not.toMatch(/^USER /m);
    expect(read(".dockerignore")).toContain("!docker-entrypoint.sh");
  });

  it("gives the data folder to the app without following links, also when only some files belong to someone else", () => {
    const entrypoint = read("docker-entrypoint.sh");
    expect(entrypoint).toContain('chown -hR "$PUID:$PGID" "$DATA"');
    expect(entrypoint).toContain('find "$DATA" \\( ! -user "$PUID" -o ! -group "$PGID" \\)');
    expect(entrypoint).toContain("PUID=0");
  });

  it("moves latest only to the newest release tag", () => {
    expect(read(".github/workflows/release.yml")).toContain('[ "$EVENT" = "push" ] && [ "$newest" = "$TAG" ]');
  });

  it("lets the Compose example choose PUID and PGID, without dropping every capability", () => {
    const compose = read("docker-compose.yml");
    expect(compose).toMatch(/PUID: "\d+"/);
    expect(compose).toMatch(/PGID: "\d+"/);
    expect(compose).not.toContain("cap_drop");
  });
});
