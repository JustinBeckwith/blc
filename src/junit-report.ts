import {LinkResult, LinkState} from './index.js';

type Result = {
  links: LinkResult[];
  passed: boolean;
};
export function createReport(result: Result): string {
  const id = Math.floor(Date.now() / 1000);
  const failureCount = result.links
    ? result.links.filter(link => link.state === LinkState.BROKEN).length
    : 0;
  const skippedCount = result.links
    ? result.links.filter(link => link.state === LinkState.SKIPPED).length
    : 0;
  const allCount = result.links ? result.links.length : 0;
  let testCases = '';
  result.links.forEach(link => {
    switch (link.state) {
      case LinkState.BROKEN:
        testCases += `<testcase classname="Linkinator" name="Link ${
          link.url
        } on ${link.parent} is not correct (${link.status})." time="0" >
                    <failure message="${
                      link.failureDetails
                        ? JSON.stringify(link.failureDetails)
                        : ''
                    }"></failure>
            </testcase>`;
        break;
      case LinkState.SKIPPED:
        testCases += `<testcase classname="Linkinator" name="Link ${link.url} on ${link.parent} is skipped." time="0" >
                <skipped />
            </testcase>`;
        break;
      default:
        testCases += `<testcase classname="Linkinator" name="Link ${link.url} on ${link.parent} is ok." time="0" />`;
        break;
    }
    testCases += '\n';
  });
  return `<?xml version="1.0" encoding="UTF-8"?> 
<testsuites>
        <testsuite id="${id}" name="Linkinator" failures="0" skipped="${skippedCount}" tests="${allCount}" errors="${failureCount}">
            ${testCases}
    </testsuite>
 </testsuites>`;
}
