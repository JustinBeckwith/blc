import assert from 'assert';
import {describe, it} from 'mocha';
import {validateXML} from 'validate-with-xmllint';
import xml2js from 'xml2js';
import {LinkState} from '../src/index.js';
import {createReport} from '../src/junit-report.js';

describe('junit report', () => {
  const parser = new xml2js.Parser();

  it('should work with no reults', async () => {
    const report = createReport({links: [], passed: true});
    await validateXML(report);
    const result = await parser.parseStringPromise(report);
    assert(report !== null);
    assert(result.testsuites !== null);
    assert(result.testsuites.testsuite !== null);
    const testSuite = result.testsuites.testsuite[0];
    assert(testSuite !== null);
    assert(testSuite.id !== null);
    assert(testSuite.name !== null);
    assert.equal(testSuite.$.failures, '0');
    assert.equal(testSuite.$.skipped, '0');
    assert.equal(testSuite.$.tests, '0');
    assert.equal(testSuite.$.errors, '0');
  });

  it('should work with reults', async () => {
    const report = createReport({
      links: [
        {
          state: LinkState.OK,
          url: 'a',
          parent: 'b',
          status: 200,
        },
        {
          state: LinkState.BROKEN,
          url: 'c',
          failureDetails: [{}],
          parent: 'd',
          status: 404,
        },
        {
          state: LinkState.SKIPPED,
          url: 'e',
          parent: 'f',
          status: 0,
        },
      ],
      passed: false,
    });
    await validateXML(report);
    const result = await parser.parseStringPromise(report);
    assert(report !== null);
    assert(result.testsuites !== null);
    assert(result.testsuites.testsuite !== null);
    const testSuite = result.testsuites.testsuite[0];
    assert(testSuite !== null);
    assert(testSuite.id !== null);
    assert(testSuite.name !== null);
    assert.equal(testSuite.$.failures, '0');
    assert.equal(testSuite.$.skipped, '1');
    assert.equal(testSuite.$.tests, '3');
    assert.equal(testSuite.$.errors, '1');
    assert.equal(testSuite.testcase[0].$.classname, 'Linkinator');
    assert.equal(testSuite.testcase[0].$.name, 'Link a on b is ok.');
    assert.equal(testSuite.testcase[0].$.time, '0');
    assert.equal(testSuite.testcase[1].$.classname, 'Linkinator');
    assert.equal(
      testSuite.testcase[1].$.name,
      'Link c on d is not correct (404).'
    );
    assert(testSuite.testcase[1].failure !== null);
    assert(testSuite.testcase[1].failure[0].$.message !== null);
    assert.equal(testSuite.testcase[2].$.classname, 'Linkinator');
    assert.equal(testSuite.testcase[2].$.name, 'Link e on f is skipped.');
    assert(testSuite.testcase[2].skipped !== null);
  });
});
