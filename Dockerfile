FROM node:16.15.1-alpine

ARG GIT_COMMIT
ENV GIT_COMMIT_HASH=$GIT_COMMIT

RUN apk update &&  \
    apk upgrade && \
    apk -Uuv add --no-cache make g++ git py-pip jq openssh curl openssh docker &&  \
    pip install --upgrade pip awscli

RUN adduser -S dolomite
RUN mkdir -p /home/dolomite/app
RUN chown dolomite -R /home/dolomite/app
USER dolomite

WORKDIR /home/dolomite/app

COPY ./.env* ./
COPY ./package.json ./yarn.lock ./
RUN yarn install --frozen-lockfile

COPY ./src ./src
COPY ./__tests__ ./__tests__
COPY ./tsconfig.json ./tsconfig.json
COPY ./environment.d.ts ./environment.d.ts

RUN npm run build

CMD ["npm", "start"]
