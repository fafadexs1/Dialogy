FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer libreoffice-calc && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/dialogy-office
COPY agent-legacy-office-runner.cjs ./runner.cjs
USER node
ENTRYPOINT ["node", "/opt/dialogy-office/runner.cjs"]
