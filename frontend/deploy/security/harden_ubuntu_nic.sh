#!/usr/bin/env bash
set -euo pipefail

# NIC-grade baseline hardening for Ubuntu (nginx + PostgreSQL + SSH + Fail2Ban).
# Run as root on the production host during a maintenance window.

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

ADMIN_SSH_CIDRS="${ADMIN_SSH_CIDRS:-203.0.113.10/32}"
PG_TRUSTED_CIDRS="${PG_TRUSTED_CIDRS:-127.0.0.1/32,::1/128}"
POSTGRES_VERSION="${POSTGRES_VERSION:-16}"
POSTGRES_CLUSTER="${POSTGRES_CLUSTER:-main}"

PG_CONF="/etc/postgresql/${POSTGRES_VERSION}/${POSTGRES_CLUSTER}/postgresql.conf"
PG_HBA="/etc/postgresql/${POSTGRES_VERSION}/${POSTGRES_CLUSTER}/pg_hba.conf"
SSHD_CONF="/etc/ssh/sshd_config"
F2B_JAIL="/etc/fail2ban/jail.d/iris-hardening.local"
NGINX_SNIPPET_HEADERS="/etc/nginx/snippets/iris-security-headers.conf"
NGINX_SNIPPET_HARDENING="/etc/nginx/snippets/iris-hardening.conf"
NGINX_RATE_LIMIT="/etc/nginx/conf.d/00-iris-rate-limit.conf"
NGINX_LOGROTATE="/etc/logrotate.d/nginx-iris"

log() { printf "\n[%s] %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

backup() {
  local f="$1"
  if [[ -f "$f" ]]; then
    cp -a "$f" "${f}.bak.$(date +%Y%m%d%H%M%S)"
  fi
}

set_kv() {
  local file="$1" key="$2" value="$3"
  if grep -Eq "^[[:space:]]*#?[[:space:]]*${key}[[:space:]]*=" "$file"; then
    sed -ri "s|^[[:space:]]*#?[[:space:]]*${key}[[:space:]]*=.*|${key} = ${value}|g" "$file"
  else
    printf "\n%s = %s\n" "$key" "$value" >> "$file"
  fi
}

set_sshd() {
  local key="$1" value="$2"
  if grep -Eq "^[[:space:]]*#?[[:space:]]*${key}[[:space:]]+" "$SSHD_CONF"; then
    sed -ri "s|^[[:space:]]*#?[[:space:]]*${key}[[:space:]]+.*|${key} ${value}|g" "$SSHD_CONF"
  else
    printf "\n%s %s\n" "$key" "$value" >> "$SSHD_CONF"
  fi
}

upsert_block() {
  local file="$1" start="$2" end="$3" content="$4"
  local tmp
  tmp="$(mktemp)"
  awk -v s="$start" -v e="$end" '
    $0==s {skip=1; next}
    $0==e {skip=0; next}
    !skip {print}
  ' "$file" > "$tmp"
  {
    cat "$tmp"
    printf "\n%s\n%s\n%s\n" "$start" "$content" "$end"
  } > "$file"
  rm -f "$tmp"
}

require_cmds() {
  local c
  for c in ufw nginx sshd systemctl awk sed grep ss; do
    command -v "$c" >/dev/null 2>&1 || {
      echo "Missing command: $c" >&2
      exit 1
    }
  done
}

configure_firewall() {
  log "Configuring firewall (UFW)"
  ufw default deny incoming
  ufw default allow outgoing
  ufw --force delete allow OpenSSH || true
  ufw --force delete allow 22/tcp || true
  ufw --force delete allow 5432/tcp || true
  ufw allow 80/tcp comment 'http'
  ufw allow 443/tcp comment 'https'
  IFS=',' read -r -a cidrs <<< "$ADMIN_SSH_CIDRS"
  for cidr in "${cidrs[@]}"; do
    ufw allow from "${cidr}" to any port 22 proto tcp comment 'ssh-admin'
  done
  ufw deny 5432/tcp comment 'block-public-postgres'
  ufw --force enable
  ufw status verbose
}

configure_postgres() {
  log "Hardening PostgreSQL"
  [[ -f "$PG_CONF" ]] || { echo "Missing $PG_CONF" >&2; exit 1; }
  [[ -f "$PG_HBA"  ]] || { echo "Missing $PG_HBA"  >&2; exit 1; }
  backup "$PG_CONF"
  backup "$PG_HBA"

  set_kv "$PG_CONF" "listen_addresses" "'localhost'"
  set_kv "$PG_CONF" "password_encryption" "'scram-sha-256'"
  set_kv "$PG_CONF" "log_connections" "on"
  set_kv "$PG_CONF" "log_disconnections" "on"
  set_kv "$PG_CONF" "log_line_prefix" "'%m [%p] %u@%d %r '"

  sed -ri "s|^[[:space:]]*host[[:space:]]+all[[:space:]]+all[[:space:]]+0\\.0\\.0\\.0/0.*|# disabled by hardening script|g" "$PG_HBA"
  sed -ri "s|^[[:space:]]*host[[:space:]]+all[[:space:]]+all[[:space:]]+::/0.*|# disabled by hardening script|g" "$PG_HBA"

  local hba_block
  hba_block=$(
    cat <<'EOF'
local   all             all                                     peer
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
EOF
  )
  IFS=',' read -r -a pgcidrs <<< "$PG_TRUSTED_CIDRS"
  for cidr in "${pgcidrs[@]}"; do
    if [[ "$cidr" != "127.0.0.1/32" && "$cidr" != "::1/128" ]]; then
      hba_block+=$'\n'"host    all             all             ${cidr}            scram-sha-256"
    fi
  done
  upsert_block "$PG_HBA" "# BEGIN IRIS HARDENING" "# END IRIS HARDENING" "$hba_block"

  systemctl reload postgresql
}

configure_ssh() {
  log "Hardening SSH"
  [[ -f "$SSHD_CONF" ]] || { echo "Missing $SSHD_CONF" >&2; exit 1; }
  backup "$SSHD_CONF"
  set_sshd "PermitRootLogin" "no"
  set_sshd "PasswordAuthentication" "no"
  set_sshd "KbdInteractiveAuthentication" "no"
  set_sshd "ChallengeResponseAuthentication" "no"
  set_sshd "PubkeyAuthentication" "yes"
  set_sshd "MaxAuthTries" "3"
  set_sshd "ClientAliveInterval" "300"
  set_sshd "ClientAliveCountMax" "0"

  sshd -t
  systemctl reload ssh || systemctl reload sshd
}

configure_nginx() {
  log "Writing nginx hardening snippets"
  mkdir -p /etc/nginx/snippets /etc/nginx/conf.d

  cat > "$NGINX_SNIPPET_HEADERS" <<'EOF'
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://maps.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https://maps.gstatic.com https://maps.googleapis.com https://*.googleapis.com https://i.pravatar.cc; connect-src 'self' https://iris.wiredleap.com https://www.wasenderapi.com ws: wss:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self';" always;
EOF

  cat > "$NGINX_SNIPPET_HARDENING" <<'EOF'
server_tokens off;
client_max_body_size 10m;
autoindex off;

location ~ /\.(?!well-known).* { deny all; }
location ~* \.(env|git|bak|old|orig|swp|sql|ini|conf)$ { deny all; }
location ~* \.(ts|tsx|map)$ { deny all; }
location ~* /(src|node_modules|\.git)/ { deny all; }
EOF

  cat > "$NGINX_RATE_LIMIT" <<'EOF'
limit_req_zone $binary_remote_addr zone=api_per_ip:20m rate=10r/s;
limit_conn_zone $binary_remote_addr zone=conn_per_ip:20m;
EOF

  nginx -t
  systemctl reload nginx
}

configure_fail2ban() {
  log "Installing and configuring Fail2Ban"
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y fail2ban
  mkdir -p /etc/fail2ban/jail.d
  cat > "$F2B_JAIL" <<'EOF'
[sshd]
enabled = true
port = ssh
maxretry = 3
findtime = 10m
bantime = 1h

[nginx-http-auth]
enabled = true
maxretry = 10
findtime = 10m
bantime = 1h

[nginx-limit-req]
enabled = true
maxretry = 20
findtime = 10m
bantime = 30m
EOF
  systemctl enable --now fail2ban
  fail2ban-client status
}

configure_logrotate() {
  log "Configuring log rotation for nginx audit logs"
  cat > "$NGINX_LOGROTATE" <<'EOF'
/var/log/nginx/iris-access.log /var/log/nginx/iris-error.log {
    daily
    rotate 30
    missingok
    notifempty
    compress
    delaycompress
    dateext
    sharedscripts
    create 0640 www-data adm
    postrotate
        [ -s /run/nginx.pid ] && kill -USR1 $(cat /run/nginx.pid)
    endscript
}
EOF
}

validate() {
  log "Validation summary"
  echo "Open listening TCP ports:"
  ss -tulpen | grep -E ':(22|80|443|5432)\b' || true
  echo
  echo "UFW status:"
  ufw status numbered
  echo
  echo "PostgreSQL listen_addresses:"
  grep -E "^[[:space:]]*listen_addresses" "$PG_CONF" || true
  echo
  echo "SSH auth settings:"
  grep -E "^(PermitRootLogin|PasswordAuthentication|PubkeyAuthentication|MaxAuthTries|ClientAliveInterval|ClientAliveCountMax)" "$SSHD_CONF" || true
  echo
  echo "nginx headers snippet:"
  sed -n '1,200p' "$NGINX_SNIPPET_HEADERS"
  echo
  echo "fail2ban jails:"
  fail2ban-client status
}

main() {
  require_cmds
  configure_firewall
  configure_postgres
  configure_ssh
  configure_nginx
  configure_fail2ban
  configure_logrotate
  validate
  log "Hardening complete. Add 'include snippets/iris-security-headers.conf;' and"
  log "'include snippets/iris-hardening.conf;' into each nginx TLS server block."
  log "For API locations, add: limit_req zone=api_per_ip burst=20 nodelay;"
}

main "$@"
