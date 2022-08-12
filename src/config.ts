import {promises as fs} from 'fs';
import path from 'path';

export interface Flags {
  concurrency?: number;
  config?: string;
  recurse?: boolean;
  skip?: string | string[];
  format?: string;
  silent?: boolean;
  verbosity?: string;
  timeout?: number;
  markdown?: boolean;
  serverRoot?: string;
  directoryListing?: boolean;
  retry?: boolean;
  retryErrors?: boolean;
  retryErrorsCount?: number;
  retryErrorsJitter?: number;
  urlRewriteSearch?: string;
  urlRewriteReplace?: string;
}

export async function getConfig(flags: Flags) {
  // check to see if a config file path was passed
  const configPath = flags.config || 'linkinator.config.json';
  let config: Flags = {};

  if (flags.config) {
    config = await parseConfigFile(configPath);
  }
  const strippedFlags = Object.assign({}, flags);
  Object.entries(strippedFlags).forEach(([key, value]) => {
    if (
      typeof value === 'undefined' ||
      (Array.isArray(value) && value.length === 0)
    ) {
      delete (strippedFlags as {[index: string]: {}})[key];
    }
  });

  // combine the flags passed on the CLI with the flags in the config file,
  // with CLI flags getting precedence
  config = Object.assign({}, config, strippedFlags);
  return config;
}

const validConfigExtensions = ['js', 'mjs', 'cjs', 'json'];
type ConfigExtensions = typeof validConfigExtensions[number];

async function parseConfigFile(configPath: string): Promise<Flags> {
  const typeOfConfig = getTypeOfConfig(configPath);

  switch (typeOfConfig) {
    case 'json':
      return readJsonConfigFile(configPath);
    case 'js':
    case 'mjs':
    case 'cjs':
      return importConfigFile(configPath);
  }

  throw new Error(`Config file ${configPath} is invalid`);
}

function getTypeOfConfig(configPath: string): ConfigExtensions {
  const lastDotIndex = configPath.lastIndexOf('.');

  // Returning json in case file doesn't have an extension for backward compatibility
  if (lastDotIndex === -1) return 'json';

  const configFileExtension: string = configPath.slice(lastDotIndex + 1);

  if (validConfigExtensions.includes(configFileExtension)) {
    return configFileExtension as ConfigExtensions;
  }

  throw new Error(
    `Config file should be either of ${validConfigExtensions.join(',')}`
  );
}

async function importConfigFile(configPath: string): Promise<Flags> {
  const config = (await import(path.join(process.cwd(), configPath))).default;
  return config;
}

async function readJsonConfigFile(configPath: string): Promise<Flags> {
  try {
    const configFileContents: string = await fs.readFile(configPath, {
      encoding: 'utf-8',
    });
    return JSON.parse(configFileContents);
  } catch (e) {
    console.error(`Unable to read or parse the JSON config file ${configPath}`);
    throw e;
  }
}
