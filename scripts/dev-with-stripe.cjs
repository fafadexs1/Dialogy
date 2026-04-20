const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { loadEnvConfig } = require("@next/env");

const rootDir = path.resolve(__dirname, "..");
process.env.NODE_ENV = "development";
loadEnvConfig(rootDir);

const defaultPort = "9002";
const secretWaitMs = Number.parseInt(process.env.STRIPE_WEBHOOK_SECRET_WAIT_MS || "8000", 10);
const rawDevArgs = process.argv.slice(2);
const { nextArgs: devArgs, disableStripe } = normalizeDevArgs(rawDevArgs);
const resolvedPort = resolvePortArg(devArgs) || defaultPort;
const useTurbo = resolveTurboMode();
applyLocalAppUrlOverrides(resolvedPort);
const forwardTo =
  process.env.STRIPE_WEBHOOK_FORWARD_TO ||
  `http://localhost:${resolvedPort}/api/webhooks/stripe`;
const shouldAutostartStripe = !disableStripe && !isFalsey(process.env.STRIPE_CLI_AUTOSTART);
const configuredWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || null;

let nextProcess = null;
let stripeProcess = null;
let nextStarted = false;
let shuttingDown = false;
let stripeSecret = null;
let nextStartTimer = null;
let stdoutBuffer = "";
let stderrBuffer = "";

main();

function main() {
  if (!shouldAutostartStripe) {
    logDev("Stripe CLI autostart disabled by STRIPE_CLI_AUTOSTART.");
    startNext(configuredWebhookSecret);
    return;
  }

  const stripeCommand = resolveStripeCommand();
  if (!stripeCommand) {
    logDev("Stripe CLI not found. Starting Next only.");
    startNext(configuredWebhookSecret);
    return;
  }

  const stripeArgs = ["listen", "--skip-update", "--forward-to", forwardTo];
  if (process.env.STRIPE_SECRET_KEY) {
    stripeArgs.push("--api-key", process.env.STRIPE_SECRET_KEY);
  }

  logDev(`Starting Stripe listener via ${stripeCommand.label}.`);
  logDev(`Forwarding Stripe webhooks to ${forwardTo}.`);

  if (configuredWebhookSecret) {
    logDev("Using STRIPE_WEBHOOK_SECRET from the environment while the Stripe listener boots.");
    startNext(configuredWebhookSecret);
  }

  stripeProcess = spawn(stripeCommand.command, stripeArgs, {
    cwd: rootDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  stripeProcess.stdout.on("data", (chunk) => handleStripeOutput(chunk, "stdout"));
  stripeProcess.stderr.on("data", (chunk) => handleStripeOutput(chunk, "stderr"));
  stripeProcess.on("error", (error) => {
    logDev(`Stripe CLI failed to start (${error.message}). Starting Next only.`);
    clearNextStartTimer();
    startNext();
  });
  stripeProcess.on("exit", (code, signal) => {
    flushStripeBuffers();

    if (shuttingDown) {
      return;
    }

    if (!nextStarted) {
      logDev("Stripe listener exited before the app boot finished. Starting Next without synced webhook secret.");
      clearNextStartTimer();
      startNext(configuredWebhookSecret);
      return;
    }

    const details = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    logDev(`Stripe listener stopped (${details}). Next will keep running.`);
  });

  nextStartTimer = setTimeout(() => {
    if (nextStarted) {
      return;
    }

    logDev(
      `Stripe webhook secret was not detected within ${secretWaitMs}ms. Starting Next without injecting a live secret.`
    );
    startNext(configuredWebhookSecret);
  }, secretWaitMs);
}

function startNext(injectedSecret) {
  if (nextStarted) {
    return;
  }

  nextStarted = true;
  clearNextStartTimer();

  const nextBin = path.join(rootDir, "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(nextBin)) {
    console.error(`[dev] Next CLI not found at ${nextBin}`);
    shutdown(1);
    return;
  }

  const nextArgs = buildNextArgs(devArgs, defaultPort, useTurbo);
  const childEnv = { ...process.env };

  if (injectedSecret) {
    childEnv.STRIPE_WEBHOOK_SECRET = injectedSecret;
    logDev("Injected the live Stripe webhook secret into the Next dev process.");
  }

  logDev(`Starting Next dev server on port ${resolvePortArg(nextArgs) || defaultPort}.`);

  nextProcess = spawn(process.execPath, [nextBin, ...nextArgs], {
    cwd: rootDir,
    env: childEnv,
    stdio: "inherit",
  });

  nextProcess.on("error", (error) => {
    console.error(`[dev] Next failed to start: ${error.message}`);
    shutdown(1);
  });

  nextProcess.on("exit", (code, signal) => {
    if (!shuttingDown) {
      shuttingDown = true;
      stopChild(stripeProcess);
    }

    process.exit(code ?? 0);
  });
}

function handleStripeOutput(chunk, streamName) {
  const text = chunk.toString();
  const match = text.match(/whsec_[A-Za-z0-9]+/);

  if (match && match[0] !== stripeSecret) {
    stripeSecret = match[0];

    if (!nextStarted) {
      logDev("Captured Stripe webhook secret from the listener.");
      startNext(stripeSecret);
    } else if (stripeSecret !== configuredWebhookSecret) {
      logDev("Stripe emitted a new webhook secret after Next had already started. Restart dev to resync verification if needed.");
    }
  }

  if (streamName === "stdout") {
    stdoutBuffer = relayWithPrefix(stdoutBuffer, text, process.stdout);
    return;
  }

  stderrBuffer = relayWithPrefix(stderrBuffer, text, process.stderr);
}

function flushStripeBuffers() {
  if (stdoutBuffer) {
    process.stdout.write(`[stripe] ${stdoutBuffer}\n`);
    stdoutBuffer = "";
  }

  if (stderrBuffer) {
    process.stderr.write(`[stripe] ${stderrBuffer}\n`);
    stderrBuffer = "";
  }
}

function relayWithPrefix(buffer, text, target) {
  const combined = buffer + text;
  const normalized = combined.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const trailing = lines.pop() ?? "";

  for (const line of lines) {
    if (line.length === 0) {
      target.write("[stripe]\n");
      continue;
    }

    target.write(`[stripe] ${line}\n`);
  }

  return trailing;
}

function resolveStripeCommand() {
  const configuredPath = process.env.STRIPE_CLI_PATH;
  if (configuredPath) {
    return {
      command: path.isAbsolute(configuredPath) ? configuredPath : path.join(rootDir, configuredPath),
      label: "STRIPE_CLI_PATH",
    };
  }

  const bundledWindowsCli = path.join(rootDir, "stripe.exe");
  if (fs.existsSync(bundledWindowsCli)) {
    return { command: bundledWindowsCli, label: "bundled stripe.exe" };
  }

  const bundledUnixCli = path.join(rootDir, "stripe");
  if (fs.existsSync(bundledUnixCli)) {
    return { command: bundledUnixCli, label: "bundled stripe binary" };
  }

  return { command: process.platform === "win32" ? "stripe.exe" : "stripe", label: "global stripe" };
}

function buildNextArgs(args, fallbackPort, turboEnabled) {
  const nextArgs = ["dev"];

  if (turboEnabled) {
    nextArgs.push("--turbo");
  } else {
    nextArgs.push("--webpack");
  }

  if (!hasPortArg(args)) {
    nextArgs.push("-p", fallbackPort);
  }

  return [...nextArgs, ...args];
}

function normalizeDevArgs(args) {
  let disableStripe = false;
  const nextArgs = [];

  for (const arg of args) {
    if (arg === "--no-stripe" || arg === "--stripe=false") {
      disableStripe = true;
      continue;
    }

    nextArgs.push(arg);
  }

  return { nextArgs, disableStripe };
}

function resolveTurboMode() {
  if (Object.prototype.hasOwnProperty.call(process.env, "DIALOGY_USE_TURBO")) {
    return !isFalsey(process.env.DIALOGY_USE_TURBO);
  }

  const isWindows = process.platform === "win32";
  const hasNonAsciiPath = /[^\x00-\x7F]/.test(rootDir);
  const isOneDrivePath = /OneDrive/i.test(rootDir);

  if (isWindows && (hasNonAsciiPath || isOneDrivePath)) {
    logDev(
      "Disabling Turbopack for local dev because this Windows workspace path uses OneDrive and/or non-ASCII characters."
    );
    return false;
  }

  return true;
}

function applyLocalAppUrlOverrides(port) {
  const preserveConfiguredUrls = ["1", "true", "yes", "on"].includes(
    String(process.env.DIALOGY_PRESERVE_APP_URLS || "").trim().toLowerCase()
  );
  const localOrigin = (process.env.DIALOGY_LOCAL_ORIGIN || `http://localhost:${port}`).trim();
  const appUrlKeys = ["NEXTAUTH_URL", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SITE_URL"];

  process.env.PORT = String(port);

  for (const key of appUrlKeys) {
    const currentValue = process.env[key]?.trim();

    if (!currentValue) {
      process.env[key] = localOrigin;
      logDev(`Defaulting ${key} to ${localOrigin} for local development.`);
      continue;
    }

    if (preserveConfiguredUrls || isLocalOrigin(currentValue)) {
      continue;
    }

    process.env[key] = localOrigin;
    logDev(`Overriding ${key} from ${currentValue} to ${localOrigin} for local development.`);
  }
}

function hasPortArg(args) {
  return Boolean(resolvePortArg(args));
}

function resolvePortArg(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if ((arg === "-p" || arg === "--port") && args[index + 1]) {
      return args[index + 1];
    }

    if (arg.startsWith("--port=")) {
      return arg.slice("--port=".length);
    }

    if (arg.startsWith("-p=")) {
      return arg.slice(3);
    }
  }

  return null;
}

function isLocalOrigin(value) {
  try {
    const parsed = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function isFalsey(value) {
  if (!value) {
    return false;
  }

  return ["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function clearNextStartTimer() {
  if (!nextStartTimer) {
    return;
  }

  clearTimeout(nextStartTimer);
  nextStartTimer = null;
}

function stopChild(child) {
  if (!child || child.killed) {
    return;
  }

  try {
    child.kill();
  } catch (error) {
    console.error(`[dev] Failed to stop child process: ${error.message}`);
  }
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  clearNextStartTimer();
  stopChild(stripeProcess);
  stopChild(nextProcess);

  if (!stripeProcess && !nextProcess) {
    process.exit(code);
    return;
  }

  setTimeout(() => {
    process.exit(code);
  }, 2000).unref();
}

function logDev(message) {
  process.stdout.write(`[dev] ${message}\n`);
}

["SIGINT", "SIGTERM", "SIGHUP"].forEach((signal) => {
  process.on(signal, () => shutdown(0));
});
