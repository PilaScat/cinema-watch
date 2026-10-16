# Widget per gethomepage

Questo documento mostra come leggere lo stato di cinema-watch da [gethomepage](https://gethomepage.dev) con il widget `customapi`.

Il widget interroga `GET /api/status`, descritta in [api.md](api.md#get-apistatus). La route non contiene segreti ed è aperta anche con `UI_PASSWORD` impostata, quindi il widget non ha bisogno di credenziali. Homepage fa la richiesta dal proprio server: l'indirizzo deve essere raggiungibile da lì.

## Esempio

Nel file `services.yaml` di Homepage, sostituendo `IP` con l'indirizzo di cinema-watch:

```yaml
- Cinema:
    - cinema-watch:
        href: http://IP:8790
        description: Cacce ai biglietti UCI
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

`refreshInterval` è in millisecondi. Il valore di `latestVersion` è `null` finché l'app non ha letto l'ultima Release da GitHub, cosa che fa una volta al giorno. Gli altri campi disponibili, fra cui l'elenco `hunts`, sono nella tabella di [api.md](api.md#get-apistatus).
