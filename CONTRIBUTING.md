# Contributing

How to report a problem and propose a change to cinema-watch. Issues and pull requests in English are welcome too.

## Reporting a problem

- **Bugs, ideas and questions**: an [issue](https://github.com/PilaScat/cinema-watch/issues) with the version (at the bottom of every page of the web UI), what was done, what was expected and what happened. The bot token and the chat ids must never be pasted.
- **Vulnerabilities**: never in a public issue. Use the private report described in [SECURITY.md](SECURITY.md).

## Proposing a change

1. A pull request to `main`, small and on a single topic. For a big change it is better to open an issue first.
2. The four checks in [Local development](README.md#local-development) must pass: test, types, lint and build. CI runs them again on the pull request, and the merge, with rebase, is done only when it is green.
3. A new feature or a fix comes with its tests (Vitest, in `tests/`). API responses are tested with trimmed real responses, in `tests/fixtures/`. The minimum coverage is 90% on `src/` and 80% on `src/web/`.
4. Choices that cannot be understood from the code go in [docs/MEMORY.md](docs/MEMORY.md); a visible change goes in the [CHANGELOG](CHANGELOG.md) under the next version.

## Code rules

- Code in English: identifiers, file names, routes and fields.
- Visible texts in English (the source, `src/i18n/en.ts`) and in Italian (`src/i18n/it.ts`), following [docs/UI-COPY.md](docs/UI-COPY.md); `tests/copy-style.test.ts` and `tests/i18n.test.ts` check them.
- No comments in the code: it is explained with good names and small functions. Directives stay, such as `// eslint-disable-*` and `// @ts-expect-error`.
- LF line endings, as `.gitattributes` requires.
- External calls go through `src/http.ts`, only to the hosts listed in [docs/api.md](docs/api.md).

Contributors agree that their code is distributed under the project's MIT license ([LICENSE](LICENSE)).
