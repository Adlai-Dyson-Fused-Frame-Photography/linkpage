# Tiny image: Node 22 (built-in SQLite) and zero npm dependencies.
FROM node:22-alpine
ENV NODE_ENV=production DATA_DIR=/data PORT=8765
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
# /data holds the database and your uploaded images. Mount a volume here.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8765)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings", "src/server.js"]
