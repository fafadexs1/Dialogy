FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-numpy python3-pandas && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/dialogy-sandbox
COPY agent-sandbox-runner.cjs ./runner.cjs
USER node
ENTRYPOINT ["node", "/opt/dialogy-sandbox/runner.cjs"]
