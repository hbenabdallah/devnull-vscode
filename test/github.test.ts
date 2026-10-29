import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gitHubPermalink } from '../src/github';

const sha = 'a'.repeat(40);

test('links to the lines on GitHub from an https or ssh remote', () => {
    for (const remote of ['https://github.com/dev-null-sh/dev-null.sh.git', 'git@github.com:dev-null-sh/dev-null.sh.git', 'https://github.com/dev-null-sh/dev-null.sh']) {
        assert.equal(
            gitHubPermalink(remote, sha, 'app/Models/User.php', 4, 9),
            `https://github.com/dev-null-sh/dev-null.sh/blob/${sha}/app/Models/User.php#L4-L9`,
        );
    }
});

test('encodes the path and links one line on its own', () => {
    assert.equal(gitHubPermalink('git@github.com:a/b.git', sha, 'docs/my file.md', 2, 2), `https://github.com/a/b/blob/${sha}/docs/my%20file.md#L2`);
});

test('has no link for other hosts or a missing commit', () => {
    assert.equal(gitHubPermalink('https://gitlab.com/a/b.git', sha, 'f', 1, 1), null);
    assert.equal(gitHubPermalink('https://github.com/a/b.git', 'HEAD', 'f', 1, 1), null);
});
