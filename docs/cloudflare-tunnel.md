# CloudFlare Tunnel Setup

Exposes the logger app publicly at `https://log.scrambler-lab.com` via CloudFlare Tunnel, with no port forwarding or static IP required.

## Prerequisites

- CloudFlare account managing `scrambler-lab.com`
- `cloudflared` installed: `brew install cloudflared`

## One-time Setup

### 1. Authenticate

```bash
cloudflared tunnel login
```

Opens a browser — select **scrambler-lab.com**. Saves a certificate to `~/.cloudflared/cert.pem`.

### 2. Create the tunnel

```bash
cloudflared tunnel create logger
```

Outputs a Tunnel ID (UUID) and writes credentials to `~/.cloudflared/<TUNNEL_ID>.json`.

### 3. Update config.yml

Edit [cloudflare/config.yml](../cloudflare/config.yml) — replace both `TUNNEL_ID` placeholders with the actual UUID:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /Users/nobu/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: log.scrambler-lab.com
    service: http://localhost:8000
  - service: http_status:404
```

### 4. Create the DNS record

```bash
cloudflared tunnel route dns logger log.scrambler-lab.com
```

Adds a `CNAME` in CloudFlare DNS: `log.scrambler-lab.com → <TUNNEL_ID>.cfargotunnel.com`.

## Running

The tunnel starts automatically with the app:

```bash
./start.sh
```

`cloudflared` runs in the background; logs go to `/tmp/cloudflared.log`. Ctrl+C stops everything including the tunnel.

To run the tunnel manually for debugging:

```bash
cloudflared tunnel --config cloudflare/config.yml run
```

## How the Frontend Is Served

The React app is built to `frontend/dist/` and served by FastAPI:

```bash
cd frontend && npm run build
```

FastAPI mounts `/assets` as static files and returns `index.html` for all non-API routes, enabling client-side routing. The tunnel forwards all traffic to FastAPI on port 8000.

## Multiple Tunnels on One Mac

You can run multiple CloudFlare tunnels simultaneously on the same machine with no conflicts. Two approaches:

**Option A — Separate tunnel per project (recommended)**

Each project runs `cloudflared tunnel create <name>` independently, gets its own Tunnel ID and credentials file, and starts its own `cloudflared` process via its own `start.sh`. Projects start and stop independently.

This is the right choice when each project has its own startup script.

**Option B — One tunnel, multiple ingress rules**

A single tunnel can route multiple hostnames to different local ports:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /Users/nobu/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: log.scrambler-lab.com
    service: http://localhost:8000
  - hostname: radio.scrambler-lab.com
    service: http://localhost:3000
  - service: http_status:404
```

Add a DNS record for each hostname:

```bash
cloudflared tunnel route dns <tunnel-name> radio.scrambler-lab.com
```

**Note on `cloudflared service install`:** The launchd auto-start service (`sudo cloudflared service install`) reads `~/.cloudflared/config.yml` and only installs one system service. For multiple auto-starting tunnels you'd need separate launchd plists. Since `start.sh` handles startup here, this is not an issue.

## Re-setup on a New Machine

1. Copy `~/.cloudflared/<TUNNEL_ID>.json` from the original machine (or re-create the tunnel)
2. `brew install cloudflared`
3. `cloudflared tunnel login` (re-authenticate)
4. Ensure `cloudflare/config.yml` has the correct Tunnel ID
5. Run `./start.sh`
