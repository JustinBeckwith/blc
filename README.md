# 🐿 linkinator

> A super simple site crawler and broken link checker.

[![npm version](https://img.shields.io/npm/v/linkinator)](https://www.npmjs.org/package/linkinator)
[![Build Status](https://img.shields.io/github/workflow/status/JustinBeckwith/linkinator/ci/main)](https://github.com/JustinBeckwith/linkinator/actions?query=branch%3Amain+workflow%3Aci)
[![codecov](https://img.shields.io/codecov/c/github/JustinBeckwith/linkinator/main)](https://app.codecov.io/gh/JustinBeckwith/linkinator)
[![Known Vulnerabilities](https://img.shields.io/snyk/vulnerabilities/github/JustinBeckwith/linkinator)](https://snyk.io/test/github/JustinBeckwith/linkinator)
[![Code Style: Google](https://img.shields.io/badge/code%20style-google-blueviolet)](https://github.com/google/gts)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079)](https://github.com/semantic-release/semantic-release)


Behold my latest inator! The `linkinator` provides an API and CLI for crawling websites and validating links.  It's got a ton of sweet features:

- 🔥 Easily perform scans on remote sites or local files
- 🔥 Scan any element that includes links, not just `<a href>`
- 🔥 Supports redirects, absolute links, relative links, all the things
- 🔥 Configure specific regex patterns to skip
- 🔥 Scan markdown files without transpilation

## Installation

```sh
npm install linkinator
```

Not into the whole node.js or npm thing?  You can also download a standalone binary that bundles node, linkinator, and anything else you need.  See [releases](https://github.com/JustinBeckwith/linkinator/releases).

## Command Usage

You can use this as a library, or as a CLI.  Let's see the CLI!

```text
$ linkinator LOCATIONS [ --arguments ]

  Positional arguments

    LOCATIONS
      Required. Either the URLs or the paths on disk to check for broken links.
      Supports multiple paths, and globs.

  Flags

    --concurrency
          The number of connections to make simultaneously. Defaults to 100.

    --config
        Path to the config file to use. Looks for `linkinator.config.json` by default.

    --directory-listing
        Include an automatic directory index file when linking to a directory.
        Defaults to 'false'.

    --format, -f
        Return the data in CSV, JSON or JUNIT format.

    --help
        Show this command.

    --include, -i
        List of urls in regexy form to include.  The opposite of --skip.

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
```

### Command Examples

You can run a shallow scan of a website for busted links:

```sh
npx linkinator http://jbeckwith.com
```

That was fun.  What about local files?  The linkinator will stand up a static web server for yinz:

```sh
npx linkinator ./docs
```

But that only gets the top level of links.  Lets go deeper and do a full recursive scan!

```sh
npx linkinator ./docs --recurse
```

Aw, snap.  I didn't want that to check *those* links.  Let's skip em:

```sh
npx linkinator ./docs --skip www.googleapis.com
```

The `--skip` parameter will accept any regex! You can do more complex matching, or even tell it to only scan links with a given domain:

```sh
linkinator http://jbeckwith.com --skip '^(?!http://jbeckwith.com)'
```

Maybe you're going to pipe the output to another program.  Use the `--format` option to get JSON, JUnit Report Format or CSV!

```sh
linkinator ./docs --format CSV
```

Let's make sure the `README.md` in our repo doesn't have any busted links:

```sh
linkinator ./README.md --markdown
```

You know what, we better check all of the markdown files!

```sh
linkinator "**/*.md" --markdown
```

### Configuration file

You can pass options directly to the `linkinator` CLI, or you can define a config file.  By default, `linkinator` will look for a `linkinator.config.json` file in the current working directory.

All options are optional. It should look like this:

```json
{
  "concurrency": 100,
  "config": "string",
  "recurse": true,
  "skip": "www.googleapis.com",
  "format": "json",
  "silent": true,
  "verbosity": "error",
  "timeout": 0,
  "markdown": true,
  "serverRoot": "./",
  "directoryListing": true,
  "retry": true,
  "retryErrors": true,
  "retryErrorsCount": 3,
  "retryErrorsJitter": 5,
  "urlRewriteSearch": "/pattern/",
  "urlRewriteReplace": "replacement",
}
```

To load config settings outside the CWD, you can pass the `--config` flag to the `linkinator` CLI:

```sh
linkinator --config /some/path/your-config.json
```

## GitHub Actions

You can use `linkinator` as a GitHub Action as well, using [JustinBeckwith/linkinator-action](https://github.com/JustinBeckwith/linkinator-action):

```yaml
on:
  push:
    branches:
      - main
  pull_request:
name: ci
jobs:
  linkinator:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: JustinBeckwith/linkinator-action@v1
        with:
          paths: README.md
```

To see all options or to learn more, visit [JustinBeckwith/linkinator-action](https://github.com/JustinBeckwith/linkinator-action).

## API Usage

### linkinator.check(options)

Asynchronous method that runs a site wide scan. Options come in the form of an object that includes:

- `path` (string|string[]) - A fully qualified path to the url to be scanned, or the path(s) to the directory on disk that contains files to be scanned. *required*.
- `concurrency` (number) -  The number of connections to make simultaneously. Defaults to 100.
- `port` (number) - When the `path` is provided as a local path on disk, the `port` on which to start the temporary web server.  Defaults to a random high range order port.
- `recurse` (boolean) - By default, all scans are shallow.  Only the top level links on the requested page will be scanned.  By setting `recurse` to `true`, the crawler will follow all links on the page, and continue scanning links **on the same domain** for as long as it can go. Results are cached, so no worries about loops.
- `retry` (boolean|RetryConfig) - Automatically retry requests that respond with an HTTP 429, and include a `retry-after` header.  The `RetryConfig` option is a placeholder for fine-grained controls to be implemented at a later time, and is only included here to signal forward-compatibility.
- `serverRoot` (string) - When scanning a locally directory, customize the location on disk
where the server is started.  Defaults to the path passed in `path`.
- `timeout` (number) - By default, requests made by linkinator do not time out (or follow the settings of the OS).  This option (in milliseconds) will fail requests after the configured amount of time.
- `markdown` (boolean) - Automatically parse and scan markdown if scanning from a location on disk.
- `linksToSkip` (array | function) - An array of regular expression strings that should be skipped, OR an async function that's called for each link with the link URL as its only argument. Return a Promise that resolves to `true` to skip the link or `false` to check it.
- `directoryListing` (boolean) - Automatically serve a static file listing page when serving a directory.  Defaults to `false`.
- `urlRewriteExpressions` (array) - Collection of objects that contain a search pattern, and replacement.

### linkinator.LinkChecker()

Constructor method that can be used to create a new `LinkChecker` instance.  This is particularly useful if you want to receive events as the crawler crawls.  Exposes the following events:

- `pagestart` (string) - Provides the url that the crawler has just started to scan.
- `link` (object) - Provides an object with
  - `url` (string) - The url that was scanned
  - `state` (string) - The result of the scan.  Potential values include `BROKEN`, `OK`, or `SKIPPED`.
  - `status` (number) - The HTTP status code of the request.

### Examples

#### Simple example

```js
const link = require('linkinator');

async function simple() {
  const results = await link.check({
    path: 'http://example.com'
  });

  // To see if all the links passed, you can check `passed`
  console.log(`Passed: ${results.passed}`);

  // Show the list of scanned links and their results
  console.log(results);

  // Example output:
  // {
  //   passed: true,
  //   links: [
  //     {
  //       url: 'http://example.com',
  //       status: 200,
  //       state: 'OK'
  //     },
  //     {
  //       url: 'http://www.iana.org/domains/example',
  //       status: 200,
  //       state: 'OK'
  //     }
  //   ]
  // }
}
simple();
```

#### Complete example

In most cases you're going to want to respond to events, as running the check command can kinda take a long time.

```js
const link = require('linkinator');

async function complex() {
  // create a new `LinkChecker` that we'll use to run the scan.
  const checker = new link.LinkChecker();

  // Respond to the beginning of a new page being scanned
  checker.on('pagestart', url => {
    console.log(`Scanning ${url}`);
  });

  // After a page is scanned, check out the results!
  checker.on('link', result => {

    // check the specific url that was scanned
    console.log(`  ${result.url}`);

    // How did the scan go?  Potential states are `BROKEN`, `OK`, and `SKIPPED`
    console.log(`  ${result.state}`);

    // What was the status code of the response?
    console.log(`  ${result.status}`);

    // What page linked here?
    console.log(`  ${result.parent}`);
  });

  // Go ahead and start the scan! As events occur, we will see them above.
  const result = await checker.check({
    path: 'http://example.com',
    // port: 8673,
    // recurse: true,
    // linksToSkip: [
    //   'https://jbeckwith.com/some/link',
    //   'http://example.com'
    // ]
  });

  // Check to see if the scan passed!
  console.log(result.passed ? 'PASSED :D' : 'FAILED :(');

  // How many links did we scan?
  console.log(`Scanned total of ${result.links.length} links!`);

  // The final result will contain the list of checked links, and the pass/fail
  const brokeLinksCount = result.links.filter(x => x.state === 'BROKEN');
  console.log(`Detected ${brokeLinksCount.length} broken links.`);
}

complex();
```

## Tips & Tricks

### Using a proxy

This library supports proxies via the `HTTP_PROXY` and `HTTPS_PROXY` environment variables.  This [guide](https://www.golinuxcloud.com/set-up-proxy-http-proxy-environment-variable/) provides a nice overview of how to format and set these variables.

### Globbing

You may have noticed in the example, when using a glob the pattern is encapsulated in quotes:

```sh
linkinator "**/*.md" --markdown
```

Without the quotes, some shells will attempt to expand the glob paths on their own.  Various shells (bash, zsh) have different, somewhat unpredictable behaviors when left to their own devices.  Using the quotes ensures consistent, predictable behavior by letting the library expand the pattern.

### Debugging

Oftentimes when a link fails, it's an easy to spot typo, or a clear 404.  Other times ... you may need more details on exactly what went wrong.  To see a full call stack for the HTTP request failure, use `--verbosity DEBUG`:

```sh
linkinator https://jbeckwith.com --verbosity DEBUG
```

### Controlling Output

The `--verbosity` flag offers preset options for controlling the output, but you may want more control.  Using [`jq`](https://stedolan.github.io/jq/) and `--format JSON` - you can do just that!

```sh
linkinator https://jbeckwith.com --verbosity DEBUG --format JSON | jq '.links | .[] | select(.state | contains("BROKEN"))'
```

## License

[MIT](LICENSE.md)
