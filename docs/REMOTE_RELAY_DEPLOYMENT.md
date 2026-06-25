# Remote Relay — Deployment & Operations

Operational notes for the live relay instance. The architecture / design lives in
[REMOTE_RELAY.md](REMOTE_RELAY.md); this doc covers how the actual host is set up
and how to run it day-to-day.

## Current Deployment

| Field           | Value                                                  |
|-----------------|--------------------------------------------------------|
| Host            | Oracle Cloud VM, Ubuntu 20.04                          |
| Public IP       | `150.136.241.163`                                      |
| SSH             | `ssh ubuntu@150.136.241.163` (passwordless sudo)       |
| Install path    | `/home/ubuntu/otterly-live/ottery-relay`               |
| Data dir        | `/home/ubuntu/otterly-live/ottery-relay/data`          |
| DB              | `data/relay.db` (SQLite via `better-sqlite3`)          |
| TLS cert/key    | `data/certs/cert.pem` + `data/certs/key.pem` (self-signed, CN=`ottery-relay`, valid 10y) |
| Node            | v22.22.2 via nvm at `/home/ubuntu/.nvm/versions/node/v22.22.2/bin/node` |
| Service unit    | `/etc/systemd/system/ottery-relay.service`             |
| Run as          | `ubuntu:ubuntu`                                        |

## Ports

### Inside the VM
| Port | Purpose                                  | Bound by                |
|------|------------------------------------------|-------------------------|
| 3800 | HTTPS API + Socket.io status WebSocket   | `node server.js`        |
| 1936 | RTMPS ingest (OBS → relay)               | `node-media-server` v4  |

### Firewalls — two layers
1. **Host iptables** — already configured to ACCEPT 1935/1936/3800/3838 on tcp.
   UFW is inactive (intentionally; iptables rules are managed by Oracle's default).
2. **Oracle Cloud VCN Security List** — must allow inbound TCP `3800` and `1936`
   from `0.0.0.0/0`. Currently open and verified reachable from the public
   internet.

If a port test fails from outside but works on the VM (`ss -tlnp` shows it
listening), the block is at the Oracle VCN security list, not the host.

## systemd Service

The relay runs as `ottery-relay.service`. Unit file:

```ini
[Unit]
Description=Ottery Live Remote Relay
Documentation=https://github.com/zortiger/otterly-live
After=network-online.target
Wants=network-online.target
StartLimitBurst=10
StartLimitIntervalSec=300

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/home/ubuntu/otterly-live/ottery-relay
ExecStart=/home/ubuntu/.nvm/versions/node/v22.22.2/bin/node /home/ubuntu/otterly-live/ottery-relay/server.js
Restart=on-failure
RestartSec=5

StandardOutput=journal
StandardError=journal
SyslogIdentifier=ottery-relay
Environment=RELAY_LOG_LEVEL=info
Environment=NODE_ENV=production

LimitNOFILE=65535

NoNewPrivileges=true
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true

[Install]
WantedBy=multi-user.target
```

### Common operations

```bash
# Status
sudo systemctl status ottery-relay
# Restart
sudo systemctl restart ottery-relay
# Stop / start
sudo systemctl stop ottery-relay
sudo systemctl start ottery-relay
# Disable at boot (re-enable with `enable`)
sudo systemctl disable ottery-relay
```

If you edit the unit file, run `sudo systemctl daemon-reload` before restart.

## Logging

All stdout/stderr is captured by **journald** under the identifier
`ottery-relay`. Persistent on-disk storage is enabled with a 200 MB cap and
30-day retention via `/etc/systemd/journald.conf.d/ottery-relay.conf`:

```ini
[Journal]
Storage=persistent
SystemMaxUse=200M
MaxRetentionSec=30day
```

### Reading logs

```bash
# Live tail
journalctl -u ottery-relay -f
# Last 200 lines
journalctl -u ottery-relay -n 200 --no-pager
# Since boot
journalctl -u ottery-relay -b
# Time-windowed
journalctl -u ottery-relay --since "2026-05-23 12:00" --until "2026-05-23 18:00"
# By the syslog identifier (also catches early stdout before unit binding, useful in rare cases)
journalctl -t ottery-relay
# Errors only
journalctl -u ottery-relay -p err
# Disk usage of all journals
journalctl --disk-usage
```

The legacy `~/relay.log` file from earlier manual launches is preserved but no
longer written to.

### Log levels

Set via the `RELAY_LOG_LEVEL` env var in the unit file. Valid values:
`error | warn | info | debug`. Default is `info`. Change requires
`daemon-reload` + `restart`.

## User Management (CLI)

Users are managed by `ottery-relay/cli.js`. The CLI uses `better-sqlite3` and is
pinned to Node v22; running under v24 will fail with a NODE_MODULE_VERSION
mismatch. Use nvm to select v22 first:

```bash
ssh ubuntu@150.136.241.163
source ~/.nvm/nvm.sh
nvm use 22
cd ~/otterly-live/ottery-relay

node cli.js list-users
node cli.js add-user alice            # prints token ONCE
node cli.js rotate-token alice        # invalidates old token immediately
node cli.js remove-user alice
```

Changes take effect live — the running service reads from the DB on every
authenticated request. No `systemctl restart` needed.

The initial `owner` user's first token is saved at
`/home/ubuntu/otterly-live/ottery-relay/data/initial-token.txt`. If you've
already used or rotated it, ignore that file and use `rotate-token` to mint a
new one.

## Local App Configuration

In Ottery Live settings (Settings → Restream Mode → Remote):

| Field        | Value                                |
|--------------|--------------------------------------|
| Mode         | Remote                               |
| Relay URL    | `https://150.136.241.163:3800`       |
| API Token    | from `cli.js add-user` / `rotate-token` |

The client (`server/restream/relay-client.js`) connects to the relay's
self-signed cert in one of two ways:
- **Skip cert check** — enable "Skip certificate check" in the desktop app
  (Settings → Restream Mode), which sets `relay.allowSelfSigned` and disables
  TLS verification. Simplest; MITM-unsafe, so only for a relay you control.
- **Pin the cert** — paste `data/certs/cert.pem` into `relay.caCert`. Strict
  verification still happens, against this cert. Requires the cert to carry a
  SAN matching the host in the relay URL (see below).

## TLS Cert

Self-signed cert at `data/certs/cert.pem`, `key.pem`. Generated on first boot
by `server.js` if `RELAY_RTMPS_KEY_PATH` and `RELAY_RTMPS_CERT_PATH` are set
in `.env`. Valid for 10 years. Subject `CN=ottery-relay`.

**Subject Alternative Name (SAN):** set `RELAY_PUBLIC_HOST` in `.env` to the IP
or hostname the desktop app connects to (e.g. `150.136.241.163`). Cert
generation embeds it as a SAN, which is **required** for strict TLS — without a
SAN, modern clients reject the cert even when it is pinned via `relay.caCert`,
so the only way to connect would be the skip-cert-check escape hatch.

To regenerate the cert (e.g. after changing `RELAY_PUBLIC_HOST`): delete
`data/certs/cert.pem` and `key.pem`, then `sudo systemctl restart ottery-relay`
(server.js regenerates on boot). The current relay cert was regenerated with
`subjectAltName=IP:150.136.241.163`.

To swap for a Let's Encrypt cert later:
1. Put a domain in front of the VM (A record → `150.136.241.163`).
2. Use Caddy or nginx as a TLS terminator on 443 + a separate process for RTMPS
   on 1936 (or use `acme.sh` with DNS-01 to populate `data/certs/`).
3. Update Relay URL in the desktop app to the domain.

## Known Issues

- **Slow shutdown on restart.** `rtmp/rtmp-manager.js:79` calls
  `this.nms?.stop()`, but `node-media-server` v4 has no `stop()` method. The
  shutdown handler throws `TypeError`, `server.close()` is never reached, and
  the process exits only via the 5s safety `setTimeout` in
  `server.js:181`. `systemctl restart` therefore takes ~5s. Functionality is
  unaffected; the bug just makes restarts ungraceful.
- **Node version pinning.** The unit file hard-codes the v22.22.2 binary path.
  If nvm upgrades to a different v22.x patch, update `ExecStart`. A more
  resilient option is a stable symlink:
  `sudo ln -s ~ubuntu/.nvm/versions/node/v22.22.2/bin/node /usr/local/bin/node-relay`
  and point `ExecStart` at it.

## Quick Health Checks

From any machine with curl:

```bash
# Should return {"ok":true} in <300ms
curl -sk https://150.136.241.163:3800/api/health
# RTMPS port open?
timeout 5 bash -c '</dev/tcp/150.136.241.163/1936' && echo OPEN || echo BLOCKED
# Authenticated identity
curl -sk -H "Authorization: Bearer <token>" https://150.136.241.163:3800/api/me
```

On the host:

```bash
sudo systemctl status ottery-relay
sudo ss -tlnp | grep -E ':(3800|1936)\b'
journalctl -u ottery-relay -n 50 --no-pager
```
