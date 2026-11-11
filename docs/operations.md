# Operations: deploy, updates, backup, release and smoke test

This document collects the operations for running cinema-watch and releasing its versions. For the basic start, the container options and the environment variables see the [README](../README.md).

## Deploy with Docker

The `docker run` and `docker compose` commands are in the [README](../README.md#quick-start). These points apply to a stable installation:

- the data folder is the only state to keep. At start the container, which starts as root, gives it to `PUID:PGID` (default 99:100) if it has another owner, and then runs the app as that user through `su-exec`, with no capability. If the `chown` fails (for example on NFS or on some Docker Desktop bind mounts) it writes this in the log and goes on;
- `PUID`/`PGID` are obtained with `id`: on a distro the first user is usually 1000:1000, on Unraid 99:100 (nobody:users) is left as it is;
- the image works with `--read-only`: it writes only to `/data` and to `/tmp` (tmpfs);
- to use a specific version instead of `latest` the tag of a Release is enough, for example `ghcr.io/pilascat/cinema-watch:v2026.10.1`;
- behind a reverse proxy set `UI_PASSWORD` and `TRUST_PROXY=1` (without `TRUST_PROXY` all visitors have the IP of the proxy, and five wrong passwords from anyone block access for everyone for 15 minutes), and enter the public address in Settings (Public URL). Served over `https`, the site can be installed as an app from the browser;
- not tried: rootless Docker and Podman. With SELinux enabled (Fedora, RHEL) the bind mount of the data folder needs `:Z` (`-v /path/to/data:/data:Z`).

### Optional hardening

Whoever wants to remove the privileges of the start from the container too starts it directly with the right user: `--user 99:100 --cap-drop=ALL` (in Compose `user: "99:100"` and `cap_drop: [ALL]`). This way the entrypoint does not touch the data folder, which must be given to that user beforehand (`chown -R 99:100 /path/to/data`). With `--cap-drop=ALL` and no `--user` the container stops at once and writes the two possible fixes in the log.

## Deploy on Unraid

The template [cinema-watch.xml](https://github.com/PilaScat/unraid-templates/blob/main/cinema-watch/cinema-watch.xml), in the [unraid-templates](https://github.com/PilaScat/unraid-templates) repo together with the profile for Community Apps, creates the container with the security options and the environment variables. To use it, copy it to `/boot/config/plugins/dockerMan/templates-user/my-cinema-watch.xml` and add the container from the Docker tab by choosing the template.

- **Data path**: `/mnt/user/appdata/cinema-watch`, like the other apps. On Unraid 7.3.2 the FUSE of `/mnt/user` applies `chown` and `chmod` (measured on 21/10/2026), so `config.json` stays at `600`. The direct path of the pool is fine too, for example `/mnt/cache/appdata/cinema-watch`. A folder under `/mnt` without a pool ends up in RAM and is lost at reboot.
- **Owner**: `PUID` 99 and `PGID` 100 (nobody:users). If the folder does not exist, Docker creates it as root and the container gives it to 99:100 at the first start.
- **Network**: the template uses `bridge`; another network can be chosen in the container tab.
- **Template**: once the container is created, Unraid saves the values entered (password included) in `my-cinema-watch.xml`. Copying the template of the repo over that file erases them. A new variable or container option must be added to the template in unraid-templates, in the same round as the release that introduces it.

[deploy/deploy.sh](../deploy/deploy.sh) is the script the author uses on his Unraid server: it downloads the template from unraid-templates if it is missing on the server, and publishes the service. The address of the server is passed with `UNRAID_HOST`.

## Updating the image

The web UI shows "vYYYY.MM.N available" when there is a newer Release on GitHub; the app checks once a day.

```sh
docker compose pull && docker compose up -d
```

On Unraid the container is updated from the Docker tab. Data and configuration live in the data folder and are not lost. New versions migrate `config.json` and `state.json` on their own (version 1 of the state becomes 2, keeping hunts, showings and history); if `state.json` has a version the app does not know, it starts again from an empty state and leaves the copy `state.json.bak-<milliseconds>` next to it. The opposite does not work: a `config.json` written by a newer version is rejected ("newer version of the app"), so going back to an old version requires the backup of the data folder.

### Going back to the previous version

You need the copy of the data folder made before the update (see [Backup](#backup)).

1. Stop the container.
2. Put `config.json` and `state.json` from the copy back in place of the current ones.
3. Restart with the tag of the previous image (for example `ghcr.io/pilascat/cinema-watch:v2026.10.15`) instead of `latest`.

Hunts added and settings changed after the copy are lost. The version that brings the language of the messages writes `config.json` in version 5: those up to v2026.10.15 reject it.

## Backup

The backup is a copy of the data folder (`/data` in the container). Writes are atomic, so every copied file is whole.

| Path | Content |
|---|---|
| `config.json` | Settings and hunts, Telegram token included. It is the only file really needed |
| `state.json` | State of the rounds: known showings, mutes, next round |
| `screens/` | Cached seat maps of the halls |
| `history/` | Trend of the free seats of each showing |
| `events.jsonl` | Log of the last 500 events |
| `webtic-venues.json`, `space-venues.json`, `t18-venues.json` | Lists of the Webtic, The Space and 18Tickets cinemas from the weekly checks; without them the check starts again |
| `secret` | Key that signs the sign-in cookies, present only with `UI_PASSWORD` |

Seat maps are downloaded again on their own; without `history/` the trend starts from zero. To restore, put the folder back in its place with `config.json` at `600` permissions; the container fixes the owner at start.

`config.json` can also be exported from Settings, Export and import section, with Export without token or Export with token. The import validates the whole file before replacing the configuration (limit 1 MB); a file without a token keeps the current one. If `config.json` is not valid at start, the app does not overwrite it: it makes a copy `config.json.bak-<code>` and asks to fix or delete it.

## Turning off or archiving a hunt

| Action | Effect |
|---|---|
| Untick "Hunt active" in the form of the hunt | The hunt is paused: no rounds and no alerts. It resumes when the tick is put back |
| Mute for 24 h (home or Telegram alert) | For 24 hours the hunt keeps reading but sends no alerts, and those of those hours are not recovered. Resume (home or message of the bot) removes the mute earlier |
| Bought (page of the hunt or Telegram alert) | Archives the hunt: it is no longer active and appears among the Archived |
| Dates over | A hunt with fixed dates archives itself when the last day has passed |
| Restore (among the Archived, on the page of the hunt or from the message of the bot after Bought) | Removes the archiving and opens the hunt. If the fixed dates are over, it opens the form with a warning: the hunt becomes active again when it is saved with new dates. From Telegram, with the dates over, the bot does not restore and refers to the page of the hunt |
| Delete | Deletes the hunt from the configuration |

Past showings leave the state and their trend is removed after 30 days. The Mute and Bought buttons are described in [telegram.md](telegram.md#what-an-alert-looks-like).

## Release

A release is an annotated tag plus a Release on GitHub: a tag without a Release is not a release.

1. Write in `CHANGELOG.md` a section `## vAAAA.MM.N` with the notes. It must be written before the tag: the workflow stops if it does not find it.
2. Create the annotated tag and publish it: `git tag -a vAAAA.MM.N -m "vAAAA.MM.N"` and `git push origin vAAAA.MM.N`. The format is `vAAAA.MM.N`, for example `v2026.10.1`.
3. `release.yml` starts from the tag. It can also be launched by hand with the `tag` input, for a tag already published.

The `release.yml` workflow runs in order:

1. **Check** of the code at the tag: tests, types, lint, build, `npm audit`, package signatures, licences and presence of the section in the CHANGELOG.
2. **Trivy** on the amd64 image: it stops on CRITICAL or HIGH vulnerabilities that have a fix.
3. **Images** amd64 and arm64, each on a native runner, with SBOM and provenance.
4. **Manifest** joining the two images under `:vAAAA.MM.N` and `:latest`, and provenance **attestation** recorded together with the image.
5. **Release** on GitHub with the text of the CHANGELOG section, the list of the commits between the previous tag and this one, the indication of the image and, attached, the signed provenance `cinema-watch-<tag>.intoto.jsonl` (the Sigstore bundle of the attestation). It is also needed for the Signed-Releases check of OpenSSF Scorecard.

To verify the attestation of an image:

```sh
gh attestation verify oci://ghcr.io/pilascat/cinema-watch:<tag> -R PilaScat/cinema-watch
```

### Images of the repo

They are in `docs/img/`, all in dark theme and at 1280×800: `pianta.png` (the seat map as it arrives on Telegram), `home.png` (the hunts) and `cinema.png` (the cinemas from the example home in piazza del Duomo in Milan, never a real home). They are redone from a local server with real data and the dark theme chosen in the app.

The social preview follows the GitHub template: 1280×640, PNG under 1 MB, content within 40 px of the edges. The source is `docs/img/social-preview.html` (font, icon and seat map of the repo); it is regenerated with headless Edge and then uploaded by hand from Settings → General → Social preview, because GitHub has no API for it:

```sh
msedge --headless=new --hide-scrollbars --window-size=1280,640 --screenshot=docs/img/social-preview.png file:///<percorso del repo>/docs/img/social-preview.html
```

Opening the source with `#check` at the end of the address shows the border of the safe area.

### If only the Release job fails

Images, manifest and attestation are already published. The tag is not moved and not deleted, and re-running the workflow would rebuild the images with new digests: `:latest` and the tag would no longer match. The Release is completed by hand with the same steps as the job, from Git Bash in the repo folder:

```sh
TAG=vAAAA.MM.N
IMAGE=ghcr.io/pilascat/cinema-watch
DIGEST=$(docker buildx imagetools inspect "$IMAGE:$TAG" --format '{{json .Manifest}}' | jq -r .digest)
git show "$TAG:CHANGELOG.md" | awk -v tag="$TAG" '$1 == "##" { inside = ($2 == tag); next } inside' > notes.md
previous=$(git describe --tags --abbrev=0 "$TAG^")
{ echo; echo "## Commit"; echo; git log --no-merges --format='- %s (%h)' "$previous..$TAG"; echo; echo "Immagine: \`$IMAGE:$TAG\` (amd64, arm64)"; } >> notes.md
gh attestation download "oci://$IMAGE@$DIGEST" -R PilaScat/cinema-watch
mv ./sha256?"${DIGEST#sha256:}.jsonl" "cinema-watch-$TAG.intoto.jsonl"
gh release create "$TAG" --verify-tag --title "$TAG" --notes-file notes.md "cinema-watch-$TAG.intoto.jsonl"
```

Then the workflow is fixed on `main`, which applies from the next release.

## Automatic workflows

All workflows can also be launched by hand (`workflow_dispatch`).

| Workflow | When it starts |
|---|---|
| `ci.yml` | On every pull request. Runs tests, types, lint, build, audit, licences, `actionlint` and `zizmor`. Its job "Test, tipi, lint, build e sicurezza" is required to get into `main`. The job "Smoke del container" launches `scripts/smoke.sh` and is not required: it reads the real UCI APIs, and a failure of theirs must not block merges |
| `codeql.yml` | Push to `main`, pull requests and every week |
| `scorecard.yml` | Every week |
| Dependabot | Every week, for npm dependencies, GitHub Actions and the base image |
| `release.yml` | Only from a `v*` tag or by hand |

CodeQL, Scorecard, Dependabot and `ci.yml` on pull requests start on their own by the author's choice of 15/10/2026. `release.yml` does not: it starts only from the tag or from the manual launch.

Since 19/10/2026 `main` is entered only with a pull request ("protected main" rule): the job of `ci.yml` must be green and the merge is done with a rebase, so the commits stay split by feature. No reviewer approval is needed, because there is only one maintainer, and the rule applies to admins too. The steps are in [CLAUDE.md](../CLAUDE.md).

## Smoke test

`sh scripts/smoke.sh` builds the image and tries it as in production. It needs Docker and `curl`, and the network: the last step calls the real APIs. It checks that:

- the image is under 200 MB;
- the container becomes `healthy` read-only, starting from a data folder owned by root, which it gives to 99:100;
- the app runs as 99:100 and with no capability;
- the home answers `200` and `/api/status` reports the version of the image;
- a hunt added from the form is accepted;
- `config.json` is `600` and `/data` belongs to 99:100;
- the idle RAM is under 100 MiB;
- the stop on SIGTERM is clean and the log contains no errors;
- on restart on a folder already owned by 99:100 there is no `chown`;
- a complete dry round (`--dry-run`) with `--user 99:100 --cap-drop=ALL` against the real APIs produces messages and PNG seat maps;
- with `PUID=1000 PGID=1000` folder, `config.json` and process switch to 1000:1000, even on a new volume;
- with a non-numeric `PUID`, or with `--cap-drop=ALL` without `--user`, the container stops with a clear message.

The smoke also runs in the CI, in the job "Smoke del container" of `ci.yml`.

Useful variables: `PLATFORM` (default `linux/amd64`), `IMAGE`, `SKIP_BUILD=1` to use an image already built and `SMOKE_PORT`. With `PLATFORM=linux/arm64` on an amd64 machine the image runs emulated: the smoke works, but the RAM is not measured and the script says so.
