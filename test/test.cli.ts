import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import util from 'node:util';
import { execa } from 'execa';
import { describe, it } from 'mocha';
import enableDestroy from 'server-destroy';
import stripAnsi from 'strip-ansi';
import { type LinkResult, LinkState } from '../src/index.js';

describe('cli', function () {
	let server: http.Server;
	this.timeout(20_000);

	const package_ = JSON.parse(
		fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
	) as { bin: { linkinator: string } };
	const { linkinator } = package_.bin;
	const node = 'node';

	afterEach(async () => {
		if (server) {
			await util.promisify(server.destroy)();
		}
	});

	it('should show output for failures', async () => {
		const response = await execa(node, [linkinator, 'test/fixtures/basic'], {
			reject: false,
		});
		assert.match(stripAnsi(response.stderr), /ERROR: Detected 1 broken links/);
	});

	it('should pass successful markdown scan', async () => {
		const response = await execa(node, [
			linkinator,
			'test/fixtures/markdown/README.md',
		]);
		assert.match(response.stderr, /Successfully scanned/);
	});

	it('should allow multiple paths', async () => {
		const response = await execa(node, [
			linkinator,
			'test/fixtures/markdown/unlinked.md',
			'test/fixtures/markdown/README.md',
		]);
		assert.match(response.stderr, /Successfully scanned/);
	});

	it('should show help if no params are provided', async () => {
		const response = await execa(node, [linkinator], {
			reject: false,
		});
		assert.match(response.stdout, /\$ linkinator LOCATION \[ --arguments ]/);
	});

	it('should flag skipped links', async () => {
		const response = await execa(node, [
			linkinator,
			'--verbosity',
			'INFO',
			'--skip',
			'LICENSE.md, unlinked.md',
			'test/fixtures/markdown/*.md',
		]);
		const stdout = stripAnsi(response.stdout);
		const stderr = stripAnsi(response.stderr);
		assert.match(stdout, /\[SKP]/);
		// Make sure we don't report skipped links in the count
		assert.match(stderr, /scanned 2 links/);
	});

	it('should allow --skip multiple times', async () => {
		const response = await execa(node, [
			linkinator,
			'--verbosity',
			'INFO',
			'--skip',
			'LICENSE.md',
			'--skip',
			'unlinked.md',
			'test/fixtures/markdown/README.md',
		]);
		const stdout = stripAnsi(response.stdout);
		const stderr = stripAnsi(response.stderr);
		assert.match(stdout, /\[SKP]/);
		// Make sure we don't report skipped links in the count
		assert.match(stderr, /scanned 2 links/);
	});

	it('should provide CSV if asked nicely', async () => {
		const response = await execa(node, [
			linkinator,
			'--format',
			'csv',
			'test/fixtures/markdown/README.md',
		]);
		assert.match(response.stdout, /README.md",200,OK,/);
	});

	it('should serialize errors with CSV and verbose output', async () => {
		const response = await execa(node, [
			linkinator,
			'--format',
			'csv',
			'--verbosity',
			'DEBUG',
			'test/fixtures/localbroke/README.md',
		]);
		// This is a very lazy way of trying to recognize the JSON we expect
		// in CSV without using a CSV parser.
		assert.match(response.stdout, /statusText": "Not Found"/);
	});

	it('should provide JSON if asked nicely', async () => {
		const response = await execa(node, [
			linkinator,
			'--format',
			'json',
			'test/fixtures/markdown/README.md',
		]);
		const output = JSON.parse(response.stdout) as Record<string, string>;
		assert.ok(output.links);
	});

	it('should provide Markdown if asked nicely', async () => {
		const response = await execa(node, [
			linkinator,
			'--format',
			'md',
			'test/fixtures/markdown/README.md',
		]);
		assert.match(
			response.stdout,
			/\| test\/fixtures\/markdown\/README.md \| 200 \| OK \|/,
		);
		assert.match(
			response.stdout,
			/\| URL \| Status \| State \| Parent \| Failure Details \|/,
		);
		assert.match(
			response.stdout,
			/\|-----|--------|-------|--------|-----------------|/,
		);
	});

	it('should look for linkinator.config.json in the cwd', async () => {
		const response = await execa(node, ['../../../build/src/cli.js', '.'], {
			cwd: 'test/fixtures/defaultconfig',
		});
		let output: { passed: boolean };
		try {
			output = JSON.parse(response.stdout);
			assert.strictEqual(output.passed, true);
		} catch (e) {
			assert.fail('Expected JSON output');
		}
	});

	it('should not show links if --silent', async () => {
		const response = await execa(node, [
			linkinator,
			'--silent',
			'test/fixtures/markdown/README.md',
		]);
		assert.doesNotMatch(response.stdout, /\[/);
	});

	it('should not show 200 links if verbosity is ERROR with JSON', async () => {
		const response = await execa(node, [
			linkinator,
			'--verbosity',
			'ERROR',
			'--format',
			'JSON',
			'test/fixtures/markdown/README.md',
		]);
		const links = JSON.parse(response.stdout).links as LinkResult[];
		for (const link of links) {
			assert.strictEqual(link.state, LinkState.BROKEN);
		}
	});

	it('should accept a server-root', async () => {
		const response = await execa(node, [
			linkinator,
			'--markdown',
			'--server-root',
			'test/fixtures/markdown',
			'README.md',
		]);
		assert.match(response.stderr, /Successfully scanned/);
	});

	it('should accept globs', async () => {
		const response = await execa(node, [
			linkinator,
			'test/fixtures/markdown/*.md',
			'test/fixtures/markdown/**/*.md',
		]);
		assert.match(response.stderr, /Successfully scanned/);
	});

	it('should throw on invalid format', async () => {
		const response = await execa(
			node,
			[linkinator, './README.md', '--format', 'LOL'],
			{
				reject: false,
			},
		);
		assert.match(response.stderr, /FORMAT must be/);
	});

	it('should throw on invalid verbosity', async () => {
		const response = await execa(
			node,
			[linkinator, './README.md', '--VERBOSITY', 'LOL'],
			{
				reject: false,
			},
		);
		assert.match(response.stderr, /VERBOSITY must be/);
	});

	it('should throw when verbosity and silent are flagged', async () => {
		const response = await execa(
			node,
			[linkinator, './README.md', '--verbosity', 'DEBUG', '--silent'],
			{
				reject: false,
			},
		);
		assert.match(response.stderr, /The SILENT and VERBOSITY flags/);
	});

	it('should show no output for verbosity=NONE', async () => {
		const response = await execa(
			node,
			[linkinator, 'test/fixtures/basic', '--verbosity', 'NONE'],
			{
				reject: false,
			},
		);
		assert.strictEqual(response.exitCode, 1);
		assert.strictEqual(response.stdout, '');
		assert.strictEqual(response.stderr, '');
	});

	it('should show callstacks for verbosity=DEBUG', async () => {
		const response = await execa(
			node,
			[linkinator, 'test/fixtures/basic', '--verbosity', 'DEBUG'],
			{
				reject: false,
			},
		);
		assert.strictEqual(response.exitCode, 1);
		assert.match(response.stdout, /reason: getaddrinfo/);
	});

	it('should allow passing a config', async () => {
		const response = await execa(node, [
			linkinator,
			'test/fixtures/basic',
			'--config',
			'test/fixtures/config/skip-array-config.json',
		]);
		assert.strictEqual(response.exitCode, 0);
	});

	it('should fail if a url search is provided without a replacement', async () => {
		const response = await execa(
			node,
			[linkinator, '--url-rewrite-search', 'boop', 'test/fixtures/basic'],
			{
				reject: false,
			},
		);
		assert.strictEqual(response.exitCode, 1);
		assert.match(response.stderr, /flag must be used/);
	});

	it('should fail if a url replacement is provided without a search', async () => {
		const response = await execa(
			node,
			[linkinator, '--url-rewrite-replace', 'beep', 'test/fixtures/basic'],
			{
				reject: false,
			},
		);
		assert.strictEqual(response.exitCode, 1);
		assert.match(response.stderr, /flag must be used/);
	});

	it('should respect url rewrites', async () => {
		const response = await execa(node, [
			linkinator,
			'--url-rewrite-search',
			'NOTLICENSE.md',
			'--url-rewrite-replace',
			'LICENSE.md',
			'test/fixtures/rewrite/README.md',
		]);
		assert.match(response.stderr, /Successfully scanned/);
	});

	it('should warn on retries', async () => {
		// Start a web server to return the 429
		let requestCount = 0;
		let firstRequestTime: number;
		const port = 3333;
		const delayMillis = 1000;
		server = http.createServer((_, response) => {
			if (requestCount === 0) {
				response.writeHead(429, {
					'retry-after': '1',
				});
				requestCount++;
				firstRequestTime = Date.now();
			} else {
				assert.ok(Date.now() >= firstRequestTime + delayMillis);
				response.writeHead(200);
			}

			response.end();
		});
		enableDestroy(server);
		await new Promise<void>((r) => {
			server.listen(port, r);
		});

		const response = await execa(node, [
			linkinator,
			'--retry',
			'test/fixtures/retryCLI',
		]);
		assert.strictEqual(response.exitCode, 0);
		assert.match(
			response.stdout,
			new RegExp(`Retrying: http://localhost:${port}/`),
		);
	});
});
