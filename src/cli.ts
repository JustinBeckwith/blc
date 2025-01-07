#!/usr/bin/env node

import process from 'node:process';
import chalk from 'chalk';
import meow from 'meow';
import { type Flags, getConfig } from './config.js';
import {
	type CheckOptions,
	LinkChecker,
	type LinkResult,
	LinkState,
	type RetryInfo,
} from './index.js';
import { Format, LogLevel, Logger } from './logger.js';

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
          Return the data in CSV, JSON, or MD (Markdown) format.

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

			--user-agent
					The user agent passed in all HTTP requests. Defaults to 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.117 Safari/537.36'

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
			config: { type: 'string' },
			concurrency: { type: 'number' },
			recurse: { type: 'boolean', shortFlag: 'r' },
			skip: { type: 'string', shortFlag: 's', isMultiple: true },
			format: { type: 'string', shortFlag: 'f' },
			silent: { type: 'boolean' },
			timeout: { type: 'number' },
			markdown: { type: 'boolean' },
			serverRoot: { type: 'string' },
			verbosity: { type: 'string' },
			directoryListing: { type: 'boolean' },
			retry: { type: 'boolean' },
			retryErrors: { type: 'boolean' },
			retryErrorsCount: { type: 'number', default: 5 },
			retryErrorsJitter: { type: 'number', default: 3000 },
			urlRewriteSearch: { type: 'string' },
			urlReWriteReplace: { type: 'string' },
		},
		booleanDefault: undefined,
	},
);

let flags: Flags;

async function main() {
	if (cli.input.length === 0) {
		cli.showHelp();
		return;
	}

	flags = await getConfig(cli.flags);
	if (
		(flags.urlRewriteReplace && !flags.urlRewriteSearch) ||
		(flags.urlRewriteSearch && !flags.urlRewriteReplace)
	) {
		throw new Error(
			'The url-rewrite-replace flag must be used with the url-rewrite-search flag.',
		);
	}

	const start = Date.now();
	const verbosity = parseVerbosity(flags);
	const format = parseFormat(flags);
	const logger = new Logger(verbosity, format);

	logger.error(`🏊‍♂️ crawling ${cli.input.join(' ')}`);

	const checker = new LinkChecker();
	if (format === Format.CSV) {
		const header = 'url,status,state,parent,failureDetails';
		console.log(header);
	}

	checker.on('retry', (info: RetryInfo) => {
		logger.warn(`Retrying: ${info.url} in ${info.secondsUntilRetry} seconds.`);
	});
	checker.on('link', (link: LinkResult) => {
		let state = '';
		switch (link.state) {
			case LinkState.BROKEN: {
				state = `[${chalk.red(link.status?.toString())}]`;
				logger.error(`${state} ${chalk.gray(link.url)}`);
				break;
			}

			case LinkState.OK: {
				state = `[${chalk.green(link.status?.toString())}]`;
				logger.warn(`${state} ${chalk.gray(link.url)}`);
				break;
			}

			case LinkState.SKIPPED: {
				state = `[${chalk.grey('SKP')}]`;
				logger.info(`${state} ${chalk.gray(link.url)}`);
				break;
			}
		}

		if (format === Format.CSV) {
			const showIt = shouldShowResult(link, verbosity);
			if (showIt) {
				const failureDetails = link.failureDetails
					? JSON.stringify(link.failureDetails, null, 2)
					: '';
				console.log(
					`"${link.url}",${link.status},${link.state},"${link.parent || ''}","${failureDetails}"`,
				);
			}
		}
	});
	const options: CheckOptions = {
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
			options.linksToSkip = flags.skip.split(/[\s,]+/).filter(Boolean);
		} else if (Array.isArray(flags.skip)) {
			// With `isMultiple` enabled in meow, a comma delimeted list will still
			// be passed as an array, but with a single element that still needs to
			// be split.
			options.linksToSkip = [];
			for (const skip of flags.skip) {
				const rules = skip.split(/[\s,]+/).filter(Boolean);
				options.linksToSkip.push(...rules);
			}
		}
	}

	if (flags.urlRewriteSearch && flags.urlRewriteReplace) {
		options.urlRewriteExpressions = [
			{
				pattern: new RegExp(flags.urlRewriteSearch),
				replacement: flags.urlRewriteReplace,
			},
		];
	}

	const result = await checker.check(options);
	const filteredResults = result.links.filter((link) =>
		shouldShowResult(link, verbosity),
	);
	if (format === Format.JSON) {
		result.links = filteredResults;
		console.log(JSON.stringify(result, null, 2));
		return;
	}

	if (format === Format.CSV) {
		return;
	}

	if (format === Format.MD) {
		result.links = filteredResults;
		// Output the results in Markdown table format
		console.log('# Link Check Results\n');
		console.log('| URL | Status | State | Parent | Failure Details |');
		console.log('|-----|--------|-------|--------|-----------------|');
		for (const link of result.links) {
			const failureDetails =
				link.failureDetails && verbosity <= LogLevel.DEBUG
					? JSON.stringify(link.failureDetails).replace(/\|/g, '\\|')
					: '';
			console.log(
				`| ${link.url} | ${link.status} | ${link.state} | ${link.parent || ''} | ${failureDetails} |`,
			);
		}
		return;
	}

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
	const parents = result.links.reduce<Record<string, LinkResult[]>>(
		(accumulator, current) => {
			const parent = current.parent || '';
			accumulator[parent] ||= [];

			accumulator[parent].push(current);
			return accumulator;
		},
		{},
	);

	for (const parent of Object.keys(parents)) {
		// Prune links based on verbosity
		const links = parents[parent].filter((link) => {
			if (verbosity === LogLevel.NONE) {
				return false;
			}

			if (link.state === LinkState.BROKEN) {
				return true;
			}

			if (link.state === LinkState.OK && verbosity <= LogLevel.WARNING) {
				return true;
			}

			if (link.state === LinkState.SKIPPED && verbosity <= LogLevel.INFO) {
				return true;
			}

			return false;
		});
		if (links.length === 0) {
			continue;
		}

		logger.error(chalk.blue(parent));
		for (const link of links) {
			let state = '';
			switch (link.state) {
				case LinkState.BROKEN: {
					state = `[${chalk.red(link.status?.toString())}]`;
					logger.error(`  ${state} ${chalk.gray(link.url)}`);
					logger.debug(JSON.stringify(link.failureDetails, null, 2));
					break;
				}

				case LinkState.OK: {
					state = `[${chalk.green(link.status?.toString())}]`;
					logger.warn(`  ${state} ${chalk.gray(link.url)}`);
					break;
				}

				case LinkState.SKIPPED: {
					state = `[${chalk.grey('SKP')}]`;
					logger.info(`  ${state} ${chalk.gray(link.url)}`);
					break;
				}
			}
		}
	}

	const total = (Date.now() - start) / 1000;
	const scannedLinks = result.links.filter(
		(x) => x.state !== LinkState.SKIPPED,
	);
	if (!result.passed) {
		const borked = result.links.filter((x) => x.state === LinkState.BROKEN);
		logger.error(
			chalk.bold(
				`${chalk.red('ERROR')}: Detected ${
					borked.length
				} broken links. Scanned ${chalk.yellow(
					scannedLinks.length.toString(),
				)} links in ${chalk.cyan(total.toString())} seconds.`,
			),
		);
		process.exit(1);
	}

	logger.error(
		chalk.bold(
			`🤖 Successfully scanned ${chalk.green(
				scannedLinks.length.toString(),
			)} links in ${chalk.cyan(total.toString())} seconds.`,
		),
	);
}

function parseVerbosity(flags: Flags): LogLevel {
	if (flags.silent && flags.verbosity) {
		throw new Error(
			'The SILENT and VERBOSITY flags cannot both be defined. Please consider using VERBOSITY only.',
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
			`Invalid flag: VERBOSITY must be one of [${options.join(',')}]`,
		);
	}

	return LogLevel[verbosity as keyof typeof LogLevel];
}

function parseFormat(flags: Flags): Format {
	if (!flags.format) {
		return Format.TEXT;
	}

	flags.format = flags.format.toUpperCase();
	const options = Object.values(Format).map((format) => format.toString());
	if (!options.includes(flags.format)) {
		throw new Error(
			"Invalid flag: FORMAT must be one of 'TEXT', 'JSON', 'CSV', or 'MD'.",
		);
	}

	return Format[flags.format as keyof typeof Format];
}

function shouldShowResult(link: LinkResult, verbosity: LogLevel) {
	switch (link.state) {
		case LinkState.OK: {
			return verbosity <= LogLevel.WARNING;
		}

		case LinkState.BROKEN: {
			if (verbosity > LogLevel.DEBUG) {
				link.failureDetails = undefined;
			}

			return verbosity <= LogLevel.ERROR;
		}

		case LinkState.SKIPPED: {
			return verbosity <= LogLevel.INFO;
		}
	}
}

await main();
