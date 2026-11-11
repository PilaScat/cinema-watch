# cinema-watch

Regole di lavoro di questo repository: valgono sopra quelle generali. Come funziona il progetto è in [README.md](README.md) e in [docs/](docs/).

## Testi e documenti

I testi visibili sono in inglese (la fonte, `src/i18n/en.ts`) e in italiano (`src/i18n/it.ts`), secondo [docs/UI-COPY.md](docs/UI-COPY.md). I documenti (`README.md`, `docs/`, `CONTRIBUTING.md`, `SECURITY.md`, le sezioni nuove del `CHANGELOG.md`) sono in inglese; in italiano restano `README.it.md` e questo file.

## Pull request, non push su main

Dal 19/10/2026 su `main` non si pusha: la regola "main protetto" di GitHub lo rifiuta. Ogni modifica passa da una pull request:

1. un ramo per argomento (`feat/…`, `fix/…`, `docs/…`, `security/…`), con i commit divisi per feature;
2. i quattro controlli in locale: `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`;
3. push del ramo e `gh pr create`;
4. `gh pr checks --watch`: il job "Test, tipi, lint, build e sicurezza" deve essere verde;
5. `gh pr merge --rebase --delete-branch`, poi `git pull` su `main`.

Pull request e merge si fanno senza chiedere, come prima il push su `main`. Il tag di rilascio resta col sì di Filippo e parte dal `main` già aggiornato.
