import {EventEmitter} from 'events';
import {URL} from 'url';
import * as http from 'http';
import * as fs from 'fs';
import * as util from 'util';
import * as path from 'path';

import {request, GaxiosResponse} from 'gaxios';
import * as globby from 'glob';

import {Queue} from './queue';
import {getLinks} from './links';
import {startWebServer} from './server';

const stat = util.promisify(fs.stat);
const glob = util.promisify(globby);

export interface CheckOptions {
  concurrency?: number;
  port?: number;
  path: string | string[];
  recurse?: boolean;
  timeout?: number;
  markdown?: boolean;
  linksToSkip?: string[] | ((link: string) => Promise<boolean>);
  serverRoot?: string;
  directoryListing?: boolean;
}

export enum LinkState {
  OK = 'OK',
  BROKEN = 'BROKEN',
  SKIPPED = 'SKIPPED',
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
  checkOptions: CheckOptions;
  queue: Queue;
  rootPath: string;
}

// Spoof a normal looking User-Agent to keep the servers happy
export const headers = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.117 Safari/537.36',
};

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
    const options = await this.processOptions(opts);
    if (!Array.isArray(options.path)) {
      options.path = [options.path];
    }
    options.linksToSkip = options.linksToSkip || [];
    let server: http.Server | undefined;
    const hasHttpPaths = options.path.find(x => x.startsWith('http'));
    if (!hasHttpPaths) {
      const port = options.port || 5000 + Math.round(Math.random() * 1000);
      server = await startWebServer({
        root: options.serverRoot!,
        port,
        markdown: options.markdown,
        directoryListing: options.directoryListing,
      });
      for (let i = 0; i < options.path.length; i++) {
        if (options.path[i].startsWith('/')) {
          options.path[i] = options.path[i].slice(1);
        }
        options.path[i] = `http://localhost:${port}/${options.path[i]}`;
      }
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
          queue,
          rootPath: path,
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
   * Validate the provided flags all work with each other.
   * @param options CheckOptions passed in from the CLI (or API)
   */
  private async processOptions(opts: CheckOptions): Promise<CheckOptions> {
    const options = Object.assign({}, opts);

    // ensure at least one path is provided
    if (options.path.length === 0) {
      throw new Error('At least one path must be provided');
    }

    // normalize options.path to an array of strings
    if (!Array.isArray(options.path)) {
      options.path = [options.path];
    }

    // disable directory listings by default
    if (options.directoryListing === undefined) {
      options.directoryListing = false;
    }

    // Ensure we do not mix http:// and file system paths.  The paths passed in
    // must all be filesystem paths, or HTTP paths.
    let isUrlType: boolean | undefined = undefined;
    for (const path of options.path) {
      const innerIsUrlType = path.startsWith('http');
      if (isUrlType === undefined) {
        isUrlType = innerIsUrlType;
      } else if (innerIsUrlType !== isUrlType) {
        throw new Error(
          'Paths cannot be mixed between HTTP and local filesystem paths.'
        );
      }
    }

    // if there is a server root, make sure there are no HTTP paths
    if (options.serverRoot && isUrlType) {
      throw new Error(
        "'serverRoot' cannot be defined when the 'path' points to an HTTP endpoint."
      );
    }

    if (options.serverRoot) {
      options.serverRoot = path.normalize(options.serverRoot);
    }

    // expand globs into paths
    if (!isUrlType) {
      const paths: string[] = [];
      for (const filePath of options.path) {
        // The glob path provided is relative to the serverRoot. For example,
        // if the serverRoot is test/fixtures/nested, and the glob is "*/*.html",
        // The glob needs to be calculated from the serverRoot directory.
        const fullPath = options.serverRoot
          ? path.join(options.serverRoot, filePath)
          : filePath;
        const expandedPaths = await glob(fullPath);
        if (expandedPaths.length === 0) {
          throw new Error(
            `The provided glob "${filePath}" returned 0 results. The current working directory is "${process.cwd()}".`
          );
        }
        // After resolving the globs, the paths need to be returned to their
        // original form, without the serverRoot included in the path.
        for (let p of expandedPaths) {
          p = path.normalize(p);
          if (options.serverRoot) {
            const contractedPath = p
              .split(path.sep)
              .slice(options.serverRoot.split(path.sep).length)
              .join(path.sep);
            paths.push(contractedPath);
          } else {
            paths.push(p);
          }
        }
      }
      options.path = paths;
    }

    // enable markdown if someone passes a flag/glob right at it
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
      // if the serverRoot wasn't defined, and there are multiple paths, just
      // use process.cwd().
      if (options.path.length > 1) {
        options.serverRoot = process.cwd();
      } else {
        // if there's a single path, try to be smart and figure it out
        const s = await stat(options.path[0]);
        options.serverRoot = options.path[0];
        if (s.isFile()) {
          const pathParts = options.path[0].split(path.sep);
          options.path = [path.sep + pathParts[pathParts.length - 1]];
          options.serverRoot =
            pathParts.slice(0, pathParts.length - 1).join(path.sep) || '.';
        } else {
          options.serverRoot = options.path[0];
          options.path = '/';
        }
      }
    }
    return options;
  }

  /**
   * Crawl a given url with the provided options.
   * @pram opts List of options used to do the crawl
   * @private
   * @returns A list of crawl results consisting of urls and status codes
   */
  async crawl(opts: CrawlOptions): Promise<void> {
    // explicitly skip non-http[s] links before making the request
    const proto = opts.url.protocol;
    if (proto !== 'http:' && proto !== 'https:') {
      const r = {
        url: opts.url.href,
        status: 0,
        state: LinkState.SKIPPED,
        parent: opts.parent,
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
        url: opts.url.href,
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
          url: opts.url.href,
          state: LinkState.SKIPPED,
          parent: opts.parent,
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
      } else {
        opts.delayCache.delete(opts.url.host);
      }
    }

    // Perform a HEAD or GET request based on the need to crawl
    let status = 0;
    let state = LinkState.BROKEN;
    let data = '';
    let shouldRecurse = false;
    let res: GaxiosResponse<string> | undefined = undefined;
    const failures: {}[] = [];
    try {
      res = await request<string>({
        method: opts.crawl ? 'GET' : 'HEAD',
        url: opts.url.href,
        headers,
        responseType: opts.crawl ? 'text' : 'stream',
        validateStatus: () => true,
        timeout: opts.checkOptions.timeout,
      });
      if (this.shouldRetryAfter(res, opts)) {
        return;
      }

      // If we got an HTTP 405, the server may not like HEAD. GET instead!
      if (res.status === 405) {
        res = await request<string>({
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
      failures.push(err);
    }

    try {
      //some sites don't respond to a stream response type correctly, especially with a HEAD. Try a GET with a text response type
      if (
        (res === undefined || res.status < 200 || res.status >= 300) &&
        !opts.crawl
      ) {
        res = await request<string>({
          method: 'GET',
          url: opts.url.href,
          responseType: 'text',
          validateStatus: () => true,
          headers,
          timeout: opts.checkOptions.timeout,
        });
        if (this.shouldRetryAfter(res, opts)) {
          return;
        }
      }
    } catch (ex) {
      failures.push(ex);
      // catch the next failure
    }

    if (res !== undefined) {
      status = res.status;
      data = res.data;
      shouldRecurse = isHtml(res);
    }

    // Assume any 2xx status is 👌
    if (status >= 200 && status < 300) {
      state = LinkState.OK;
    } else {
      failures.push(res!);
    }

    const result: LinkResult = {
      url: opts.url.href,
      status,
      state,
      parent: opts.parent,
      failureDetails: failures,
    };
    opts.results.push(result);
    this.emit('link', result);

    // If we need to go deeper, scan the next level of depth for links and crawl
    if (opts.crawl && shouldRecurse) {
      this.emit('pagestart', opts.url);
      const urlResults = getLinks(data, opts.url.href);
      for (const result of urlResults) {
        // if there was some sort of problem parsing the link while
        // creating a new URL obj, treat it as a broken link.
        if (!result.url) {
          const r = {
            url: result.link,
            status: 0,
            state: LinkState.BROKEN,
            parent: opts.url.href,
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
              results: opts.results,
              checkOptions: opts.checkOptions,
              queue: opts.queue,
              parent: opts.url.href,
              rootPath: opts.rootPath,
            });
          });
        }
      }
    }
  }
  /**
   * Check the incoming response for a `retry-after` header.  If present,
   * and if the status was an HTTP 429, calculate the date at which this
   * request should be retried. Ensure the delayCache knows that we're
   * going to wait on requests for this entire host.
   * @param res GaxiosResponse returned from the request
   * @param opts CrawlOptions used during this request
   */
  shouldRetryAfter(res: GaxiosResponse, opts: CrawlOptions): number {
    if (!res) {
      return 0;
    }

    const retryAfterRaw = res.headers['retry-after'];
    if (res.status !== 429 || !retryAfterRaw) {
      return 0;
    }

    // The `retry-after` header can come in either <seconds> or
    // A specific date to go check.
    let retryAfter = Number(retryAfterRaw) * 1000 + Date.now();
    if (isNaN(retryAfter)) {
      try {
        retryAfter = new Date(retryAfterRaw).getTime();
      } catch (e) {
        return 0;
      }
    }

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

    if (retryAfter) {
      opts.queue.add(
        async () => {
          await this.crawl(opts);
        },
        {
          delay: retryAfter - Date.now(),
        }
      );
    }

    return retryAfter;
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
