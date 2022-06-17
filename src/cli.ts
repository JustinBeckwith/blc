#!/usr/bin/env node

import meow from 'meow';
import updateNotifier from 'update-notifier';
import chalk from 'chalk';
import jsonexport from 'jsonexport';
import fs from 'fs';
import {URL} from 'url';
import {Flags, getConfig} from './config.js';
import {Format, Logger, LogLevel} from './logger.js';
import {createReport} from './junit-report.js';
import {
  LinkChecker,
  LinkState,
  LinkResult,
  CheckOptions,
  RetryInfo,
} from './index.js';

const pkg = JSON.parse(
  fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')
);
updateNotifier({pkg}).notify();

/* eslint-disable no-process-exit */

const cli = meow(
  `
    Usage
      $ linkinator LOCATION [ --arguments ]

    Positional arguments

      LOCATION
        Required. Either the URLs or the paths on disk to check for broken links.

    Flags

      --concurrency
        The number of connections to make simultaneously. Defaults to 100.

      --config
          Path to the config file to use. Looks for \`linkinator.config.json\` by default.

      --directory-listing
          Include an automatic directory index file when linking to a directory.
          Defaults to 'false'.

      --format, -f
          Return the data in CSV, JSON or JUNIT format.

      --help
          Show this command.

      --markdown
          Automatically parse and scan markdown if scanning from a location on disk.

      --recurse, -r
          Recursively follow links on the same root domain.

      --retry,
          Automatically retry requests that return HTTP 429 responses and include
          a 'retry-after' header. Defaults to false.

      --retry-errors,
          Automatically retry requests that return 5xx or unknown response.

      --retry-errors-count,
          How many times should an error be retried?

      --retry-errors-jitter,
          Random jitter applied to error retry.

      --server-root
          When scanning a locally directory, customize the location on disk
          where the server is started.  Defaults to the path passed in [LOCATION].

      --skip, -s
          List of urls in regexy form to not include in the check.

      --timeout
          Request timeout in ms.  Defaults to 0 (no timeout).

      --url-rewrite-search
          Pattern to search for in urls.  Must be used with --url-rewrite-replace.

      --url-rewrite-replace
          Expression used to replace search content.  Must be used with --url-rewrite-search.

      --verbosity
          Override the default verbosity for this command. Available options are
          'debug', 'info', 'warning', 'error', and 'none'.  Defaults to 'warning'.

    Examples
      $ linkinator docs/
      $ linkinator https://www.google.com
      $ linkinator . --recurse
      $ linkinator . --skip www.googleapis.com
      $ linkinator . --format CSV
`,
  {
    importMeta: import.meta,
    flags: {
      config: {type: 'string'},
      concurrency: {type: 'number'},
      recurse: {type: 'boolean', alias: 'r'},
      skip: {type: 'string', alias: 's', isMultiple: true},
      format: {type: 'string', alias: 'f'},
      silent: {type: 'boolean'},
      timeout: {type: 'number'},
      markdown: {type: 'boolean'},
      serverRoot: {type: 'string'},
      verbosity: {type: 'string'},
      directoryListing: {type: 'boolean'},
      retry: {type: 'boolean'},
      retryErrors: {type: 'boolean'},
      retryErrorsCount: {type: 'number', default: 5},
      retryErrorsJitter: {type: 'number', default: 3000},
      urlRewriteSearch: {type: 'string'},
      urlReWriteReplace: {type: 'string'},
    },
    booleanDefault: undefined,
  }
);

let flags: Flags;

async function main() {
  if (cli.input.length < 1) {
    cli.showHelp();
    return;
  }
  flags = await getConfig(cli.flags);
  if (
    (flags.urlRewriteReplace && !flags.urlRewriteSearch) ||
    (flags.urlRewriteSearch && !flags.urlRewriteReplace)
  ) {
    throw new Error(
      'The url-rewrite-replace flag must be used with the url-rewrite-search flag.'
    );
  }

  const start = Date.now();
  const verbosity = parseVerbosity(flags);
  const format = parseFormat(flags);
  const logger = new Logger(verbosity, format);

  logger.error(`🏊‍♂️ crawling ${cli.input}`);

  const checker = new LinkChecker();
  checker.on('retry', (info: RetryInfo) => {
    logger.warn(`Retrying: ${info.url} in ${info.secondsUntilRetry} seconds.`);
  });
  checker.on('link', (link: LinkResult) => {
    let state = '';
    switch (link.state) {
      case LinkState.BROKEN:
        state = `[${chalk.red(link.status!.toString())}]`;
        logger.error(`${state} ${chalk.gray(link.url)}`);
        break;
      case LinkState.OK:
        state = `[${chalk.green(link.status!.toString())}]`;
        logger.warn(`${state} ${chalk.gray(link.url)}`);
        break;
      case LinkState.SKIPPED:
        state = `[${chalk.grey('SKP')}]`;
        logger.info(`${state} ${chalk.gray(link.url)}`);
        break;
    }
  });
  const opts: CheckOptions = {
    path: cli.input,
    recurse: flags.recurse,
    timeout: Number(flags.timeout),
    markdown: flags.markdown,
    concurrency: Number(flags.concurrency),
    serverRoot: flags.serverRoot,
    directoryListing: flags.directoryListing,
    retry: flags.retry,
    retryErrors: flags.retryErrors,
    retryErrorsCount: Number(flags.retryErrorsCount),
    retryErrorsJitter: Number(flags.retryErrorsJitter),
  };
  if (flags.skip) {
    if (typeof flags.skip === 'string') {
      opts.linksToSkip = flags.skip.split(/[\s,]+/).filter(x => !!x);
    } else if (Array.isArray(flags.skip)) {
      // with `isMultiple` enabled in meow, a comma delimeted list will still
      // be passed as an array, but with a single element that still needs to
      // be split.
      opts.linksToSkip = [];
      for (const skip of flags.skip) {
        const rules = skip.split(/[\s,]+/).filter(x => !!x);
        opts.linksToSkip.push(...rules);
      }
    }
  }
  if (flags.urlRewriteSearch && flags.urlRewriteReplace) {
    opts.urlRewriteExpressions = [
      {
        pattern: new RegExp(flags.urlRewriteSearch),
        replacement: flags.urlRewriteReplace,
      },
    ];
  }
  const result = await checker.check(opts);
  const filteredResults = result.links.filter(link => {
    switch (link.state) {
      case LinkState.OK:
        return verbosity <= LogLevel.WARNING;
      case LinkState.BROKEN:
        if (verbosity > LogLevel.DEBUG) {
          link.failureDetails = undefined;
        }
        return verbosity <= LogLevel.ERROR;
      case LinkState.SKIPPED:
        return verbosity <= LogLevel.INFO;
    }
  });
  if (format === Format.JSON) {
    result.links = filteredResults;
    console.log(JSON.stringify(result, null, 2));
    return;
  } else if (format === Format.JUNIT) {
    result.links = filteredResults;
    const junitReport = createReport(result);
    console.log(junitReport);
    return;
  } else if (format === Format.CSV) {
    result.links = filteredResults;
    const csv = await jsonexport(result.links);
    console.log(csv);
    return;
  } else {
    // Build a collection scanned links, collated by the parent link used in
    // the scan.  For example:
    // {
    //   "./README.md": [
    //     {
    //       url: "https://img.shields.io/npm/v/linkinator.svg",
    //       status: 200
    //       ....
    //     }
    //   ],
    // }
    const parents = result.links.reduce((acc, curr) => {
      const parent = curr.parent || '';
      if (!acc[parent]) {
        acc[parent] = [];
      }
      acc[parent].push(curr);
      return acc;
    }, {} as {[index: string]: LinkResult[]});

    Object.keys(parents).forEach(parent => {
      // prune links based on verbosity
      const links = parents[parent].filter(link => {
        if (verbosity === LogLevel.NONE) {
          return false;
        }
        if (link.state === LinkState.BROKEN) {
          return true;
        }
        if (link.state === LinkState.OK) {
          if (verbosity <= LogLevel.WARNING) {
            return true;
          }
        }
        if (link.state === LinkState.SKIPPED) {
          if (verbosity <= LogLevel.INFO) {
            return true;
          }
        }
        return false;
      });
      if (links.length === 0) {
        return;
      }
      logger.error(chalk.blue(parent));
      links.forEach(link => {
        let state = '';
        switch (link.state) {
          case LinkState.BROKEN:
            state = `[${chalk.red(link.status!.toString())}]`;
            logger.error(`  ${state} ${chalk.gray(link.url)}`);
            logger.debug(JSON.stringify(link.failureDetails, null, 2));
            break;
          case LinkState.OK:
            state = `[${chalk.green(link.status!.toString())}]`;
            logger.warn(`  ${state} ${chalk.gray(link.url)}`);
            break;
          case LinkState.SKIPPED:
            state = `[${chalk.grey('SKP')}]`;
            logger.info(`  ${state} ${chalk.gray(link.url)}`);
            break;
        }
      });
    });
  }

  const total = (Date.now() - start) / 1000;
  const scannedLinks = result.links.filter(x => x.state !== LinkState.SKIPPED);
  if (!result.passed) {
    const borked = result.links.filter(x => x.state === LinkState.BROKEN);
    logger.error(
      chalk.bold(
        `${chalk.red('ERROR')}: Detected ${
          borked.length
        } broken links. Scanned ${chalk.yellow(
          scannedLinks.length.toString()
        )} links in ${chalk.cyan(total.toString())} seconds.`
      )
    );
    process.exit(1);
  }

  logger.error(
    chalk.bold(
      `🤖 Successfully scanned ${chalk.green(
        scannedLinks.length.toString()
      )} links in ${chalk.cyan(total.toString())} seconds.`
    )
  );
}

function parseVerbosity(flags: Flags): LogLevel {
  if (flags.silent && flags.verbosity) {
    throw new Error(
      'The SILENT and VERBOSITY flags cannot both be defined. Please consider using VERBOSITY only.'
    );
  }
  if (flags.silent) {
    return LogLevel.ERROR;
  }
  if (!flags.verbosity) {
    return LogLevel.WARNING;
  }
  const verbosity = flags.verbosity.toUpperCase();
  const options = Object.values(LogLevel);
  if (!options.includes(verbosity)) {
    throw new Error(
      `Invalid flag: VERBOSITY must be one of [${options.join(',')}]`
    );
  }
  return LogLevel[verbosity as keyof typeof LogLevel];
}

function parseFormat(flags: Flags): Format {
  if (!flags.format) {
    return Format.TEXT;
  }
  flags.format = flags.format.toUpperCase();
  const options = Object.values(Format);
  if (!options.includes(flags.format)) {
    throw new Error("Invalid flag: FORMAT must be 'TEXT', 'JSON', or 'CSV'.");
  }
  return Format[flags.format as keyof typeof Format];
}

main();
