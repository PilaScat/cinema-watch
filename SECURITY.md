# Security

## Supported versions

Only the latest published release receives fixes.

## How to report a vulnerability

Do not open a public issue. Use GitHub's private report:
**Security → Report a vulnerability** in this repository, or directly
<https://github.com/PilaScat/cinema-watch/security/advisories/new>.

The report needs the version, the steps to reproduce the problem and the impact. The
first answer arrives within 7 days.

## Coordinated disclosure

1. The report stays private until the fix is out.
2. The fix is released in a new release, with an entry in the [CHANGELOG](CHANGELOG.md).
3. Together with the release, a GitHub Security Advisory is published with the description of the
   vulnerability, the affected versions and the fixed one, and the name of the reporter, if they
   wish.

## What is in scope

- the app and the Docker image `ghcr.io/pilascat/cinema-watch`;
- the handling of the Telegram token and of the web UI password;
- the calls to UCI, Webtic, Telegram and GitHub.

The APIs of the circuits, such as UCI and Webtic, do not belong to this project: their problems must be reported to their respective operators.

## Verifying an image

Every published image has a provenance attestation:

```sh
gh attestation verify oci://ghcr.io/pilascat/cinema-watch:<versione> -R PilaScat/cinema-watch
```
