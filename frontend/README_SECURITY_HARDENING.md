# IRIS Security Hardening Runbook (Ubuntu + nginx + PostgreSQL + SSH)

This package provides production hardening artifacts for NIC-grade deployment:

- `frontend/deploy/security/harden_ubuntu_nic.sh`
- `frontend/deploy/security/nginx-iris2.conf`
- `frontend/deploy/security/fail2ban-jail.conf`
- `frontend/deploy/security/logrotate-iris-nginx`

## Scope

Implemented by script:

1. Firewall hardening with UFW (80/443 public, SSH allow-list, deny public 5432)
2. PostgreSQL hardening (`listen_addresses`, `pg_hba.conf`, SCRAM auth, DB logging)
3. SSH hardening (no password auth, no root login, key-only, auth limits)
4. nginx hardening snippets (security headers, CSP, server tokens off, leakage blocks)
5. TLS baseline in site template (TLS 1.2/1.3 only, OCSP stapling)
6. Fail2Ban setup (sshd and nginx jails)
7. Validation summary output

## Execute on Server

Run as root on Ubuntu host:

```bash
cd /opt/iris2
chmod +x frontend/deploy/security/harden_ubuntu_nic.sh
ADMIN_SSH_CIDRS="198.51.100.10/32,198.51.100.11/32" \
PG_TRUSTED_CIDRS="127.0.0.1/32,::1/128,10.10.0.0/16" \
POSTGRES_VERSION="16" \
POSTGRES_CLUSTER="main" \
./frontend/deploy/security/harden_ubuntu_nic.sh
```

Then adapt and enable `frontend/deploy/security/nginx-iris2.conf` for your domain:

```bash
cp frontend/deploy/security/nginx-iris2.conf /etc/nginx/sites-available/iris2.conf
ln -sf /etc/nginx/sites-available/iris2.conf /etc/nginx/sites-enabled/iris2.conf
nginx -t && systemctl reload nginx
```

## Required Manual Review

- Update CSP domains if your frontend uses additional third-party endpoints.
- Restrict `VITE_GOOGLE_MAPS_API_KEY` by HTTP referrer in Google Cloud Console.
- Rotate any previously committed keys/tokens (especially Wasender token if used before).
- Verify PostgreSQL app user uses strong credentials and least privilege.

## Validation Commands

```bash
# Open ports and listeners
ss -tulpen | grep -E ':(22|80|443|5432)\b'
ufw status verbose

# SSH hardening checks
sshd -T | grep -E 'passwordauthentication|permitrootlogin|maxauthtries|pubkeyauthentication|clientalive'

# PostgreSQL exposure and auth
grep -E "^[[:space:]]*listen_addresses" /etc/postgresql/16/main/postgresql.conf
grep -E "0.0.0.0/0|::/0|scram-sha-256" /etc/postgresql/16/main/pg_hba.conf

# nginx headers
curl -Ik https://example.gov.in | grep -Ei 'x-frame-options|x-content-type-options|strict-transport-security|content-security-policy|referrer-policy|permissions-policy'

# TLS configuration sanity
openssl s_client -connect example.gov.in:443 -servername example.gov.in -tls1_2 </dev/null
openssl s_client -connect example.gov.in:443 -servername example.gov.in -tls1_3 </dev/null

# Fail2Ban status
fail2ban-client status
fail2ban-client status sshd

# Optional external scans
nuclei -u https://example.gov.in -severity low,medium,high,critical
```

## Before/After Security Summary Template

Use this table in your certification report after rollout:

| Control | Before | After |
|---|---|---|
| Public DB exposure (5432) | Exposed/Unknown | Blocked publicly, DB bound to localhost/private |
| SSH auth | Password+Key/Unknown | Key-only, root login disabled, max tries = 3 |
| Public ports | Unknown | 80/443 public, 22 allow-listed, 5432 blocked |
| Security headers | Partial/Missing | Enforced globally (XFO, XCTO, RP, PP, HSTS, CSP) |
| TLS | Legacy ciphers/protocols possible | TLS 1.2/1.3 only, OCSP stapling enabled |
| Abuse controls | None/Unknown | nginx rate-limit + Fail2Ban jails |
| Logging/audit | Partial | nginx/app/db logging enabled with service checks |
