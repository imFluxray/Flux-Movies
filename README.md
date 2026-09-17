# Flux Movies

A self-hosted streaming front end for films, series and anime. It started as a fork of sudo-flix, itself built on movie-web, and has since been reworked around its own player, discovery tools and watch parties.

**Live site:** [watch.flux.focuznow.com](https://watch.flux.focuznow.com)

## Features

### Playback

- Sources are read at runtime from `providers.json`, so they can be added, reordered or switched off without rebuilding the app.
- Anime plays through MegaPlay inside the Flux player. The player's own controls drive the embed, and dub and sub are separate audio options.
- Intro and outro skipping, and automatic next episode.
- Subtitles from the source or searched on OpenSubtitles. ASS and SSA files are converted to plain text before display.
- Progress is saved per profile and resumes where you left off.

### Discovery

- A home page hero built from what you watch, save and like.
- Title details with cast, trailers and similar titles.
- Discover filters: genres and 76 named subgenres (each can be required or excluded), keywords, release years, rating, runtime, original language and country.
- Taste finder: rate titles one at a time and it learns what you like. Films and series come from TMDB; anime comes from AniList, using its genres and tags.

### Watch parties

- Host a public or private party from any title and share a six-character code.
- Guests follow the host's playback, including moving to the next episode.
- Live chat, and a public lobby listing open parties.
- Names come from linked Flux accounts and are verified by the server.

### Profiles and accounts

- Local profiles, each with its own watch progress, list and likes.
- Optional Flux account linking to sync progress and the list across devices.

## Tech

| Part | Stack |
| --- | --- |
| Front end | React 18, TypeScript, Vite, Tailwind CSS, Zustand, hls.js |
| Metadata | TMDB, AniList |
| Watch party server | Node.js with `ws` (`services/party`) |

## Getting started

You need a recent Node.js (the live site runs 22) and pnpm.

```bash
pnpm install
cp example.env .env
pnpm dev
```

Set `VITE_TMDB_READ_API_KEY` in `.env` to a TMDB read access token. The app runs at `http://localhost:5173`.

| Command | Does |
| --- | --- |
| `pnpm build:pwa` | Production build with the web app manifest, output in `dist` |
| `pnpm test` | Unit tests |
| `pnpm lint` / `pnpm lint:fix` | Lint, and fix what can be fixed automatically |

## Configuring sources

Sources are listed in `providers.json`, served next to the built app and read on every page load. The real file is not committed because its entries point at private hosts. Copy `providers.example.json` to start.

| Field | Purpose |
| --- | --- |
| `id`, `name` | Identifier, and the name shown in the player |
| `url` | Base address of the source |
| `movie_url_pattern`, `tv_url_pattern` | Request paths built from `{url}`, `{tmdbId}`, `{imdbId}`, `{season}` and `{episode}` |
| `movie_alias`, `tv_alias` | Optional second pattern, tried when the first finds nothing |
| `scraper_timeout_seconds` | Time allowed per request, capped at 120 |
| `enabled` | `false` switches a source off |
| `megaplay` | Marks the anime source that resolves through MegaPlay |

The full set of options is documented in `src/backend/providers/fluxProviders.ts`.

## Watch party server

```bash
cd services/party
npm install
PORT=8095 node server.js
```

The app expects it on the same origin under `/party`: rooms at `/party/api` and the live connection at `/party/ws`. With Caddy:

```
handle_path /party* {
	reverse_proxy 127.0.0.1:8095
}
```

| Variable | Default |
| --- | --- |
| `PORT` | `8095` |
| `SSO_VERIFY_URL` | The Flux account server's token check |
| `SSO_ORIGIN` | The app origin the account server expects |

## Project structure

```
src/backend/providers     runtime sources and the stream runner
src/components/player     player, controls, embed display, watch party layer
src/pages                 home, discover, taste finder, watch parties
src/utils                 recommendations, taste model, AniList client
services/party            watch party server
```

## Credits

Built on [sudo-flix](https://github.com/sussy-code/smov) and [movie-web](https://github.com/movie-web/movie-web). Released under the MIT license; see `LICENSE.md`.
