# Privacy policy

Last updated 2 October 2026

## Who is responsible

{{operator.name}}\
{{operator.street}}\
{{operator.postcodeAndCity}}\
{{operator.country}}

Email: [{{operator.email}}](mailto:{{operator.email}})

## Visiting the site

{{site.name}} has no ads, analytics, or tracking, and loads every file, the font included, from its own server.

Your browser sends your IP address and technical data such as the page address, the time, and the browser type, which the server needs to deliver the page.
To limit flooding, the server counts requests under a keyed hash of your IP address (for IPv6, of its first half), held in memory for an hour at most after your last request, or while you watch a game, and never written to disk or to a log; the key is random and replaced every day.
The web server keeps no access log; the application log records the route, the status, and errors, without IP addresses or names, and is rotated by size.

Legal basis: Art. 6(1)(f) GDPR; legitimate interest: delivering the site and keeping it secure.

## Signing in with Discord

The sign-in button leads to Discord, where [Discord's privacy policy](https://discord.com/privacy) applies; Discord (in the EEA, Discord Netherlands BV) is a separate controller.

{{site.name}} asks Discord only for the identify permission and never receives your email address or password.
It keeps your Discord user ID, username, and display name, and discards the rest, such as your avatar and locale.

On your first sign-in these are held for up to {{site.signupMinutes}} minutes while you choose your public name, and deleted if you do not create the account.
After that, the user ID stays with your account, and your username and display name are kept with each sign-in session, shown only to you, and updated at each sign-in, until you sign out or the session ends after {{site.sessionDays}} days.

Legal basis: Art. 6(1)(b) GDPR.
Source: Discord (Art. 14(2)(f) GDPR).

## Your account and public name

You choose your public name when you create your account, starting from your Discord username; it stays fixed when your Discord name changes.
It shows on the ladder, in your games, on your bots' pages, and in link previews, and anyone can search the games by it, which shows your results and your record against each opponent.

Your public player page shows your rating and its history, your record, and the opponents you met most.

Your account also records when it was created and, if it is banned, when.
It is kept until it is deleted.

Legal basis: Art. 6(1)(b) GDPR; for showing results, Art. 6(1)(f) GDPR, legitimate interest: running a public competition.

## Bots

For each bot, {{site.name}} stores its name, about text, version, repository link, the clocks it accepts, and its token, the token only as a cryptographic hash.
All but the token is public, with your name as owner, and so is whether the bot is connected, whether it is open to challenges, and how many games it is playing, which shows when you run it.

Each challenge between bots records both bots, the clock, the opening, the outcome, and the times.
These records are not public, count toward the daily challenge limits, and are deleted {{site.challengeDays}} days after the challenge was sent.

A bot you enter in a tournament is listed there with you as its owner, its rating at the start, its results, and its standing, all public.

A bot is kept until you delete it.
A bot that won or lost a game against an account or a bot, or played in a tournament, then stays in the public record as "deleted bot" (see [Deleting your account](#deleting-your-account)); any other bot is deleted with its games and challenges.

Legal basis: Art. 6(1)(b) GDPR; for the challenge records, Art. 6(1)(f) GDPR, legitimate interest: enforcing fair challenge limits.

## Games and ratings

{{site.name}} stores every game, guest games included: the players, the moves with their times, the clock, the result, and each rated player's rating before and after.
Games, ratings, and the rating history are public, and anyone can watch games live.
The ladder shows each player's rating, rated games played, and when the last one finished; by default it lists only players with a game in the last 30 days.

Games and ratings are kept as the public record.
Ratings are calculated automatically from the games and the time since a player's last game; they have no legal or similarly significant effect on you, so no automated decision under Art. 22 GDPR is made.

Legal basis: Art. 6(1)(b) GDPR, and Art. 6(1)(f) GDPR, legitimate interest: running a public competition.

## Playing as a guest

A guest gets a random label, "Guest" and four characters, and a session cookie.
The session stays in the server's memory, never in the database, and ends when you end it or sign in with Discord, when the server restarts, or after {{site.guestIdleHours}} hours without a request while no game runs.

Guest games are unrated and join the public record like every other game, shown and kept under the random label, which is all a game keeps of a guest: no session reference and nothing else that could identify you.
A guest has no player page and cannot be searched for.

Legal basis: Art. 6(1)(b) GDPR; for keeping guest games, Art. 6(1)(f) GDPR, legitimate interest: a complete public record of each bot's games.

## Cookies and browser storage

- The cookie {{site.sessionCookie}}, set when you sign in or start playing as a guest: a random session reference, first-party and not readable by scripts.
  It lasts {{site.sessionDays}} days after sign-in, or until you close the browser for a guest.
- The cookie {{site.oauthCookie}}, set when you start a sign-in with Discord: a random reference that ties Discord's answer to your browser, first-party and not readable by scripts.
  It lasts {{site.oauthMinutes}} minutes, or until Discord sends you back.
- The cookie {{site.signupCookie}}, set when a first sign-in returns from Discord: a random reference to the unfinished sign-up, first-party and not readable by scripts.
  It lasts {{site.signupMinutes}} minutes, or until you create the account or cancel.
- Browser storage (localStorage) under {{site.themeKey}}, {{site.boardKey}}, {{site.drawerKey}}, and {{site.playKey}}: your theme, your board settings, whether the game panel stays pinned, and the opponent and clock of your last game.
  It is written only when you change a setting or start a game, and never sent to the server.

These are strictly necessary for functions you ask for (sec. 25(2) no. 2 TDDDG), so they need no consent.
You can delete them in your browser.

## Moderation records

When the operator acts on an account, a bot, a game, or a report, or pauses the site, the action, the affected name if any, a reason, and the time are recorded; so is the deletion of an account by its owner.
The records are kept for the rest of the year of the action and the {{site.moderationYears}} calendar years after it, then deleted.
When an account is deleted, every record naming it or one of its bots names a placeholder instead, such as deleted-12, which only the operator sees.

Legal basis: Art. 6(1)(f) GDPR; legitimate interest: fair, documented moderation and defending legal claims (Art. 17(3)(e) GDPR).

## Backups

A copy of the database is made every night and kept for 14 days; copies off the server are encrypted and kept for at most 14 days.
Deleted data leaves every backup within 14 days.

So that restoring a backup never brings back a deleted account, each deletion is also noted, by account ID and time alone, in a file kept apart from the database; after a restore, the account is deleted again.
A note is kept one day longer than the oldest backup, then removed.

Legal basis: Art. 6(1)(f) GDPR; legitimate interest: keeping the service available.

## Deleting your account

Use Delete account on your Profile page and type your public name to confirm; the deletion takes effect at once.
If you sit in a live game, finish or resign it first.
You can also write to [{{operator.email}}](mailto:{{operator.email}}) and name your account; the operator deletes it within one month.

Your account, sessions, and bots are deleted, and your name becomes free.
Your games, and those of each bot of yours that won or lost a game against an account or a bot, or played in a tournament, stay in the public record, where you read as "deleted player" and those bots as "deleted bot".
Any other bot of yours is deleted with its games, guest games and yours against it included.

Nothing the site shows links "deleted player" or "deleted bot" to you, and the operator's moderation records name a placeholder instead of your name.

Legal basis for keeping the games: Art. 6(1)(f) GDPR; legitimate interest: keeping your opponents' histories and ratings whole.
You can object; see [Right to object](#right-to-object).

## Writing to the operator

If you write, your email address, name, and message are used to answer you or to handle your report, and deleted 12 months after the matter is closed.

Legal basis: Art. 6(1)(b) GDPR, or Art. 6(1)(f) GDPR, legitimate interest: answering messages and handling reports.

## Reports

Anyone may report a name, a bot, a game, or anything else on the site with the [report form](/report), linked at the foot of every page.
A report stores the page address, the reason and description you give, your name and email address if you give them, your statement that the report is accurate and in good faith, and the time.
It is not linked to your account, even when you are signed in.
Only the operator reads reports, to act on them and to write back to you; a report is deleted {{site.reportMonths}} months after the operator closes it.

Legal basis: Art. 6(1)(f) GDPR; legitimate interest: acting on unlawful content and abuse, and keeping the service safe.

## Who receives data

- The public: everything this policy calls public.
- {{host.name}}, {{host.street}}, {{host.postcodeAndCity}}, {{host.country}}, hosts the server under a data processing agreement (Art. 28 GDPR); the server stands in {{host.serverLocation}}.
- {{mailProvider.name}}, {{mailProvider.street}}, {{mailProvider.postcodeAndCity}}, {{mailProvider.country}}, hosts the contact mailbox.

Nobody else receives data, and {{site.name}} transfers no data outside the EU.

## Your rights

You have the right of access (Art. 15), rectification (Art. 16), erasure (Art. 17), restriction (Art. 18), data portability (Art. 20), and objection (Art. 21 GDPR).
Download my data on your Profile page hands you, at once, every record of your account and your bots as one file.
For anything else, write to [{{operator.email}}](mailto:{{operator.email}}); you get an answer within one month.

You may complain to a data protection authority, such as the one responsible for {{site.name}}: {{supervisoryAuthority.name}}, {{supervisoryAuthority.street}}, {{supervisoryAuthority.postcodeAndCity}}, {{supervisoryAuthority.country}}, [{{supervisoryAuthority.url}}]({{supervisoryAuthority.url}}).

## Right to object

> Where processing rests on Art. 6(1)(f) GDPR, you may object at any time on grounds relating to your particular situation.
> The processing then stops, unless compelling legitimate grounds override your interests or it serves legal claims.

## Do you have to provide data?

No law requires it.
Without the Discord sign-in you cannot have an account or own bots; you can still watch games and play as a guest.
