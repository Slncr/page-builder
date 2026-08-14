FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY packages/construktor-renderer/package.json ./packages/construktor-renderer/package.json
RUN npm ci
COPY . .
ARG VITE_API_URL=/api/v1
ARG VITE_BASE_PATH=/
ARG VITE_DEFAULT_LOCALE=ru
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_BASE_PATH=$VITE_BASE_PATH
ENV VITE_DEFAULT_LOCALE=$VITE_DEFAULT_LOCALE
RUN npm run build

FROM nginx:1.27-alpine
ARG VITE_BASE_PATH=/
COPY --from=build /app/dist /tmp/frontend-dist
RUN set -eux; \
    base="/$(printf '%s' "$VITE_BASE_PATH" | sed 's#^/*##; s#/*$##')"; \
    if [ "$base" = "/" ]; then \
      cp -R /tmp/frontend-dist/. /usr/share/nginx/html/; \
      printf '%s\n' \
        'server {' \
        '  listen 80;' \
        '  absolute_redirect off;' \
        '  root /usr/share/nginx/html;' \
        '  index index.html;' \
        '  location / { try_files $uri $uri/ /index.html; }' \
        '}' > /etc/nginx/conf.d/default.conf; \
    else \
      mkdir -p "/usr/share/nginx/html$base"; \
      cp -R /tmp/frontend-dist/. "/usr/share/nginx/html$base/"; \
      { \
        printf '%s\n' \
          'server {' \
          '  listen 80;' \
          '  absolute_redirect off;' \
          '  root /usr/share/nginx/html;' \
          '  index index.html;'; \
        printf '  location = %s { return 308 %s/; }\n' "$base" "$base"; \
        printf '  location ^~ %s/ { try_files $uri $uri/ %s/index.html; }\n' "$base" "$base"; \
        printf '%s\n' \
          '  location / { return 404; }' \
          '}'; \
      } > /etc/nginx/conf.d/default.conf; \
    fi; \
    rm -rf /tmp/frontend-dist
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
