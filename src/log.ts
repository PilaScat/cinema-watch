const MASK = "***";
const TOKEN_PATTERN = /\d{6,}:[A-Za-z0-9_-]{30,}/g;
const BOT_URL_PATTERN = /(api\.telegram\.org\/bot)[^/\s"'?#]+/g;

export function redact(text: string, secrets: string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret !== "") result = result.split(secret).join(MASK);
  }
  return result.replace(BOT_URL_PATTERN, `$1${MASK}`).replace(TOKEN_PATTERN, MASK);
}

type Level = "info" | "warn" | "error";

export interface LoggerOptions {
  secrets: () => string[];
  sink?: (line: string) => void;
  now?: () => number;
}

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

function sanitize(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") return redact(value, secrets);
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message, secrets) };
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item, secrets));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item, secrets)]));
  }
  return value;
}

export function createLogger(options: LoggerOptions): Logger {
  const sink = options.sink ?? ((line: string) => void process.stdout.write(`${line}\n`));
  const now = options.now ?? Date.now;

  function write(level: Level, message: string, data: Record<string, unknown> = {}): void {
    const secrets = options.secrets();
    const entry = {
      t: new Date(now()).toISOString(),
      level,
      msg: redact(message, secrets),
      ...(sanitize(data, secrets) as Record<string, unknown>),
    };
    sink(JSON.stringify(entry));
  }

  return {
    info: (message, data) => write("info", message, data),
    warn: (message, data) => write("warn", message, data),
    error: (message, data) => write("error", message, data),
  };
}
