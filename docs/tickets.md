# Tickets: from the PDF of the order to a card and to Google Wallet

How the Tickets page works, what it keeps, and how to set up Google Wallet.

## What it does

1. On the Tickets page, upload the PDF of the order (up to 10 MB). The app reads it and shows the fields of each ticket: film, day, time, cinema, hall, row, seat, ticket, price, order and entry code.
2. Correct what is wrong and save. Add by hand opens the same fields empty, for a ticket whose PDF the app does not read.
3. Each saved ticket has a card with the entry code as a QR code, and these buttons: Add to Google Wallet, Download image, Share, Send to Telegram, Delete.

The PDF is read and not kept. The app reads the ticket@home PDF of UCI; the PDFs of the other circuits can be added when there is an example, and until then their tickets are typed by hand.

## What is read

The text of the PDF is read with `node:zlib` alone (`src/tickets/pdf-text.ts`): no PDF library, no JavaScript from the file is run, and images are skipped. A file over 10 MB, with more than 2000 streams or with more than 8 MB of text is refused; a stream that inflates to more than 2 MB is skipped. A PDF that cannot be read never touches the rounds of the hunts.

In a UCI order each page is a ticket. The entry code is the `Sigillo Fiscale`: the QR code printed on the ticket carries exactly that text (checked on a real order on 12/11/2026), so the card draws a QR code with the same content.

## What is kept, and for how long

- Tickets are in `tickets.json` in the data folder, readable only by the user of the app (like `config.json`). It holds the entry codes: whoever reads it can enter with those tickets.
- A ticket is deleted on its own 7 days after its showing (Filippo's choice of 12/11/2026); Delete removes it at once.
- The Tickets page has no switch of its own. Without `UI_PASSWORD` whoever reaches the app sees the cards and the entry codes, as they already see the bot token in Settings: to protect them, set `UI_PASSWORD` for the whole app.
- The card image is never cached by the browser (`Cache-Control: private, no-store`).

## Sharing a card

- **Download image**: a PNG of 900 by 440 pixels.
- **Share**: the share sheet of the phone, where the browser supports sharing files; the button stays hidden elsewhere.
- **Send to Telegram**: the card goes to the main chat, after a confirmation, because the card carries the entry code. The caption is in the language of the messages.

There is no public link to a card.

## Google Wallet

The button appears when the credentials are set in Settings, Google Wallet section.

### Setting it up

1. Create an Issuer account in the [Google Pay and Wallet Console](https://pay.google.com/business/console) and copy its Issuer ID.
2. Follow [Google's prerequisites](https://developers.google.com/wallet/tickets/events/web/prerequisites), "Service account key (REST API)": enable the Google Wallet API in a Google Cloud project and create a service account with a JSON key.
3. In the Google Pay and Wallet Console give that service account access to the Issuer account, as the same guide says.
4. In Settings enter the Issuer ID and paste the whole JSON file of the key. The app keeps the email and the private key, shows only the email, and never writes the key in a page.

A new Issuer account is in demo mode until Google grants it publishing access: the passes can be saved only by the test accounts added in the console. This part was written from Google's documentation and not tried with a real account.

### What happens at the click

1. The app signs a request with the key and asks Google for an access token (`oauth2.googleapis.com`).
2. It creates the event class and the ticket on Google's servers (`walletobjects.googleapis.com`), or updates them if they are already there.
3. It answers with a redirect to `https://pay.google.com/gp/v/save/<token>`, where the token names the ticket only.

The whole ticket does not travel in the link, because it would not fit: with the event and the ticket inside, the token of a real order was 2080 characters long, over the 1800 Google gives as safe. The link works for whoever opens it, so it is not shown: it is made at each click and opened in a new tab.

Nothing is sent to Google before the click. At the click Google receives film, day and time, cinema and address, hall, row, seat, ticket type, price, order number and entry code.

### When it fails

| Message | Cause |
|---|---|
| The private key is not valid | The key saved is not a private key the app can sign with: paste the JSON file again |
| Google refused the service account | Wrong key, or a service account that was deleted or disabled |
| Google refused the ticket | The service account has no access to the Issuer account, the Issuer ID is wrong, or the Google Wallet API is not enabled |
| Google did not answer | No network towards Google within 15 seconds |

The status Google answered with is in the container log (event `wallet`).

### The key

The private key is handled like the bot token: it stays out of Export without token, an import that does not carry it keeps the current one, and the log never writes it. If the key leaks, delete it in Google Cloud and create a new one; Delete the Google Wallet credentials in Settings removes it from the app.
