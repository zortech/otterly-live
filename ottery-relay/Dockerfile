FROM node:22-alpine

# tini: proper PID 1 — ensures SIGTERM propagates to FFmpeg child processes on docker stop
# ffmpeg: system binary used directly (no ffmpeg-static, no ASAR)
RUN apk add --no-cache ffmpeg tini openssl

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# /app/data — SQLite DB and initial-token.txt land here
VOLUME ["/app/data"]

EXPOSE 3800 1936

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${RELAY_PORT:-3800}/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
