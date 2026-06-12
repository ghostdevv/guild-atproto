# Guild <> ATProto Sync

A prompts based CLI tool to sync [Guild events](https://guild.host/) with the atmosphere. Uses the [`community.lexicon.calendar.event`](https://lexicon.garden/lexicon/did:plc:2uwoih2htodskvgocarwv5eq/community.lexicon.calendar.event) lexicon, with an `atmo.rsvp` extension for image support.

Currently the idea is to point users towards Guild, using atproto to help with discovery of the event and use of the lexicon. The atproto event will have all the public Guild event information, excluding the in-person location of the event (if there is one). The description will also have a note to the user to sign up on Guild prepended.

## Running Locally

Node 24 and pnpm 11 is required

1. Clone the repo
2. Run `pnpm install`
3. Run `pnpm start`

The prompt should guide you through the rest
