# Ottery Relay

Remote stream relay server for [Ottery Live](https://github.com/zortech/otterly-live). Receives a single RTMP stream from your local Ottery Live app and fans it out to multiple platforms from a server with more upstream bandwidth.

## Why

If you have 30 Mb/s upload and want to stream to 4 platforms at 8 Mb/s each, that's 32 Mb/s locally — more than you have. With a relay, your machine uploads one stream to the server and the server handles the fan-out.

```
OBS --> Ottery Live (local) --1 stream--> Relay Server --N streams--> Twitch, YouTube, Kick, ...
```

## Quick Start (Docker)

```bash
docker pull ghcr.io/zortech/otterly-live/ottery-relay:latest
```

Or use the included `docker-compose.yml`:

```bash
docker compose up -d
```

On first boot the server creates an `owner` user and prints the API token to stdout. Retrieve it with:

```bash
docker compose logs relay | grep "Token"
```

The token is also saved to `/app/data/initial-token.txt` inside the container (mapped to the `relay-data` volume).

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAY_PORT` | `3800` | HTTP API + Socket.io port |
| `RELAY_RTMPS_PORT` | `1936` | RTMPS ingest port |
| `RELAY_DB_PATH` | `./data/relay.db` | SQLite database path |
| `RELAY_LOG_LEVEL` | `info` | Log level (`error`, `warn`, `info`, `debug`) |
| `RELAY_RTMPS_CERT_PATH` | — | TLS certificate for RTMPS |
| `RELAY_RTMPS_KEY_PATH` | — | TLS private key for RTMPS |

If no TLS cert/key paths are set, the server auto-generates a self-signed certificate. For production, mount your own certs (e.g. from Let's Encrypt) or put the relay behind a reverse proxy.

## docker-compose.yml

```yaml
services:
  relay:
    image: ghcr.io/zortech/otterly-live/ottery-relay:latest
    ports:
      - "3800:3800"
      - "1936:1936"
    volumes:
      - relay-data:/app/data
      - ./certs:/app/certs:ro
    environment:
      RELAY_DB_PATH:         /app/data/relay.db
      RELAY_PORT:            3800
      RELAY_RTMPS_PORT:      1936
      RELAY_RTMPS_CERT_PATH: /app/certs/server.crt
      RELAY_RTMPS_KEY_PATH:  /app/certs/server.key
      RELAY_LOG_LEVEL:       info
    restart: unless-stopped

volumes:
  relay-data:
```

## User Management

There is no web signup. The server operator manages users via the CLI:

```bash
# Inside Docker
docker compose exec relay node cli.js add-user alice
docker compose exec relay node cli.js list-users
docker compose exec relay node cli.js remove-user bob
docker compose exec relay node cli.js rotate-token alice
```

Tokens are printed once and cannot be recovered — only rotated.

## Connecting from Ottery Live

In the Ottery Live desktop app:

1. Go to **Settings** > **Restream Mode**
2. Select **Remote**
3. Enter the relay server URL (e.g. `https://relay.example.com:3800`)
4. Paste the API token and click **Verify**

When you start streaming in OBS, Ottery Live sends one stream to the relay and the relay handles the rest.

## API

All endpoints require `Authorization: Bearer <token>`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/sessions` | Start a relay session with platform configs |
| `DELETE` | `/api/sessions/:id` | End a session |
| `GET` | `/api/sessions/:id/status` | Get per-platform stream status |
| `GET` | `/api/me` | Get current user info |
| `POST` | `/api/auth/rotate-token` | Generate a new API token |
| `GET` | `/api/health` | Health check (no auth required) |

## Security

- API tokens are 256-bit random, bcrypt-hashed in the database
- Stream keys are held in-memory only for the session duration — never written to disk or logs
- RTMP ingest uses per-session UUID tokens validated on publish
- FFmpeg stderr is redacted before logging
- Rate limited to 30 requests/min per IP

See [docs/REMOTE_RELAY.md](../docs/REMOTE_RELAY.md) for the full security model.

## Building from Source

```bash
cd ottery-relay
npm install
node server.js
```

Or build the Docker image locally:

```bash
cd ottery-relay
docker build -t ottery-relay .
```

## License

Part of the [Ottery Live](https://github.com/zortech/otterly-live) project.
