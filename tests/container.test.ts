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

  it("lets the Unraid template choose PUID and PGID, without dropping every capability", () => {
    const template = read("deploy/cinema-watch.xml");
    expect(template).toMatch(/<Config Name="PUID" Target="PUID" Default="99"/);
    expect(template).toMatch(/<Config Name="PGID" Target="PGID" Default="100"/);
    expect(template).not.toContain("--cap-drop=ALL");
  });

  it("lets the Compose example choose PUID and PGID, without dropping every capability", () => {
    const compose = read("docker-compose.yml");
    expect(compose).toMatch(/PUID: "\d+"/);
    expect(compose).toMatch(/PGID: "\d+"/);
    expect(compose).not.toContain("cap_drop");
  });
});
