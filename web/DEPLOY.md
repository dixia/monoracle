# EC2 Frontend Deployment

This guide deploys the Monoracle dapp static build to an Ubuntu/Debian EC2 instance.

## Prerequisites

- EC2 instance (Ubuntu 22.04+ recommended)
- Port 80/443 open in security group
- Domain pointing to EC2 IP (optional, for HTTPS)

## Quick Deploy (5 minutes)

### 1. Upload static build

Copy the `out/` directory to your EC2 instance:

```bash
# From your local machine
scp -i your-key.pem -r web/out ubuntu@<EC2_IP>:/tmp/giro-oracle

# Or use rsync
rsync -avz -e "ssh -i your-key.pem" web/out/ ubuntu@<EC2_IP>:/var/www/giro-oracle/
```

### 2. Install nginx and deploy

SSH into your EC2 instance and run:

```bash
ssh -i your-key.pem ubuntu@<EC2_IP>

# Install nginx
sudo apt update && sudo apt install -y nginx

# Move files to web root
sudo mkdir -p /var/www/giro-oracle
sudo cp -r /tmp/giro-oracle/* /var/www/giro-oracle/

# Copy nginx config
sudo tee /etc/nginx/sites-available/giro-oracle << 'NGINX'
server {
    listen 80;
    server_name _;

    root /var/www/giro-oracle;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri.html $uri/ =404;
    }

    # Security headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;
}
NGINX

# Enable site
sudo ln -sf /etc/nginx/sites-available/giro-oracle /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test and restart
sudo nginx -t && sudo systemctl restart nginx
```

### 3. Verify

Open `http://<EC2_IP>` in your browser or use curl to check.

### Optional: HTTPS with Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## Auto-deploy Script (put on EC2)

```bash
#!/bin/bash
# deploy.sh — run on EC2 to pull latest from GitHub and redeploy

set -e
cd /var/www/giro-oracle

# Pull latest
git clone https://github.com/iamh4/monoracle.git /tmp/monoracle-latest
cd /tmp/monoracle-latest/web
npm ci --omit=dev
npx next build
sudo cp -r out/* /var/www/giro-oracle/
sudo systemctl reload nginx
rm -rf /tmp/monoracle-latest
```
