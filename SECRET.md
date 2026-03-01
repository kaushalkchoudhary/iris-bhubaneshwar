# Secrets Setup Sheet

Do not commit real secret values to git.
Do not paste real passwords/tokens into this file.

## 1) Frontend (`/root/iris2/client/.env`)

```env
VITE_GOOGLE_MAPS_API_KEY=
VITE_WASENDER_API_URL=/wasender/api/send-message
VITE_WASENDER_API_KEY=
VITE_OSINT_API_TOKEN=
```

## 2) Backend (`/root/iris2/backend/.env`)

```env
ENV=production
PORT=3001
JWT_SECRET=
WASENDER_API_TOKEN=
DATABASE_URL=postgresql://<db_user>:<db_password>@localhost:5432/irisdrone?sslmode=disable
UPLOAD_DIR=
WIREGUARD_ENDPOINT=
```

## 3) Docker Compose Env (if using `backend/docker-compose.yml`)

```env
POSTGRES_USER=
POSTGRES_PASSWORD=
POSTGRES_DB=irisdrone
```

## 4) GitHub Actions Secrets

```text
DEPLOY_HOST
DEPLOY_USER
DEPLOY_SSH_KEY
DEPLOY_PORT
```

## 5) GitHub Actions Variables

```text
DEPLOY_PATH=/root/iris2
GIT_BRANCH=main
BACKEND_SERVICE=iris-backend
NGINX_SITE_CONF=/etc/nginx/sites-enabled/default
FRONTEND_WEB_ROOT=
HEALTHCHECK_URL=
```

## 6) DNS / Email Security Records

```text
SPF TXT:   magicboxhub.net
DMARC TXT: _dmarc.magicboxhub.net
DKIM TXT:  <selector>._domainkey.magicboxhub.net
```

## 7) Rotation Checklist

- Rotate any token/key that was ever hardcoded previously.
- Update runtime env files with new values.
- Restart backend and reload nginx after updates.
- Re-run security scan (`nuclei`) and secret grep checks.
