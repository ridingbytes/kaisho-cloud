# Deployment

## VPS deployment with Docker

### Prerequisites

- Docker and Docker Compose on the VPS
- Traefik (or another reverse proxy) for TLS termination
- DNS pointing `cloud.kaisho.dev` to the VPS IP

### Setup

1. Clone the repository on the VPS:

   ```bash
   cd /home/docker
   git clone git@github.com:ridingbytes/kaisho-cloud.git
   cd kaisho-cloud
   ```

2. Create `.env` from `.env.example` with production values
   (see `saas-setup.md`):

   ```bash
   cp .env.example .env
   chmod 600 .env
   ```

3. The production compose file (`docker-compose.prod.yml`)
   pulls a pre-built image from GHCR and connects to the
   shared `traefik-public` network. Traefik routing is
   configured via a file provider (`traefik/kaisho-cloud.yml`)
   rather than Docker labels. The deploy workflow copies this
   file to `/home/docker/traefik/conf.d/` automatically.

4. Start:

   ```bash
   docker compose up -d
   ```

5. Verify:

   ```bash
   curl https://cloud.kaisho.dev/health
   # {"status":"ok"}
   ```

### Updates

Once the GitHub Actions workflow (see below) is set up,
every push to the `production` branch builds a fresh
image and redeploys automatically. For manual updates:

```bash
cd /home/docker/kaisho-cloud
git pull
docker compose up --build -d
```

### Logs

```bash
docker logs kaisho-cloud --tail 100 -f
```

## GitHub Actions deployment

The workflow at `.github/workflows/deploy.yml` triggers on
every push to the `production` branch. It builds the API
image, pushes it to `ghcr.io/ridingbytes/kaisho-cloud`,
SCPs `docker-compose.prod.yml` to the VPS and runs
`docker compose pull && docker compose up -d`.

### Repository secrets

In **Settings > Secrets and variables > Actions**, set:

| Secret          | Value                                         |
|-----------------|-----------------------------------------------|
| `VPS_HOST`      | VPS IP or hostname                            |
| `VPS_USER`      | `docker`                                      |
| `VPS_SSH_KEY`   | Contents of `~/.ssh/github_actions_deploy`    |

`VPS_SSH_KEY` is the private half of the ed25519 key pair
whose public key (`github-actions-deploy`) sits in
`/home/docker/.ssh/authorized_keys` on the VPS. The
**same private key is used for the senaity repo** -- one
shared deploy key, one authorised_keys line.

### VPS one-time prep

```bash
sudo mkdir -p /home/docker/kaisho-cloud
sudo chown docker:docker /home/docker/kaisho-cloud

# Copy the production .env into place (NOT committed to git):
sudo -u docker vim /home/docker/kaisho-cloud/.env
sudo chmod 600 /home/docker/kaisho-cloud/.env

# Ensure the shared Traefik network exists (same one
# SENAITY uses):
docker network inspect traefik-public >/dev/null 2>&1 \
  || docker network create traefik-public
```

The GHCR package is private by default; either make it
public under **Packages > kaisho-cloud > Settings >
Visibility**, or run `docker login ghcr.io` on the VPS
with a read-scoped PAT.

### Traefik routing

Routing is handled by a Traefik file provider config
(`traefik/kaisho-cloud.yml`), not Docker labels. The
deploy workflow SCPs this file into
`/home/docker/traefik/conf.d/` on every push. Traefik
hot-reloads file provider configs, so no manual copy or
restart is needed. The config routes
`cloud.kaisho.dev` to the `kaisho-cloud` container on
port 3000 inside the `traefik-public` network.

### Image pinning

The deploy workflow pins the image to the exact Git SHA
instead of `:latest`. It writes the SHA to `.deploy-sha`
and keeps the previous value in `.deploy-sha.prev` for
rollback reference.
