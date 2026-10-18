# Telegram: bot, chat, avvisi e limiti

Questo documento spiega come collegare cinema-watch a Telegram e come sono fatti gli avvisi. Le API di Telegram usate sono l'unica uscita verso `api.telegram.org`; l'elenco di tutti gli host è in [api.md](api.md#host-verso-cui-lapp-esce).

## Creare il bot e prendere il token

1. In Telegram aprire la chat con `@BotFather` e inviare `/newbot`.
2. Scegliere un nome e un nome utente che termini con `bot`.
3. BotFather risponde con il token, nel formato `123456789:AAH...`. È una credenziale: chi lo ha comanda il bot.

Il bot deve essere dedicato a cinema-watch (vedi [Un solo lettore degli aggiornamenti](#un-solo-lettore-degli-aggiornamenti)).

## Trovare il chat id

Il chat id è un numero, oppure `@nome` per un canale pubblico.

- **Chat privata**: aprire il bot e premere Avvia (o scrivergli). Il chat id è il numero positivo del proprio utente.
- **Gruppo**: aggiungere il bot al gruppo e scrivere un messaggio. Il chat id è un numero negativo.

Per leggere il numero ci sono due strade:

- scrivere al bot e aprire nel browser `https://api.telegram.org/bot<TOKEN>/getUpdates`: nella risposta, `message.chat.id` è il chat id;
- scrivere a un bot come `@userinfobot`, che risponde con il proprio id (utile per la chat privata).

`getUpdates` va usato prima di salvare il token in cinema-watch: l'app legge gli aggiornamenti del bot di continuo e le due letture si ostacolano, con l'errore 409.

## Dove si impostano

- Nelle Impostazioni, sezione Telegram: Token del bot e Chat principale. Il token si mostra mascherato e si toglie con Elimina il token.
- Con le variabili `TELEGRAM_TOKEN` e `TELEGRAM_CHAT_ID`. Valgono solo se il campo nelle Impostazioni è vuoto, e le Impostazioni mostrano quando un valore arriva dall'ambiente. Un valore inserito nelle Impostazioni lo sostituisce.

Il token è validato nel formato, il chat id deve essere un numero o `@nome`.

## Invia prova e URL pubblico

Invia prova manda un messaggio di prova alla chat principale.

L'URL pubblico è l'indirizzo con cui la web UI si raggiunge da fuori; serve al pulsante Apri sala, che porta a `{URL pubblico}/performances/{LocalId}/{PerformanceId}`. Se è impostato, la prova include un pulsante Apri cinema-watch che lo verifica:

- se Telegram accetta il pulsante, l'URL è usato come pulsante negli avvisi;
- se lo rifiuta, per esempio perché è un indirizzo privato o in `http`, la prova è rimandata con il link nel testo. Da allora Apri sala compare nel testo dell'avviso e le Impostazioni lo dicono: "Telegram non lo accetta come pulsante: i link vanno nel testo".

Il risultato è ricordato per quell'URL. Finché non si fa una prova, un URL `https` si considera accettato e uno `http` no. Anche i pulsanti Acquista seguono la stessa regola: se Telegram rifiuta un messaggio con i pulsanti, l'app lo rimanda con i link nel testo.

## Com'è fatto un avviso

Per ogni caccia e per ogni chat, un giro con novità produce due parti:

1. **Le piante**: quelle dei migliori spettacoli, fino al numero indicato in Piante per giro (da 1 a 10, predefinito 3). Con una sola pianta arriva come foto, con due o più come album. Ogni foto ha una didascalia con titolo, giorno, ora, sala, formato e posti liberi. Hanno la precedenza gli spettacoli con posti liberati, poi quelli con più posti liberi nella zona buona, poi quelli con il punteggio migliore.
2. **Il riepilogo**: un messaggio di testo con le novità in sezioni (Posti liberati, Nuovi spettacoli, Ultimi posti, Spostati, Annullati, Film comparsi), ciascuna riga con giorno, ora, cinema, sala, formato, posti, migliori posti e prezzo "da". Se supera i 4096 caratteri si accorcia con "e altri N". Un album non può avere pulsanti, per questo la tastiera sta qui.

La tastiera del riepilogo:

| Pulsante | Cosa fa |
|---|---|
| Acquista | Apre la pagina di acquisto su ucicinemas.it o, per i cinema Webtic, su Webtic. Uno per pianta, fino a 3, con l'orario se sono più d'uno |
| Apri sala | Apre la pagina dello spettacolo nella web UI, per la prima pianta. Solo con l'URL pubblico accettato come pulsante; altrimenti il link è nel testo |
| Aggiorna ora | Rilegge subito la caccia |
| Silenzia 24 h | Sospende gli avvisi di quella caccia per 24 ore |
| Acquistato | Archivia la caccia |

Dopo Silenzia 24 h e Acquistato il bot manda un messaggio con il pulsante per annullare:

| Messaggio | Pulsante | Cosa fa |
|---|---|---|
| 🔕 *caccia*: silenziata fino alle HH:MM | Riattiva | Toglie il silenzio |
| 📦 *caccia*: caccia archiviata | Ripristina | Toglie l'archiviazione. Se le date fisse sono finite non ripristina e risponde "Date finite: si cambiano dalla pagina della caccia" |

Se l'avviso contiene solo film comparsi, non ci sono piante e la tastiera ha il solo Aggiorna ora. Silenzia ferma gli avvisi, non i giri: gli eventi di quelle ore non si recuperano. Cosa fanno questi comandi sulla caccia è in [operations.md](operations.md#spegnere-o-archiviare-una-caccia).

Ogni tipo di avviso (nuovi spettacoli, posti liberati, ultimi posti, annullati, spostati, film comparsi, riepilogo giornaliero) si attiva o disattiva per caccia nel suo form. Se Telegram non è configurato o l'invio fallisce, lo stato della caccia non avanza e gli stessi eventi si ripresentano al giro dopo.

Se la lettura di una caccia non riesce, arriva un messaggio di avviso, al massimo uno al giorno per caccia, alla chat principale.

## Chat aggiuntive per caccia

Ogni caccia può avere altre chat oltre alla principale. Ricevono gli stessi avvisi, con la sola tastiera Aggiorna ora. Possono usare Aggiorna ora e `/aggiorna` per le cacce che le includono. Silenzia 24 h, Acquistato, Riattiva e Ripristina funzionano solo dalla chat principale: dalle altre il bot risponde "Solo dalla chat principale". Il riepilogo giornaliero va solo alla chat principale.

Il bot ignora le chat che non sono la principale né un'aggiuntiva.

## Il comando /aggiorna

`/aggiorna` rilegge le cacce attive, una alla volta:

- dalla chat principale, tutte;
- da una chat aggiuntiva, solo quelle che la includono.

Funziona anche nella fascia silenziosa. Risponde con le novità trovate oppure con "Nessuna novità" e, per ogni caccia, spettacoli e posti liberi nella zona buona. Una caccia già aggiornata meno di 30 secondi prima si salta; se si saltano tutte, la risposta è "Aggiornata meno di 30 s fa". Nei gruppi vale anche `/aggiorna@nome_del_bot`.

## Riepilogo giornaliero

Una volta al giorno, all'ora indicata nelle Impostazioni (predefinita 20:00, fuso Europe/Rome), la chat principale riceve un messaggio con una riga per caccia attiva: gli spettacoli seguiti, quanti hanno posti vicini nella zona buona e il migliore. Un testo lungo si divide in più messaggi. Se l'app era ferma all'ora indicata, il riepilogo parte alla prima occasione dello stesso giorno; non parte nella fascia silenziosa. Si disattiva nelle Impostazioni, o per singola caccia.

## Fascia silenziosa

Nelle Impostazioni, Silenzio dalle e Silenzio alle fermano i giri programmati nella fascia indicata, anche a cavallo della mezzanotte: nessuna lettura, nessun avviso, nessun riepilogo. Aggiorna ora e `/aggiorna` restano disponibili. Vuota, non c'è fascia.

## Limiti di invio

| Limite | Valore |
|---|---|
| Chat privata | 1 messaggio al secondo |
| Gruppi e canali | 20 messaggi al minuto; ogni foto di un album ne conta uno |
| Testo | 4096 caratteri |
| Didascalia | 1024 caratteri |
| Album | da 2 a 10 foto |

I messaggi di ogni chat passano da una coda che rispetta questi limiti. Se Telegram risponde 429, l'app aspetta il `retry_after` indicato (1 secondo se manca) e riprova fino a 3 volte. Dopo un errore di rete o una risposta 5xx riprova una volta dopo un secondo: se la risposta si era persa dopo l'invio, il messaggio può arrivare due volte (è una scelta, vedi [MEMORY.md](MEMORY.md)).

## Un solo lettore degli aggiornamenti

Telegram consegna gli aggiornamenti di un bot a un solo lettore alla volta. Se un secondo programma legge gli stessi aggiornamenti (un'altra istanza di cinema-watch, uno script, una chiamata a `getUpdates`), Telegram risponde 409. L'app lo scrive nel registro del container (evento `bot conflict`) e riprova ogni minuto, senza ricevere i pulsanti e `/aggiorna` finché il conflitto dura. Gli avvisi in uscita non ne risentono. Si risolve fermando l'altro lettore, o usando un bot diverso per ogni istanza.
