FROM nginx:alpine

COPY docs/ /usr/share/nginx/html/

# Zeabur expects port 8080 by default; nginx defaults to 80 — override.
RUN sed -i 's/listen       80;/listen       8080;/' /etc/nginx/conf.d/default.conf

# Don't try to compress .webp (already compressed); set basic caching for assets.
RUN cat > /etc/nginx/conf.d/cache.conf <<'EOF'
map $sent_http_content_type $expires_for_static {
    default                 off;
    "image/jpeg"            7d;
    "image/webp"            7d;
    "image/png"             7d;
    "application/javascript" 1d;
    "text/css"              1d;
    "application/manifest+json" 1h;
}
EOF

RUN sed -i 's|index  index.html index.htm;|index  index.html;\n    expires $expires_for_static;|' /etc/nginx/conf.d/default.conf

EXPOSE 8080
