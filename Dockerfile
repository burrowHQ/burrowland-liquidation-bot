FROM node:20

WORKDIR /app
COPY . .

RUN npm install
CMD NEAR_ENV=mainnet node ./src/liquidateDocker.js