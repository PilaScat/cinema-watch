# Telegram: bot, chats, alerts and limits

This document explains how to connect cinema-watch to Telegram and what the alerts look like. The Telegram APIs used are the only exit towards `api.telegram.org`; the list of all hosts is in [api.md](api.md#hosts-the-app-calls-out-to).

## Creating the bot and getting the token

1. In Telegram open the chat with `@BotFather` and send `/newbot`.
2. Choose a name and a username that ends with `bot`.
3. BotFather answers with the token, in the format `123456789:AAH...`. It is a credential: whoever has it controls the bot.

The bot must be dedicated to cinema-watch (see [A single reader of the updates](#a-single-reader-of-the-updates)).

## Finding the chat id

The chat id is a number, or `@name` for a public channel.

- **Private chat**: open the bot and press Start (or write to it). The chat id is the positive number of your own user.
- **Group**: add the bot to the group and write a message. The chat id is a negative number.

There are two ways to read the number:

- write to the bot and open `https://api.telegram.org/bot<TOKEN>/getUpdates` in the browser: in the answer, `message.chat.id` is the chat id;
- write to a bot like `@userinfobot`, which answers with your id (useful for the private chat).

`getUpdates` must be used before saving the token in cinema-watch: the app reads the updates of the bot continuously and the two readings get in each other's way, with error 409.

## Where to set them

- In Settings, Telegram section: Bot token and Main chat. The token is shown masked and is removed with Delete the token.
- With the variables `TELEGRAM_TOKEN` and `TELEGRAM_CHAT_ID`. They apply only if the field in Settings is empty, and Settings shows when a value comes from the environment. A value entered in Settings replaces it.

The token is validated for its format, the chat id must be a number or `@name`.

## Send test and public URL

Send test sends a test message to the main chat.

The public URL is the address by which the web UI is reached from outside; it is needed by the Open hall button, which leads to `{public URL}/showings/{showing key}?hunt={hunt id}`: the page uses the good zone of the hunt and its Back returns to the hunt. Links of the old form, `/performances/{LocalId}/{PerformanceId}`, lead to the same page. If it is set, the test includes an Open cinema-watch button that checks it:

- if Telegram accepts the button, the URL is used as a button in the alerts;
- if it refuses it, for example because it is a private address or in `http`, the test is sent again with the link in the text. From then on Open hall appears in the text of the alert and Settings says so: "Telegram does not accept it as a button: links go in the text".

The result is remembered for that URL. Until a test is made, an `https` URL is considered accepted and an `http` one is not. The Buy buttons also follow the same rule: if Telegram refuses a message with buttons, the app sends it again with the links in the text.

## What an alert looks like

The texts of the messages and buttons are in the language chosen in Settings (see [Language of the messages](#language-of-the-messages)); the English ones are shown here.

For each hunt and for each chat, a round with news produces two parts:

1. **The seat maps**: those of the best showings, up to the number set in Seat maps per round (from 1 to 10, default 3). With a single seat map it arrives as a photo, with two or more as an album. Each photo has a caption with title, day, time, hall, format and free seats. Showings with freed seats come first, then those with more free seats in the good zone, then those with the best score.
2. **The summary**: a text message with the news in sections (Seats freed, New showings, Last seats, Moved, Cancelled, Films appeared), each line with day, time, cinema, hall, format, seats, best seats and "from" price. If it exceeds 4096 characters it is shortened with "and N more". An album cannot have buttons, which is why the keyboard is here.

The keyboard of the summary:

| Button | What it does |
|---|---|
| Buy | Opens the purchase page on ucicinemas.it or, for Webtic cinemas, on Webtic. One per seat map, up to 3, with the time if there is more than one |
| Open hall | Opens the page of the showing in the web UI, for the first seat map. Only with the public URL accepted as a button; otherwise the link is in the text |
| Refresh now | Reads the hunt again at once |
| Mute for 24 h | Suspends the alerts of that hunt for 24 hours |
| Bought | Archives the hunt |

After Mute for 24 h and Bought the bot sends a message with the button to undo:

| Message | Button | What it does |
|---|---|---|
| 🔕 *hunt*: muted until HH:MM | Resume | Removes the mute |
| 📦 *hunt*: hunt archived | Restore | Removes the archiving. If the fixed dates are over it does not restore and answers "Dates over: change them from the page of the hunt" |

If the alert contains only films appeared, there are no seat maps and the keyboard has only Refresh now. Mute stops the alerts, not the rounds: the events of those hours are not recovered. What these commands do to the hunt is in [operations.md](operations.md#turning-off-or-archiving-a-hunt).

Each type of alert (new showings, seats freed, last seats, cancelled, moved, films appeared, daily summary) is switched on or off per hunt in its form. If Telegram is not configured or sending fails, the state of the hunt does not advance and the same events come back at the next round.

If the reading of a hunt has failed for at least 30 minutes in a row, an alert message arrives, at most one a day per hunt, to the main chat. An error that goes away sooner, like an isolated 502 answer from UCI, stays only in the log and in the state of the hunt.

## Extra chats per hunt

Each hunt can have other chats besides the main one. They receive the same alerts, with the Refresh now keyboard only. They can use Refresh now and `/refresh` for the hunts that include them. Mute for 24 h, Bought, Resume and Restore work only from the main chat: from the others the bot answers "Only from the main chat". The daily summary goes only to the main chat.

The bot ignores chats that are neither the main chat nor an extra one.

## The /refresh command

`/refresh` reads the active hunts again, one at a time:

- from the main chat, all of them;
- from an extra chat, only those that include it.

It works in the quiet hours too. It answers with the news found or with "Nothing new" and, for each hunt, showings and free seats in the good zone. A hunt already refreshed less than 30 seconds earlier is skipped; if all are skipped, the answer is "Refreshed less than 30 s ago". In groups `/refresh@bot_name` also works. Up to v2026.10.15 the command was `/aggiorna`, which no longer answers.

## Language of the messages

Messages, buttons, log and errors are in the language chosen in Settings, Language of the messages: English or Italian. It does not depend on the language of the web UI, which follows the browser of whoever opens it. A new installation starts in English; one updated from a version without this setting stays in Italian. The change applies from the next message, without a restart. Before `config.json` is read (an error at start) the texts are in English.

## Daily summary

Once a day, at the time set in Settings (default 20:00, Europe/Rome time zone), the main chat receives a message with one line per active hunt: the showings followed, how many have seats together in the good zone and the best one. A long text is split into several messages. If the app was stopped at the set time, the summary goes out at the first chance on the same day; it does not go out in the quiet hours. It is switched off in Settings, or per single hunt.

## Quiet hours

In Settings, Quiet from and Quiet to stop the scheduled rounds in the given span, even across midnight: no reading, no alert, no summary. Refresh now and `/refresh` remain available. Empty means no quiet hours.

## Sending limits

| Limit | Value |
|---|---|
| Private chat | 1 message per second |
| Groups and channels | 20 messages per minute; each photo of an album counts as one |
| Text | 4096 characters |
| Caption | 1024 characters |
| Album | from 2 to 10 photos |

The messages of each chat go through a queue that respects these limits. If Telegram answers 429, the app waits for the given `retry_after` (1 second if missing) and tries again up to 3 times. After a network error or a 5xx answer it tries once more after a second: if the answer was lost after sending, the message may arrive twice (it is a choice, see [MEMORY.md](MEMORY.md)).

## A single reader of the updates

Telegram delivers the updates of a bot to a single reader at a time. If a second program reads the same updates (another instance of cinema-watch, a script, a `getUpdates` call), Telegram answers 409. The app writes it in the container log (event `bot conflict`) and tries again every minute, without receiving the buttons and `/refresh` while the conflict lasts. Outgoing alerts are not affected. It is solved by stopping the other reader, or by using a different bot for each instance.
