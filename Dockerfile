FROM node:20-alpine

# Public client ID — needed at build time for Vite to bundle into frontend
ENV SHOPIFY_API_KEY=415f4f6f5a2b9bbe6ec041251e753694
ENV NODE_ENV=production
ENV PORT=8081

WORKDIR /app

# Copy everything from web/
COPY web/ .

# Install backend dependencies
RUN npm install --production=false

# Cache bust - Coolify changes this ARG each deploy
ARG COOLIFY_BUILD_SECRETS_HASH
# Install frontend dependencies and build
RUN cd frontend && npm install && npm run build

EXPOSE 8081

CMD ["npm", "run", "serve"]
