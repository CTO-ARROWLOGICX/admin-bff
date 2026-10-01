FROM node:20-alpine

WORKDIR /app

# @zafabit/service-kit is vendored (vendor/service-kit) and .npmrc sets
# install-links=true, so `npm ci` is fully self-contained — no registry, no
# SSH, no build flags. Works the same for `npm ci` on a bare droplet.
COPY package.json package-lock.json .npmrc ./
COPY vendor ./vendor
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
EXPOSE 4012
CMD ["node", "src/server.js"]
