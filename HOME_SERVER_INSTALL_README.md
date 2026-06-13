# Home server install

Install on Ubuntu server, access from devices on home network. App has no authentication, so do not expose it to internet.

## 1. Install Docker

SSH into server:

```bash
sudo apt update
sudo apt install -y git docker.io docker-compose-plugin
sudo usermod -aG docker $USER
```

Log out, then SSH back in so Docker group applies.

Check Docker works:

```bash
docker ps
```

## 2. Get app onto server

Clone repo, or copy project folder to server:

```bash
git clone <REPLACE_REPO_URL> run_tracker
cd run_tracker
```

If already copied:

```bash
cd /path/to/run_tracker
```

## 3. Find server LAN IP

```bash
hostname -I
```

Pick home-network IP, e.g. `192.168.1.50`.

Best: reserve this IP in router DHCP settings so it does not change.

## 4. Edit production compose

Open:

```bash
nano docker-compose.prod.yml
```

Replace every placeholder:

- `<REPLACE_SERVER_LAN_IP>`: server LAN IP, e.g. `192.168.1.50`
- `<REPLACE_TIMEZONE>`: timezone, e.g. `Australia/Melbourne`
- `<REPLACE_SATELLITE_TILE_URL>`: raster tile URL with `{z}/{x}/{y}`
- `<REPLACE_STREET_TILE_URL>`: raster tile URL with `{z}/{x}/{y}`
- `<REPLACE_TILE_SIZE>`: usually `256` or `512`
- `<REPLACE_MAP_ATTRIBUTION>`: provider attribution text

Example MapTiler values:

```yaml
NEXT_PUBLIC_MAP_TILE_URL_SATELLITE: "https://api.maptiler.com/maps/satellite/512/{z}/{x}/{y}.jpg?key=YOUR_KEY"
NEXT_PUBLIC_MAP_TILE_URL_STREET: "https://api.maptiler.com/maps/streets-v4/512/{z}/{x}/{y}.jpg?key=YOUR_KEY"
NEXT_PUBLIC_MAP_TILE_SIZE: "512"
NEXT_PUBLIC_MAP_ATTRIBUTION: "© MapTiler © OpenStreetMap contributors"
```

Important: `NEXT_PUBLIC_API_BASE_URL` must use server LAN IP, not `localhost`, because phone/tablet browsers need to call server backend.

## 5. Build and start when needed

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Open from any device on home network:

```text
http://<REPLACE_SERVER_LAN_IP>:3000
```

Example:

```text
http://192.168.1.50:3000
```

## 6. Stop when done

```bash
docker compose -f docker-compose.prod.yml down
```

Stopped containers use essentially no CPU/RAM. Start again with:

```bash
docker compose -f docker-compose.prod.yml up -d
```

Rebuild only after code or frontend env/map/API values change:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

## 7. Data and backup

SQLite DB lives on server at:

```text
./data/app.db
```

Backup:

```bash
cp data/app.db ~/run_tracker_app_$(date +%Y%m%d).db
```

Restore: stop app, copy DB back, start app.

```bash
docker compose -f docker-compose.prod.yml down
cp ~/run_tracker_app_YYYYMMDD.db data/app.db
docker compose -f docker-compose.prod.yml up -d
```

## 8. Firewall notes

If Ubuntu firewall is enabled, allow LAN access to ports 3000 and 8000.

Example for local subnet `192.168.1.0/24`:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp
sudo ufw allow from 192.168.1.0/24 to any port 8000 proto tcp
```

Do not port-forward these ports on router.
