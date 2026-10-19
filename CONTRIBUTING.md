# Contribuire

Come segnalare un problema e proporre una modifica a cinema-watch. Issues and pull requests in English are welcome too.

## Segnalare un problema

- **Bug, idee e domande**: una [issue](https://github.com/PilaScat/cinema-watch/issues) con la versione (in fondo a ogni pagina della web UI), cosa si è fatto, cosa ci si aspettava e cosa è successo. Il token del bot e gli id delle chat non vanno mai incollati.
- **Vulnerabilità**: mai in una issue pubblica. Si usa la segnalazione privata descritta in [SECURITY.md](SECURITY.md).

## Proporre una modifica

1. Una pull request verso `main`, piccola e su un argomento solo. Per una modifica grande conviene aprire prima una issue.
2. Devono passare i quattro controlli di [Sviluppo in locale](README.md#sviluppo-in-locale): test, tipi, lint e build. La CI li rilancia sulla pull request, e il merge, con rebase, si fa solo quando è verde.
3. Una funzione nuova o una correzione arriva con i suoi test (Vitest, in `tests/`). Le risposte delle API si provano con risposte vere ridotte, in `tests/fixtures/`. La copertura minima è il 90% su `src/` e l'80% su `src/web/`.
4. Le scelte che non si capiscono dal codice vanno in [docs/MEMORY.md](docs/MEMORY.md); una novità visibile va nel [CHANGELOG](CHANGELOG.md) sotto la prossima versione.

## Regole del codice

- Codice in inglese: identificatori, nomi dei file, route e campi.
- Testi visibili in italiano, nei file dei testi (`src/copy.ts` e `src/web/copy/`) e secondo [docs/UI-COPY.md](docs/UI-COPY.md); `tests/copy-style.test.ts` li controlla.
- Niente commenti nel codice: si spiega con nomi giusti e funzioni piccole. Restano le direttive, come `// eslint-disable-*` e `// @ts-expect-error`.
- Fine riga LF, come chiede `.gitattributes`.
- Le chiamate esterne passano da `src/http.ts`, solo verso gli host elencati in [docs/api.md](docs/api.md).

Chi contribuisce accetta che il suo codice sia distribuito con la licenza MIT del progetto ([LICENSE](LICENSE)).
