# Answers to the OpenSSF Best Practices questionnaire, passing level

The answers to paste on [bestpractices.dev](https://www.bestpractices.dev) for the passing-level badge, one line per criterion, in the order of the form. The criteria are those of `criteria.yml` of the [best-practices-badge](https://github.com/coreinfrastructure/best-practices-badge) project, read on 18/10/2026: 67 active. The justifications are in English because the form is in English.

## How to use it

The project is number [15670](https://www.bestpractices.dev/projects/15670), added by Filippo on 19/10/2026 in the Metal series: passing level reached the same day, with the badge in the README.

1. `node scripts/best-practices-fill.mjs > fill.js` writes the code that fills in the form from this document: the project data and all the criteria with an answer of Met, Unmet or N/A. The count goes to stderr.
2. Sign in to bestpractices.dev, open `https://www.bestpractices.dev/en/projects/15670/passing/edit`, open the browser console (F12), type `allow pasting` if the browser asks for it, paste the contents of `fill.js` and press Enter. The console says how many fields it filled in and which ones it did not find.
3. The two criteria about the developer (`know_secure_design`, `know_common_errors`) concern the author: Filippo assessed them on 19/10/2026 (Met), with the justifications in the table.
4. Check and save. With all the MUSTs met, and the SHOULDs met or justified, the site awards the badge, which goes in the README; the item comes out of [backlog.md](backlog.md).

Without the script, fill it in by hand, line by line. `R` stands for `https://github.com/PilaScat/cinema-watch`; the script expands it.

## Project data

| Field | Value |
|---|---|
| name | cinema-watch |
| description | Watches the programming of Italian cinemas with "hunts" for a film, a set of cinemas, screen formats and dates, and sends a Telegram alert with the seat map when showings come out, good seats free up or run out, or a showing is cancelled or moved. It covers UCI Cinemas and about 300 cinemas that sell tickets through Webtic; other chains are planned. |
| license | MIT |
| implementation_languages | TypeScript, JavaScript |

## Basics

| Criterion | Type | Answer | Justification |
|---|---|---|---|
| description_good | MUST | Met | The README opens with what cinema-watch does: it watches the programming of Italian cinemas and sends Telegram alerts with the seat map. R#readme |
| interact | MUST | Met | README: how to obtain it (Docker image, "Quick start"), give feedback (issues) and contribute (CONTRIBUTING.md). R#readme |
| contribution | MUST | Met | Pull requests against main, described in R/blob/main/CONTRIBUTING.md |
| contribution_requirements | SHOULD | Met | CONTRIBUTING.md lists the required checks (tests, types, lint, build), tests for new code and the coding rules. R/blob/main/CONTRIBUTING.md |
| floss_license | MUST | Met | MIT License. |
| floss_license_osi | SUGGESTED | Met | MIT is OSI approved. |
| license_location | MUST | Met | R/blob/main/LICENSE |
| documentation_basics | MUST | Met | README (install, configuration, environment variables) and docs/ (operations, Telegram, API). R#readme |
| documentation_interface | MUST | Met | External interfaces: HTTP endpoints `/health` and `/api/status`, environment variables, Telegram commands and buttons, in docs/api.md, README and docs/telegram.md. R/blob/main/docs/api.md |
| sites_https | MUST | Met | GitHub repository, GitHub Releases and ghcr.io, all HTTPS only. |
| discussion | MUST | Met | GitHub issues and pull requests: searchable, addressable by URL, open to new participants, no proprietary software needed. R/issues |
| english | SHOULD | Met | The documentation is in English (README, docs/, CONTRIBUTING.md, SECURITY.md), with an Italian README beside it; the web UI is in English and Italian. Bug reports and comments in English are accepted (CONTRIBUTING.md). |
| maintained | MUST | Met | Active development, regular releases (R/releases), weekly dependency updates. |

## Change Control

| Criterion | Type | Answer | Justification |
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

| Criterion | Type | Answer | Justification |
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

| Criterion | Type | Answer | Justification |
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

| Criterion | Type | Answer | Justification |
|---|---|---|---|
| know_secure_design | MUST | Met | The primary developer applies the secure design principles listed in the criterion details, and the code shows them. Economy of mechanism: few runtime dependencies, no database, small single-purpose modules. Fail-safe defaults: strict CSP with nonces, CSRF checks on every POST, destructive Telegram buttons accepted only from the primary chat, failed deliveries never advance the alert state. Complete mediation: every form, query parameter and import is validated with zod before use, and every outbound call passes through one guarded HTTP client. Open design: public code and documentation. Least privilege: read-only container, all Linux capabilities dropped, non-root user 99:100, minimal permissions per GitHub Actions job. Input validation with allowlists: slugs, numeric ids, ISO dates and allowed hosts. Limited attack surface: no login to cinema sites and no purchases, outbound HTTPS only to listed hosts, redirects refused. |
| know_common_errors | MUST | Met | The primary developer knows the common vulnerabilities of web applications and self-hosted services (OWASP Top 10), and the project counters each of them. Cross-site scripting: automatic escaping in JSX and SVG output and a strict CSP without unsafe-inline. CSRF: origin checks on every POST and SameSite=Strict cookies. Injection: no shell or SQL, inputs validated with zod allowlists. SSRF: outbound calls only over HTTPS to an allowlist of hosts, redirects refused. Broken authentication: the optional password is compared with scrypt and timingSafeEqual, the session cookie is signed and HttpOnly, and an IP is locked out for 15 minutes after 5 failed attempts. Sensitive data exposure: the Telegram token is masked in the UI, redacted from logs and exports, and the config file has 0600 permissions. Vulnerable dependencies: Dependabot, npm audit, Trivy and CodeQL before every release. Leaked secrets: GitHub secret scanning with push protection. |
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

| Criterion | Type | Answer | Justification |
|---|---|---|---|
| static_analysis | MUST | Met | CodeQL (JavaScript/TypeScript and Actions) on every push, pull request and weekly; ESLint type-checked rules; zizmor and actionlint for workflows. R/blob/main/.github/workflows/codeql.yml |
| static_analysis_common_vulnerabilities | SUGGESTED | Met | CodeQL security queries look for common vulnerabilities (XSS, injection, SSRF). |
| static_analysis_fixed | MUST | Met | CodeQL alerts are fixed before release; there are no open alerts. |
| static_analysis_often | SUGGESTED | Met | CodeQL runs on every push to main. |
| dynamic_analysis | SUGGESTED | Met | Property-based tests with fast-check, mutation testing with Stryker, end-to-end tests in a headless browser and a container smoke test before releases. |
| dynamic_analysis_unsafe | SUGGESTED | N/A | Written in TypeScript, a memory-safe language. |
| dynamic_analysis_enable_assertions | SUGGESTED | Met | Tests run with runtime schema validation (zod) and strict assertions enabled. |
| dynamic_analysis_fixed | MUST | Met | No exploitable vulnerability has been found by dynamic analysis; any would be fixed before the next release. |
