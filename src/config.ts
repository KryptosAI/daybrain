import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface OpenContextConfig {
  activitywatch: {
    enabled: boolean;
    baseUrl: string;
    pollIntervalMinutes: number;
  };
  screenpipe: {
    enabled: boolean;
    baseUrl: string;
  };
  transports: {
    slack: {
      webhookUrl: string;
    };
    telegram: {
      botToken: string;
      chatId: string;
    };
    webhook: {
      url: string;
      headers: Record<string, string>;
    };
  };
  insights: {
    scheduleIntervalMinutes: number;
    minConfidence: number;
    maxInsightsPerRun: number;
  };
  dataDir: string;
}

const DEFAULT_CONFIG: OpenContextConfig = {
  activitywatch: {
    enabled: true,
    baseUrl: 'http://localhost:5600',
    pollIntervalMinutes: 15,
  },
  screenpipe: {
    enabled: false,
    baseUrl: 'http://localhost:3030',
  },
  transports: {
    slack: { webhookUrl: '' },
    telegram: { botToken: '', chatId: '' },
    webhook: { url: '', headers: {} },
  },
  insights: {
    scheduleIntervalMinutes: 60,
    minConfidence: 0.4,
    maxInsightsPerRun: 10,
  },
  dataDir: path.join(os.homedir(), '.daybrain', 'data'),
};

let _config: OpenContextConfig | null = null;

function configDir(): string {
  return path.join(os.homedir(), '.daybrain');
}

function configPath(): string {
  return path.join(configDir(), 'config.json');
}

export function loadConfig(): OpenContextConfig {
  if (_config) return _config;

  const cfgPath = configPath();
  if (!fs.existsSync(cfgPath)) {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify(DEFAULT_CONFIG, null, 2), { mode: 0o600 });
    fs.chmodSync(configDir(), 0o700);
    fs.chmodSync(cfgPath, 0o600);
    _config = structuredClone(DEFAULT_CONFIG);
    return _config;
  }

  fs.chmodSync(cfgPath, 0o600);

  try {
    const raw = fs.readFileSync(cfgPath, 'utf-8');
    const userConfig = JSON.parse(raw) as Partial<OpenContextConfig>;
    _config = deepMergeConfig(DEFAULT_CONFIG, userConfig);
  } catch {
    _config = structuredClone(DEFAULT_CONFIG);
  }

  return _config;
}

export function saveConfig(config: OpenContextConfig): void {
  const cfgPath = configPath();
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));
  _config = config;
}

export function getConfig(): OpenContextConfig {
  if (!_config) return loadConfig();
  return structuredClone(_config);
}

export function getDataDir(): string {
  const cfg = getConfig();
  let dir = cfg.dataDir.replace(/^~/, os.homedir());
  dir = path.resolve(dir);

  const home = os.homedir();
  if (!dir.startsWith(home + path.sep) && dir !== home) {
    throw new Error(`dataDir must be within home directory (${home}), got: ${dir}`);
  }

  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function deepMergeConfig(
  base: OpenContextConfig,
  override: Record<string, unknown>
): OpenContextConfig {
  const result: Record<string, unknown> = structuredClone(base) as unknown as Record<string, unknown>;

  for (const [key, val] of Object.entries(override)) {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const baseVal = result[key];
      if (baseVal !== null && typeof baseVal === 'object' && !Array.isArray(baseVal)) {
        result[key] = deepMergeConfig(
          baseVal as unknown as OpenContextConfig,
          val as Record<string, unknown>
        );
      } else {
        result[key] = val;
      }
    } else if (val !== undefined) {
      result[key] = val;
    }
  }

  return result as unknown as OpenContextConfig;
}

export function getConfigPath(): string {
  return configPath();
}
