FROM node:20-alpine
RUN apk add --no-cache sox               # audio processing CLI
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["node", "index.js"]
