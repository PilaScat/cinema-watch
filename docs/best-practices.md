# Risposte al questionario OpenSSF Best Practices, livello passing

Le risposte da incollare su [bestpractices.dev](https://www.bestpractices.dev) per il badge del livello passing, una riga per criterio, nell'ordine del modulo. I criteri sono quelli di `criteria.yml` del progetto [best-practices-badge](https://github.com/coreinfrastructure/best-practices-badge), letti il 18/10/2026: 67 attivi. Le giustificazioni sono in inglese perché il modulo è in inglese.

## Come si usa

1. Accedere a bestpractices.dev con l'account GitHub dell'autore e aggiungere il progetto `https://github.com/PilaScat/cinema-watch`. Il sito riempie da solo alcune risposte dal repository.
2. Per ogni criterio scegliere la risposta della tabella e incollare la giustificazione. Dove c'è un URL, il modulo lo chiede.
3. I due criteri sullo sviluppatore (`know_secure_design`, `know_common_errors`) li valuta l'autore: la tabella dà solo le prove nel codice.
4. Con tutti i MUST soddisfatti, e i SHOULD soddisfatti o giustificati, il sito assegna il badge e un id numerico. Il badge va nel README e la voce esce da [backlog.md](backlog.md).

`R` sta per `https://github.com/PilaScat/cinema-watch`.

## Basics

| Criterio | Tipo | Risposta | Giustificazione |
|---|---|---|---|
| description_good | MUST | Met | The README opens with what cinema-watch does: it watches Italian cinema programming and sends Telegram alerts with the seat map. R#readme |
| interact | MUST | Met | README: how to obtain it (Docker image, "Avvio rapido"), give feedback (issues) and contribute (CONTRIBUTING.md). R#readme |
| contribution | MUST | Met | Pull requests against main, described in R/blob/main/CONTRIBUTING.md |
| contribution_requirements | SHOULD | Met | CONTRIBUTING.md lists the required checks (tests, types, lint, build), tests for new code and the coding rules. R/blob/main/CONTRIBUTING.md |
| floss_license | MUST | Met | MIT License. |
| floss_license_osi | SUGGESTED | Met | MIT is OSI approved. |
| license_location | MUST | Met | R/blob/main/LICENSE |
| documentation_basics | MUST | Met | README (install, configuration, environment variables) and docs/ (operations, Telegram, API). R#readme |
| documentation_interface | MUST | Met | External interfaces: HTTP endpoints `/health` and `/api/status`, environment variables, Telegram commands and buttons, in docs/api.md, README and docs/telegram.md. R/blob/main/docs/api.md |
| sites_https | MUST | Met | GitHub repository, GitHub Releases and ghcr.io, all HTTPS only. |
| discussion | MUST | Met | GitHub issues and pull requests: searchable, addressable by URL, open to new participants, no proprietary software needed. R/issues |
| english | SHOULD | Unmet | The full documentation is in Italian, the language of its users and of the cinemas it covers. The README has an English summary, and bug reports and comments in English are accepted (CONTRIBUTING.md). |
| maintained | MUST | Met | Active development, regular releases (R/releases), weekly dependency updates. |

## Change Control

| Criterio | Tipo | Risposta | Giustificazione |
|---|---|---|---|
| repo_public | MUST | Met | R |
| repo_track | MUST | Met | Git history records every change, its author and its date. |
| repo_interim | MUST | Met | Every change is committed to main between releases, not only release snapshots. |
| repo_distributed | SUGGESTED | Met | Git. |
| version_unique | MUST | Met | Every release has a unique tag `vYYYY.MM.N`. |
| version_semver | SUGGESTED | Met | CalVer `vYYYY.MM.N` with a micro level. |
| version_tags | SUGGESTED | Met | Each release is an annotated git tag with a GitHub Release. R/tags |
| release_notes | MUST | Met | One section per release in CHANGELOG.md, copied into each GitHub Release. R/blob/main/CHANGELOG.md |
| release_notes_vulns | MUST | N/A | No publicly known vulnerability with a CVE has been fixed so far. |

## Reporting

| Criterio | Tipo | Risposta | Giustificazione |
|---|---|---|---|
| report_process | MUST | Met | GitHub issues, described in CONTRIBUTING.md. R/issues |
| report_tracker | SHOULD | Met | GitHub issues. |
| report_responses | MUST | Met | No bug reports from users have been received so far; reports are acknowledged as they arrive. |
| enhancement_responses | SHOULD | Met | No enhancement requests from users have been received so far. |
| report_archive | MUST | Met | GitHub issues are public and searchable. R/issues?q=is%3Aissue |
| vulnerability_report_process | MUST | Met | R/blob/main/SECURITY.md |
| vulnerability_report_private | MUST | Met | GitHub private vulnerability reporting, linked from SECURITY.md: R/security/advisories/new |
| vulnerability_report_response | MUST | Met | No vulnerability reports received in the last 6 months; SECURITY.md promises a first answer within 7 days. |

## Quality

| Criterio | Tipo | Risposta | Giustificazione |
|---|---|---|---|
| build | MUST | Met | `npm ci && npm run build`, and a multi-stage Dockerfile; documented in the README. |
| build_common_tools | SUGGESTED | Met | npm, TypeScript compiler, Docker. |
| build_floss_tools | SHOULD | Met | Node.js, npm, TypeScript, Tailwind CSS and Docker are FLOSS. |
| test | MUST | Met | Vitest suite in tests/, run with `npm test`, documented in the README and CONTRIBUTING.md. |
| test_invocation | SHOULD | Met | `npm test`. |
| test_most | SUGGESTED | Met | About 990 tests; coverage thresholds of 90% (80% for the web UI) are enforced, with branch coverage above 95%; mutation testing with Stryker. |
| test_continuous_integration | SUGGESTED | Met | CI runs the four checks on every pull request (ci.yml) and on every release tag before publishing (release.yml); CodeQL runs on every push. |
| test_policy | MUST | Met | CONTRIBUTING.md: a new feature or fix comes with its tests. |
| tests_are_added | MUST | Met | Recent features were added with their tests, for example the Webtic cinemas (R/commit/9a9e357, tests/webtic-direct.test.ts) and the Telegram undo buttons (R/commit/07b9c61, tests/bot.test.ts). |
| tests_documented_added | SUGGESTED | Met | R/blob/main/CONTRIBUTING.md |
| warnings | MUST | Met | TypeScript in strict mode and ESLint with typescript-eslint type-checked rules. |
| warnings_fixed | MUST | Met | Lint and type check must report zero problems before every release; the release workflow fails otherwise. |
| warnings_strict | SUGGESTED | Met | `strict: true` and type-checked lint rules; no warnings are allowed. |

## Security

| Criterio | Tipo | Risposta | Giustificazione |
|---|---|---|---|
| know_secure_design | MUST | Lo valuta l'autore | Evidence in the code: strict CSP with nonces, CSRF checks, input validation with zod, egress limited to allowed HTTPS hosts without redirects, read-only container with all capabilities dropped, secrets kept out of logs and pages. |
| know_common_errors | MUST | Lo valuta l'autore | Evidence: output escaping (JSX and SVG), CSRF, rate limiting of logins, SSRF prevention through the host allowlist, timing-safe password comparison, dependency and secret scanning. |
| crypto_published | MUST | Met | Only standard algorithms from Node.js crypto: HMAC-SHA256 for signed cookies, scrypt for comparing the optional password, TLS for all outbound calls. |
| crypto_call | SHOULD | Met | All cryptography comes from Node.js `crypto` and the TLS stack; nothing is implemented in the project. |
| crypto_floss | MUST | Met | Node.js and OpenSSL are FLOSS. |
| crypto_keylength | MUST | Met | The cookie signing secret is 32 random bytes (256 bits); TLS uses Node.js defaults. |
| crypto_working | MUST | Met | No broken algorithms are used. |
| crypto_weaknesses | SHOULD | Met | No SHA-1 or CBC in security mechanisms; SHA-256 is used only as a configuration fingerprint. |
| crypto_pfs | SHOULD | N/A | The software does not implement key agreement; TLS connections use the Node.js defaults, which prefer forward-secret cipher suites. |
| crypto_password_storage | MUST | N/A | No user passwords are stored. The optional UI password comes from an environment variable and is compared through scrypt with a per-process salt; no hash is kept. |
| crypto_random | MUST | Met | Secrets, salts and CSP nonces come from `crypto.randomBytes` and the Web Crypto API. |
| delivery_mitm | MUST | Met | Delivered through GitHub (HTTPS) and ghcr.io (HTTPS); images carry signed build provenance. |
| delivery_unsigned | MUST | Met | No hash is fetched over HTTP; images are verified with `gh attestation verify` (SECURITY.md). |
| vulnerabilities_fixed_60_days | MUST | Met | No open vulnerabilities: Dependabot, CodeQL and Trivy report none. |
| vulnerabilities_critical_fixed | SHOULD | Met | Dependabot security updates are immediate; the release fails on fixable CRITICAL or HIGH findings (Trivy). |
| no_leaked_credentials | MUST | Met | Secret scanning with push protection is enabled; test tokens are fake and checked by a test guard. |

## Analysis

| Criterio | Tipo | Risposta | Giustificazione |
|---|---|---|---|
| static_analysis | MUST | Met | CodeQL (JavaScript/TypeScript and Actions) on every push, pull request and weekly; ESLint type-checked rules; zizmor and actionlint for workflows. R/blob/main/.github/workflows/codeql.yml |
| static_analysis_common_vulnerabilities | SUGGESTED | Met | CodeQL security queries look for common vulnerabilities (XSS, injection, SSRF). |
| static_analysis_fixed | MUST | Met | CodeQL alerts are fixed before release; there are no open alerts. |
| static_analysis_often | SUGGESTED | Met | CodeQL runs on every push to main. |
| dynamic_analysis | SUGGESTED | Met | Property-based tests with fast-check, mutation testing with Stryker, end-to-end tests in a headless browser and a container smoke test before releases. |
| dynamic_analysis_unsafe | SUGGESTED | N/A | Written in TypeScript, a memory-safe language. |
| dynamic_analysis_enable_assertions | SUGGESTED | Met | Tests run with runtime schema validation (zod) and strict assertions enabled. |
| dynamic_analysis_fixed | MUST | Met | No exploitable vulnerability has been found by dynamic analysis; any would be fixed before the next release. |
