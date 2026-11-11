# Widget for gethomepage

This document shows how to read the state of cinema-watch from [gethomepage](https://gethomepage.dev) with the `customapi` widget.

The widget queries `GET /api/status`, described in [api.md](api.md#get-apistatus). The route contains no secrets and is open even with `UI_PASSWORD` set, so the widget needs no credentials. Homepage makes the request from its own server: the address must be reachable from there.

## Example

In Homepage's `services.yaml` file, replacing `IP` with the address of cinema-watch:

```yaml
- Cinema:
    - cinema-watch:
        href: http://IP:8790
        description: Cacce ai biglietti dei cinema
        widget:
          type: customapi
          url: http://IP:8790/api/status
          refreshInterval: 60000
          method: GET
          mappings:
            - field: activeHunts
              label: Cacce attive
              format: number
            - field: showings
              label: Spettacoli
              format: number
            - field: withSeats
              label: Con posti
              format: number
            - field: version
              label: Versione
              format: text
            - field: latestVersion
              label: Ultima release
              format: text
```

`refreshInterval` is in milliseconds. The value of `latestVersion` is `null` until the app has read the latest Release from GitHub, which it does once a day. The other available fields are in the table in [api.md](api.md#get-apistatus); the `hunts` list is empty if the app has a password, because the widget does not log in.
