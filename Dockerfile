FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg espeak-ng fonts-noto-cjk ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.mjs archive-style.mjs auth.mjs framepack.mjs plan.schema.json ./
COPY public ./public
COPY tools/grant-quota.mjs ./tools/grant-quota.mjs
RUN mkdir /data && chown node:node /data
USER node
ENV PUBLIC_MODE=1 DATA_ROOT=/data HOST=0.0.0.0 PORT=3817
EXPOSE 3817
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3817/api/session').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
