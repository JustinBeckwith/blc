import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { glob } from 'glob';

export type UrlRewriteExpression = {
	pattern: RegExp;
	replacement: string;
};

export type CheckOptions = {
	concurrency?: number;
	port?: number;
	path: string | string[];
	recurse?: boolean;
	timeout?: number;
	markdown?: boolean;
	linksToSkip?: string[] | ((link: string) => Promise<boolean>);
	serverRoot?: string;
	directoryListing?: boolean;
	retry?: boolean;
	retryErrors?: boolean;
	retryErrorsCount?: number;
	retryErrorsJitter?: number;
	urlRewriteExpressions?: UrlRewriteExpression[];
	userAgent?: string;
	excludeStatuses?: number[];
};

export type InternalCheckOptions = {
	syntheticServerRoot?: string;
	staticHttpServerHost?: string;
} & CheckOptions;

export const DEFAULT_USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.117 Safari/537.36';

/**
 * Validate the provided flags all work with each other.
 * @param options CheckOptions passed in from the CLI (or API)
 */
export async function processOptions(
	options_: CheckOptions,
): Promise<InternalCheckOptions> {
	const options: InternalCheckOptions = { ...options_ };

	// Ensure at least one path is provided
	if (options.path.length === 0) {
		throw new Error('At least one path must be provided');
	}

	// Normalize options.path to an array of strings
	if (!Array.isArray(options.path)) {
		options.path = [options.path];
	}

	// Disable directory listings by default
	if (options.directoryListing === undefined) {
		options.directoryListing = false;
	}

	// Ensure we do not mix http:// and file system paths.  The paths passed in
	// must all be filesystem paths, or HTTP paths.
	let isUrlType: boolean | undefined;
	for (const path of options.path) {
		const innerIsUrlType = path.startsWith('http');
		if (isUrlType === undefined) {
			isUrlType = innerIsUrlType;
		} else if (innerIsUrlType !== isUrlType) {
			throw new Error(
				'Paths cannot be mixed between HTTP and local filesystem paths.',
			);
		}
	}

	// If there is a server root, make sure there are no HTTP paths
	if (options.serverRoot && isUrlType) {
		throw new Error(
			"'serverRoot' cannot be defined when the 'path' points to an HTTP endpoint.",
		);
	}

	options.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
	options.serverRoot &&= path.normalize(options.serverRoot);

	// Expand globs into paths
	if (!isUrlType) {
		const paths: string[] = [];
		for (const filePath of options.path) {
			// The glob path provided is relative to the serverRoot. For example,
			// if the serverRoot is test/fixtures/nested, and the glob is "*/*.html",
			// The glob needs to be calculated from the serverRoot directory.
			let fullPath = options.serverRoot
				? path.join(options.serverRoot, filePath)
				: filePath;

			// Node-glob only accepts unix style path separators as of 8.x
			fullPath = fullPath.split(path.sep).join('/');
			const expandedPaths = await glob(fullPath);
			if (expandedPaths.length === 0) {
				throw new Error(
					`The provided glob "${filePath}" returned 0 results. The current working directory is "${process.cwd()}".`,
				);
			}

			// After resolving the globs, the paths need to be returned to their
			// original form, without the serverRoot included in the path.
			for (let p of expandedPaths) {
				p = path.normalize(p);
				if (options.serverRoot) {
					const contractedPath = p
						.split(path.sep)
						.filter(Boolean)
						.slice(options.serverRoot.split(path.sep).filter(Boolean).length)
						.join(path.sep);
					paths.push(contractedPath);
				} else {
					paths.push(p);
				}
			}
		}

		options.path = paths;
	}

	// Enable markdown if someone passes a flag/glob right at it
	if (options.markdown === undefined) {
		for (const p of options.path) {
			if (path.extname(p).toLowerCase() === '.md') {
				options.markdown = true;
			}
		}
	}

	// Figure out which directory should be used as the root for the web server,
	// and how that impacts the path to the file for the first request.
	if (!options.serverRoot && !isUrlType) {
		// If the serverRoot wasn't defined, and there are multiple paths, just
		// use process.cwd().
		if (options.path.length > 1) {
			options.serverRoot = process.cwd();
		} else {
			// If there's a single path, try to be smart and figure it out
			const s = await fs.stat(options.path[0]);
			options.serverRoot = options.path[0];
			if (s.isFile()) {
				const pathParts = options.path[0].split(path.sep);
				options.path = [path.join('.', pathParts.at(-1) ?? '')];
				options.serverRoot = pathParts.slice(0, -1).join(path.sep) || '.';
			} else {
				options.serverRoot = options.path[0];
				options.path = '/';
			}

			options.syntheticServerRoot = options.serverRoot;
		}
	}

	return options;
}
