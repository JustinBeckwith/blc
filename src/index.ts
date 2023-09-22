import {EventEmitter} from 'events';
import {URL} from 'url';
import {AddressInfo} from 'net';
import * as http from 'http';
import * as path from 'path';
import {Readable} from 'stream';

import {request, GaxiosResponse} from 'gaxios';

import {Queue} from './queue.js';
import {getLinks} from './links.js';
import {startWebServer} from './server.js';
import {CheckOptions, InternalCheckOptions, processOptions} from './options.js';

export {CheckOptions};
export {getConfig} from './config.js';

export enum LinkState {
  OK = 'OK',
  BROKEN = 'BROKEN',
  SKIPPED = 'SKIPPED',
}

export interface RetryInfo {
  url: string;
  secondsUntilRetry: number;
  status: number;
}

export interface LinkResult {
  url: string;
  status?: number;
  state: LinkState;
  parent?: string;
  failureDetails?: {}[];
}

export interface CrawlResult {
  passed: boolean;
  links: LinkResult[];
}

interface CrawlOptions {
  url: URL;
  parent?: string;
  crawl: boolean;
  results: LinkResult[];
  cache: Set<string>;
  delayCache: Map<string, number>;
  retryErrorsCache: Map<string, number>;
  checkOptions: CheckOptions;
  queue: Queue;
  rootPath: string;
  retry: boolean;
  retryErrors: boolean;
  retryErrorsCount: number;
  retryErrorsJitter: number;
}

// Spoof a normal looking User-Agent to keep the servers happy
export const headers = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.117 Safari/537.36',
};

export declare interface LinkChecker {
  on(event: 'link', listener: (result: LinkResult) => void): this;
  on(event: 'pagestart', listener: (link: string) => void): this;
  on(event: 'retry', listener: (details: RetryInfo) => void): this;
}

/**
 * Instance class used to perform a crawl job.
 */
export class LinkChecker extends EventEmitter {
  /**
   * Crawl a given url or path, and return a list of visited links along with
   * status codes.
   * @param options Options to use while checking for 404s
   */
  async check(opts: CheckOptions) {
    const options = await processOptions(opts);
    if (!Array.isArray(options.path)) {
      options.path = [options.path];
    }
    options.linksToSkip = options.linksToSkip || [];
    let server: http.Server | undefined;
    const hasHttpPaths = options.path.find(x => x.startsWith('http'));
    if (!hasHttpPaths) {
      let port = options.port;
      server = await startWebServer({
        root: options.serverRoot!,
        port,
        markdown: options.markdown,
        directoryListing: options.directoryListing,
      });
      if (port === undefined) {
        const addr = server.address() as AddressInfo;
        port = addr.port;
      }
      for (let i = 0; i < options.path.length; i++) {
        if (options.path[i].startsWith('/')) {
          options.path[i] = options.path[i].slice(1);
        }
        options.path[i] = `http://localhost:${port}/${options.path[i]}`;
      }
      options.staticHttpServerHost = `http://localhost:${port}/`;
    }

    if (process.env.LINKINATOR_DEBUG) {
      console.log(options);
    }

    const queue = new Queue({
      concurrency: options.concurrency || 100,
    });

    const results = new Array<LinkResult>();
    const initCache: Set<string> = new Set();
    const delayCache: Map<string, number> = new Map();
    const retryErrorsCache: Map<string, number> = new Map();

    for (const path of options.path) {
      const url = new URL(path);
      initCache.add(url.href);
      queue.add(async () => {
        await this.crawl({
          url,
          crawl: true,
          checkOptions: options,
          results,
          cache: initCache,
          delayCache,
          retryErrorsCache,
          queue,
          rootPath: path,
          retry: !!opts.retry,
          retryErrors: !!opts.retryErrors,
          retryErrorsCount: opts.retryErrorsCount ?? 5,
          retryErrorsJitter: opts.retryErrorsJitter ?? 3000,
        });
      });
    }
    await queue.onIdle();

    const result = {
      links: results,
      passed: results.filter(x => x.state === LinkState.BROKEN).length === 0,
    };
    if (server) {
      server.destroy();
    }
    return result;
  }

  /**
   * Crawl a given url with the provided options.
   * @pram opts List of options used to do the crawl
   * @private
   * @returns A list of crawl results consisting of urls and status codes
   */
  async crawl(opts: CrawlOptions): Promise<void> {
    // apply any regex url replacements
    if (opts.checkOptions.urlRewriteExpressions) {
      for (const exp of opts.checkOptions.urlRewriteExpressions) {
        const newUrl = opts.url.href.replace(exp.pattern, exp.replacement);
        if (opts.url.href !== newUrl) {
          opts.url.href = newUrl;
        }
      }
    }

    // explicitly skip non-http[s] links before making the request
    const proto = opts.url.protocol;
    if (proto !== 'http:' && proto !== 'https:') {
      const r: LinkResult = {
        url: mapUrl(opts.url.href, opts.checkOptions),
        status: 0,
        state: LinkState.SKIPPED,
        parent: mapUrl(opts.parent, opts.checkOptions),
      };
      opts.results.push(r);
      this.emit('link', r);
      return;
    }

    // Check for a user-configured function to filter out links
    if (
      typeof opts.checkOptions.linksToSkip === 'function' &&
      (await opts.checkOptions.linksToSkip(opts.url.href))
    ) {
      const result: LinkResult = {
        url: mapUrl(opts.url.href, opts.checkOptions),
        state: LinkState.SKIPPED,
        parent: opts.parent,
      };
      opts.results.push(result);
      this.emit('link', result);
      return;
    }

    // Check for a user-configured array of link regular expressions that should be skipped
    if (Array.isArray(opts.checkOptions.linksToSkip)) {
      const skips = opts.checkOptions.linksToSkip
        .map(linkToSkip => {
          return new RegExp(linkToSkip).test(opts.url.href);
        })
        .filter(match => !!match);

      if (skips.length > 0) {
        const result: LinkResult = {
          url: mapUrl(opts.url.href, opts.checkOptions),
          state: LinkState.SKIPPED,
          parent: mapUrl(opts.parent, opts.checkOptions),
        };
        opts.results.push(result);
        this.emit('link', result);
        return;
      }
    }

    // Check if this host has been marked for delay due to 429
    if (opts.delayCache.has(opts.url.host)) {
      const timeout = opts.delayCache.get(opts.url.host)!;
      if (timeout > Date.now()) {
        opts.queue.add(
          async () => {
            await this.crawl(opts);
          },
          {
            delay: timeout - Date.now(),
          }
        );
        return;
      }
    }

    // Perform a HEAD or GET request based on the need to crawl
    let status = 0;
    let state = LinkState.BROKEN;
    let shouldRecurse = false;
    let res: GaxiosResponse<Readable> | undefined = undefined;
    const failures: {}[] = [];
    try {
      res = await request<Readable>({
        method: opts.crawl ? 'GET' : 'HEAD',
        url: opts.url.href,
        headers,
        responseType: 'stream',
        validateStatus: () => true,
        timeout: opts.checkOptions.timeout,
      });
      if (this.shouldRetryAfter(res, opts)) {
        return;
      }

      // If we got an HTTP 405, the server may not like HEAD. GET instead!
      if (res.status === 405) {
        res = await request<Readable>({
          method: 'GET',
          url: opts.url.href,
          headers,
          responseType: 'stream',
          validateStatus: () => true,
          timeout: opts.checkOptions.timeout,
        });
        if (this.shouldRetryAfter(res, opts)) {
          return;
        }
      }
    } catch (err) {
      // request failure: invalid domain name, etc.
      // this also occasionally catches too many redirects, but is still valid (e.g. https://www.ebay.com)
      // for this reason, we also try doing a GET below to see if the link is valid
      failures.push(err as Error);
    }

    try {
      //some sites don't respond to a stream response type correctly, especially with a HEAD. Try a GET with a text response type
      if (
        (res === undefined || res.status < 200 || res.status >= 300) &&
        !opts.crawl
      ) {
        res = await request<Readable>({
          method: 'GET',
          url: opts.url.href,
          responseType: 'stream',
          validateStatus: () => true,
          headers,
          timeout: opts.checkOptions.timeout,
        });
        if (this.shouldRetryAfter(res, opts)) {
          return;
        }
      }
    } catch (ex) {
      failures.push(ex as Error);
      // catch the next failure
    }

    if (res !== undefined) {
      status = res.status;
      shouldRecurse = isHtml(res);
    }

    // If retryErrors is enabled, retry 5xx and 0 status (which indicates
    // a network error likely occurred):
    if (this.shouldRetryOnError(status, opts)) {
      return;
    }

    // Assume any 2xx status is 👌
    if (status >= 200 && status < 300) {
      state = LinkState.OK;
    } else {
      failures.push(res!);
    }

    const result: LinkResult = {
      url: mapUrl(opts.url.href, opts.checkOptions),
      status,
      state,
      parent: mapUrl(opts.parent, opts.checkOptions),
      failureDetails: failures,
    };
    opts.results.push(result);
    this.emit('link', result);

    // If we need to go deeper, scan the next level of depth for links and crawl
    if (opts.crawl && shouldRecurse) {
      this.emit('pagestart', opts.url);
      const urlResults = res?.data
        ? await getLinks(res.data, opts.url.href)
        : [];
      for (const result of urlResults) {
        // if there was some sort of problem parsing the link while
        // creating a new URL obj, treat it as a broken link.
        if (!result.url) {
          const r = {
            url: mapUrl(result.link, opts.checkOptions),
            status: 0,
            state: LinkState.BROKEN,
            parent: mapUrl(opts.url.href, opts.checkOptions),
          };
          opts.results.push(r);
          this.emit('link', r);
          continue;
        }

        let crawl = (opts.checkOptions.recurse! &&
          result.url?.href.startsWith(opts.rootPath)) as boolean;

        // only crawl links that start with the same host
        if (crawl) {
          try {
            const pathUrl = new URL(opts.rootPath);
            crawl = result.url!.host === pathUrl.host;
          } catch {
            // ignore errors
          }
        }

        // Ensure the url hasn't already been touched, largely to avoid a
        // very large queue length and runaway memory consumption
        if (!opts.cache.has(result.url.href)) {
          opts.cache.add(result.url.href);
          opts.queue.add(async () => {
            await this.crawl({
              url: result.url!,
              crawl,
              cache: opts.cache,
              delayCache: opts.delayCache,
              retryErrorsCache: opts.retryErrorsCache,
              results: opts.results,
              checkOptions: opts.checkOptions,
              queue: opts.queue,
              parent: opts.url.href,
              rootPath: opts.rootPath,
              retry: opts.retry,
              retryErrors: opts.retryErrors,
              retryErrorsCount: opts.retryErrorsCount,
              retryErrorsJitter: opts.retryErrorsJitter,
            });
          });
        }
      }
    }
  }
  // The `retry-after` header can come in either <seconds> or
  // A specific date to go check.
  private parseRetryAfter(retryAfterRaw: string): number {
    let retryAfter = Number(retryAfterRaw) * 1000 + Date.now();
    if (!isNaN(retryAfter)) return retryAfter;

    retryAfter = Date.parse(retryAfterRaw);
    if (!isNaN(retryAfter)) return retryAfter;

    // handle invalid response in formats `1m30s` or `30s`
    const matches = retryAfterRaw.match(/^(?:(\d+)m)?(\d+)s$/);
    if (!matches) return NaN;
    return (
      (Number(matches[1] || 0) * 60 + Number(matches[2])) * 1000 + Date.now()
    );
  }
  /**
   * Check the incoming response for a `retry-after` header.  If present,
   * and if the status was an HTTP 429, calculate the date at which this
   * request should be retried. Ensure the delayCache knows that we're
   * going to wait on requests for this entire host.
   * @param res GaxiosResponse returned from the request
   * @param opts CrawlOptions used during this request
   */
  shouldRetryAfter(res: GaxiosResponse, opts: CrawlOptions): boolean {
    if (!opts.retry) {
      return false;
    }

    const retryAfterRaw = res.headers['retry-after'];
    if (res.status !== 429 || !retryAfterRaw) {
      return false;
    }

    const retryAfter = this.parseRetryAfter(retryAfterRaw);
    if (isNaN(retryAfter)) return false;

    // check to see if there is already a request to wait for this host
    if (opts.delayCache.has(opts.url.host)) {
      // use whichever time is higher in the cache
      const currentTimeout = opts.delayCache.get(opts.url.host)!;
      if (retryAfter > currentTimeout) {
        opts.delayCache.set(opts.url.host, retryAfter);
      }
    } else {
      opts.delayCache.set(opts.url.host, retryAfter);
    }
    opts.queue.add(
      async () => {
        await this.crawl(opts);
      },
      {
        delay: retryAfter - Date.now(),
      }
    );
    const retryDetails: RetryInfo = {
      url: opts.url.href,
      status: res.status,
      secondsUntilRetry: Math.round((retryAfter - Date.now()) / 1000),
    };
    this.emit('retry', retryDetails);
    return true;
  }
  /**
   * If the response is a 5xx or synthetic 0 response retry N times.
   * @param status Status returned by request or 0 if request threw.
   * @param opts CrawlOptions used during this request
   */
  shouldRetryOnError(status: number, opts: CrawlOptions): boolean {
    const maxRetries = opts.retryErrorsCount;

    if (!opts.retryErrors) {
      return false;
    }

    // Only retry 0 and >5xx status codes:
    if (status > 0 && status < 500) {
      return false;
    }

    // check to see if there is already a request to wait for this URL:
    let currentRetries = 1;
    if (opts.retryErrorsCache.has(opts.url.href)) {
      // use whichever time is higher in the cache
      currentRetries = opts.retryErrorsCache.get(opts.url.href)!;
      if (currentRetries > maxRetries) return false;
      opts.retryErrorsCache.set(opts.url.href, currentRetries + 1);
    } else {
      opts.retryErrorsCache.set(opts.url.href, 1);
    }
    // Use exponential backoff algorithm to take pressure off upstream service:
    const retryAfter =
      Math.pow(2, currentRetries) * 1000 +
      Math.random() * opts.retryErrorsJitter;

    opts.queue.add(
      async () => {
        await this.crawl(opts);
      },
      {
        delay: retryAfter,
      }
    );
    const retryDetails: RetryInfo = {
      url: opts.url.href,
      status: status,
      secondsUntilRetry: Math.round(retryAfter / 1000),
    };
    this.emit('retry', retryDetails);
    return true;
  }
}

/**
 * Convenience method to perform a scan.
 * @param options CheckOptions to be passed on
 */
export async function check(options: CheckOptions) {
  const checker = new LinkChecker();
  const results = await checker.check(options);
  return results;
}

/**
 * Checks to see if a given source is HTML.
 * @param {object} response Page response.
 * @returns {boolean}
 */
function isHtml(response: GaxiosResponse): boolean {
  const contentType = response.headers['content-type'] || '';
  return (
    !!contentType.match(/text\/html/g) ||
    !!contentType.match(/application\/xhtml\+xml/g)
  );
}

/**
 * When running a local static web server for the user, translate paths from
 * the Url generated back to something closer to a local filesystem path.
 * @example
 *    http://localhost:0000/test/route/README.md => test/route/README.md
 * @param url The url that was checked
 * @param options Original CheckOptions passed into the client
 */
function mapUrl(url?: string, options?: InternalCheckOptions): string {
  if (!url) {
    return url!;
  }
  let newUrl = url;

  // trim the starting http://localhost:0000 if we stood up a local static server
  if (
    options?.staticHttpServerHost?.length &&
    url?.startsWith(options.staticHttpServerHost)
  ) {
    newUrl = url.slice(options.staticHttpServerHost.length);

    // add the full filesystem path back if we trimmed it
    if (options?.syntheticServerRoot?.length) {
      newUrl = path.join(options.syntheticServerRoot, newUrl);
    }
    if (newUrl === '') {
      newUrl = `.${path.sep}`;
    }
  }
  return newUrl!;
}
