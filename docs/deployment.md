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

3. If using Traefik, add labels to `docker-compose.yml`:

   ```yaml
   services:
     api:
       build: .
       container_name: kaisho-cloud
       restart: unless-stopped
       env_file: .env
       labels:
         - "traefik.enable=true"
         - "traefik.http.routers.kaisho-cloud.rule=Host(`cloud.kaisho.dev`)"
         - "traefik.http.routers.kaisho-cloud.tls.certresolver=letsencrypt"
         - "traefik.http.services.kaisho-cloud.loadbalancer.server.port=3000"
       networks:
         - traefik

   networks:
     traefik:
       external: true
   ```

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

```bash
cd /home/docker/kaisho-cloud
git pull
docker compose up --build -d
```

### Logs

```bash
docker logs kaisho-cloud --tail 100 -f
```
