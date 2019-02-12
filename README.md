# linkinator

[![npm version](https://img.shields.io/npm/v/linkinator.svg)](https://www.npmjs.org/package/linkinator)
[![Build Status](https://api.cirrus-ci.com/github/JustinBeckwith/blc.svg)](https://cirrus-ci.com/github/JustinBeckwith/blc)
[![codecov](https://codecov.io/gh/JustinBeckwith/blc/branch/master/graph/badge.svg)](https://codecov.io/gh/JustinBeckwith/blc)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

> Find broken links, missing images, etc in your HTML.  A fancy fork of https://github.com/stevenvachon/broken-link-checker.

Features:
* Stream-parses local and remote HTML pages
* Concurrently checks multiple links
* Supports various HTML elements/attributes, not just `<a href>`
* Supports redirects, absolute URLs, relative URLs and `<base>`
* Honors robot exclusions
* Provides detailed information about each link (HTTP and HTML)
* URL keyword filtering with wildcards
* Pause/Resume at any time

## Installation

To use as an API:

```sh
npm install linkinator
```

To use as a CLI:

```sh
npx linkinator http://www.google.com -r
```

## Classes

### `blc.HtmlChecker(options, handlers)`
Scans an HTML document to find broken links.

* `handlers.complete` is fired after the last result or zero results.
* `handlers.html` is fired after the HTML document has been fully parsed.
  * `tree` is supplied by [parse5](https://npmjs.com/parse5)
  * `robots` is an instance of [robot-directives](https://npmjs.com/robot-directives) containing any `<meta>` robot exclusions.
* `handlers.junk` is fired with data on each skipped link, as configured in options.
* `handlers.link` is fired with the result of each discovered link (broken or not).

* `.clearCache()` will remove any cached URL responses. This is only relevant if the `cacheResponses` option is enabled.
* `.numActiveLinks()` returns the number of links with active requests.
* `.numQueuedLinks()` returns the number of links that currently have no active requests.
* `.pause()` will pause the internal link queue, but will not pause any active requests.
* `.resume()` will resume the internal link queue.
* `.scan(html, baseUrl)` parses & scans a single HTML document. Returns `false` when there is a previously incomplete scan (and `true` otherwise).
  * `html` can be a stream or a string.
  * `baseUrl` is the address to which all relative URLs will be made absolute. Without a value, links to relative URLs will output an "Invalid URL" error.

```js
var htmlChecker = new blc.HtmlChecker(options, {
	html: function(tree, robots){},
	junk: function(result){},
	link: function(result){},
	complete: function(){}
});

htmlChecker.scan(html, baseUrl);
```

### `blc.HtmlUrlChecker(options, handlers)`
Scans the HTML content at each queued URL to find broken links.

* `handlers.end` is fired when the end of the queue has been reached.
* `handlers.html` is fired after a page's HTML document has been fully parsed.
  * `tree` is supplied by [parse5](https://npmjs.com/parse5).
  * `robots` is an instance of [robot-directives](https://npmjs.com/robot-directives) containing any `<meta>` and `X-Robots-Tag` robot exclusions.
* `handlers.junk` is fired with data on each skipped link, as configured in options.
* `handlers.link` is fired with the result of each discovered link (broken or not) within the current page.
* `handlers.page` is fired after a page's last result, on zero results, or if the HTML could not be retrieved.

* `.clearCache()` will remove any cached URL responses. This is only relevant if the `cacheResponses` option is enabled.
* `.dequeue(id)` removes a page from the queue. Returns `true` on success or an `Error` on failure.
* `.enqueue(pageUrl, customData)` adds a page to the queue. Queue items are auto-dequeued when their requests are complete. Returns a queue ID on success or an `Error` on failure.
  * `customData` is optional data that is stored in the queue item for the page.
* `.numActiveLinks()` returns the number of links with active requests.
* `.numPages()` returns the total number of pages in the queue.
* `.numQueuedLinks()` returns the number of links that currently have no active requests.
* `.pause()` will pause the queue, but will not pause any active requests.
* `.resume()` will resume the queue.

```js
var htmlUrlChecker = new blc.HtmlUrlChecker(options, {
	html: function(tree, robots, response, pageUrl, customData){},
	junk: function(result, customData){},
	link: function(result, customData){},
	page: function(error, pageUrl, customData){},
	end: function(){}
});

htmlUrlChecker.enqueue(pageUrl, customData);
```

### `blc.SiteChecker(options, handlers)`
Recursively scans (crawls) the HTML content at each queued URL to find broken links.

* `handlers.end` is fired when the end of the queue has been reached.
* `handlers.html` is fired after a page's HTML document has been fully parsed.
  * `tree` is supplied by [parse5](https://npmjs.com/parse5).
  * `robots` is an instance of [robot-directives](https://npmjs.com/robot-directives) containing any `<meta>` and `X-Robots-Tag` robot exclusions.
* `handlers.junk` is fired with data on each skipped link, as configured in options.
* `handlers.link` is fired with the result of each discovered link (broken or not) within the current page.
* `handlers.page` is fired after a page's last result, on zero results, or if the HTML could not be retrieved.
* `handlers.robots` is fired after a site's robots.txt has been downloaded and provides an instance of [robots-txt-guard](https://npmjs.com/robots-txt-guard).
* `handlers.site` is fired after a site's last result, on zero results, or if the *initial* HTML could not be retrieved.

* `.clearCache()` will remove any cached URL responses. This is only relevant if the `cacheResponses` option is enabled.
* `.dequeue(id)` removes a site from the queue. Returns `true` on success or an `Error` on failure.
* `.enqueue(siteUrl, customData)` adds [the first page of] a site to the queue. Queue items are auto-dequeued when their requests are complete. Returns a queue ID on success or an `Error` on failure.
  * `customData` is optional data that is stored in the queue item for the site.
* `.numActiveLinks()` returns the number of links with active requests.
* `.numPages()` returns the total number of pages in the queue.
* `.numQueuedLinks()` returns the number of links that currently have no active requests.
* `.numSites()` returns the total number of sites in the queue.
* `.pause()` will pause the queue, but will not pause any active requests.
* `.resume()` will resume the queue.

**Note:** `options.filterLevel` is used for determining which links are recursive.

```js
var siteChecker = new blc.SiteChecker(options, {
	robots: function(robots, customData){},
	html: function(tree, robots, response, pageUrl, customData){},
	junk: function(result, customData){},
	link: function(result, customData){},
	page: function(error, pageUrl, customData){},
	site: function(error, siteUrl, customData){},
	end: function(){}
});

siteChecker.enqueue(siteUrl, customData);
```

### `blc.UrlChecker(options, handlers)`
Requests each queued URL to determine if they are broken.

* `handlers.end` is fired when the end of the queue has been reached.
* `handlers.link` is fired for each result (broken or not).

* `.clearCache()` will remove any cached URL responses. This is only relevant if the `cacheResponses` option is enabled.
* `.dequeue(id)` removes a URL from the queue. Returns `true` on success or an `Error` on failure.
* `.enqueue(url, baseUrl, customData)` adds a URL to the queue. Queue items are auto-dequeued when their requests are completed. Returns a queue ID on success or an `Error` on failure.
  * `baseUrl` is the address to which all relative URLs will be made absolute. Without a value, links to relative URLs will output an "Invalid URL" error.
  * `customData` is optional data that is stored in the queue item for the URL.
* `.numActiveLinks()` returns the number of links with active requests.
* `.numQueuedLinks()` returns the number of links that currently have no active requests.
* `.pause()` will pause the queue, but will not pause any active requests.
* `.resume()` will resume the queue.

```js
var urlChecker = new blc.UrlChecker(options, {
	link: function(result, customData){},
	end: function(){}
});

urlChecker.enqueue(url, baseUrl, customData);
```

## Options

### `options.acceptedSchemes`
Type: `Array`
Default value: `["http","https"]`
Will only check links with schemes/protocols mentioned in this list. Any others (except those in `excludedSchemes`) will output an "Invalid URL" error.

### `options.cacheExpiryTime`
Type: `Number`
Default Value: `3600000` (1 hour)
The number of milliseconds in which a cached response should be considered valid. This is only relevant if the `cacheResponses` option is enabled.

### `options.cacheResponses`
Type: `Boolean`
Default Value: `true`
URL request results will be cached when `true`. This will ensure that each unique URL will only be checked once.

### `options.excludedKeywords`
Type: `Array`
Default value: `[]`
Will not check or output links that match the keywords and glob patterns in this list. The only wildcard supported is `*`.

This option does *not* apply to `UrlChecker`.

### `options.excludedSchemes`
Type: `Array`
Default value: `["data","geo","javascript","mailto","sms","tel"]`
Will not check or output links with schemes/protocols mentioned in this list. This avoids the output of "Invalid URL" errors with links that cannot be checked.

This option does *not* apply to `UrlChecker`.

### `options.excludeExternalLinks`
Type: `Boolean`
Default value: `false`
Will not check or output external links when `true`; relative links with a remote `<base>` included.

This option does *not* apply to `UrlChecker`.

### `options.excludeInternalLinks`
Type: `Boolean`
Default value: `false`
Will not check or output internal links when `true`.

This option does *not* apply to `UrlChecker` nor `SiteChecker`'s *crawler*.

### `options.excludeLinksToSamePage`
Type: `Boolean`
Default value: `true`
Will not check or output links to the same page; relative and absolute fragments/hashes included.

This option does *not* apply to `UrlChecker`.

### `options.filterLevel`
Type: `Number`
Default value: `1`
The tags and attributes that are considered links for checking, split into the following levels:
* `0`: clickable links
* `1`: clickable links, media, iframes, meta refreshes
* `2`: clickable links, media, iframes, meta refreshes, stylesheets, scripts, forms
* `3`: clickable links, media, iframes, meta refreshes, stylesheets, scripts, forms, metadata

Recursive links have a slightly different filter subset. To see the exact breakdown of both, check out the [tag map](https://github.com/stevenvachon/broken-link-checker/blob/master/lib/internal/tags.js). `<base>` is not listed because it is not a link, though it is always parsed.

This option does *not* apply to `UrlChecker`.

### `options.honorRobotExclusions`
Type: `Boolean`
Default value: `true`
Will not scan pages that search engine crawlers would not follow. Such will have been specified with any of the following:
* `<a rel="nofollow" href="…">`
* `<area rel="nofollow" href="…">`
* `<meta name="robots" content="noindex,nofollow,…">`
* `<meta name="googlebot" content="noindex,nofollow,…">`
* `<meta name="robots" content="unavailable_after: …">`
* `X-Robots-Tag: noindex,nofollow,…`
* `X-Robots-Tag: googlebot: noindex,nofollow,…`
* `X-Robots-Tag: otherbot: noindex,nofollow,…`
* `X-Robots-Tag: unavailable_after: …`
* robots.txt

This option does *not* apply to `UrlChecker`.

### `options.maxSockets`
Type: `Number`
Default value: `Infinity`
The maximum number of links to check at any given time.

### `options.maxSocketsPerHost`
Type: `Number`
Default value: `1`
The maximum number of links per host/port to check at any given time. This avoids overloading a single target host with too many concurrent requests. This will not limit concurrent requests to other hosts.

### `options.rateLimit`
Type: `Number`
Default value: `0`
The number of milliseconds to wait before each request.

### `options.requestMethod`
Type: `String`
Default value: `"head"`
The HTTP request method used in checking links. If you experience problems, try using `"get"`, however `options.retry405Head` should have you covered.

### `options.retry405Head`
Type: `Boolean`
Default value: `true`
Some servers do not respond correctly to a `"head"` request method. When `true`, a link resulting in an HTTP 405 "Method Not Allowed" error will be re-requested using a `"get"` method before deciding that it is broken.

### `options.userAgent`
Type: `String`
Default value: `"broken-link-checker/0.7.0 Node.js/5.5.0 (OS X El Capitan; x64)"` (or similar)
The HTTP user-agent to use when checking links as well as retrieving pages and robot exclusions.


## Handling Broken/Excluded Links
A broken link will have a `broken` value of `true` and a reason code defined in `brokenReason`. A link that was not checked (emitted as `"junk"`) will have an `excluded` value of `true` and a reason code defined in `excludedReason`.
```js
if (result.broken) {
	console.log(result.brokenReason);
	//=> HTTP_404
} else if (result.excluded) {
	console.log(result.excludedReason);
	//=> BLC_ROBOTS
}
```

Additionally, more descriptive messages are available for each reason code:
```js
console.log(blc.BLC_ROBOTS);       //=> Robots Exclusion
console.log(blc.ERRNO_ECONNRESET); //=> connection reset by peer (ECONNRESET)
console.log(blc.HTTP_404);         //=> Not Found (404)

// List all
console.log(blc);
```

Putting it all together:
```js
if (result.broken) {
	console.log(blc[result.brokenReason]);
} else if (result.excluded) {
	console.log(blc[result.excludedReason]);
}
```

## HTML and HTTP information
Detailed information for each link result is provided. Check out the [schema](https://github.com/stevenvachon/broken-link-checker/blob/master/lib/internal/linkObj.js#L16-L64) or:
```js
console.log(result);
```
