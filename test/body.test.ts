import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MaxBodyLength, selectionBody, type Selection } from '../src/body';

const selection: Selection = {
    code: '    public function handle(): void\n    {\n        //\n    }\n',
    languageId: 'php',
    path: 'app/Jobs/Example.php',
    startLine: 10,
    endLine: 13,
    permalink: null,
};

test('puts the selected code in a block titled with its path and lines, under the message', () => {
    assert.equal(
        selectionBody('Look at this', selection),
        'Look at this\n\n```php title="app/Jobs/Example.php#L10-L13"\npublic function handle(): void\n{\n    //\n}\n```',
    );
});

test('leaves the message out when there is none, and adds the GitHub link', () => {
    assert.equal(
        selectionBody('  ', { ...selection, startLine: 3, endLine: 3, code: 'echo 1;', permalink: 'https://github.com/a/b/blob/c/f.php#L3' }),
        '```php title="app/Jobs/Example.php#L3"\necho 1;\n```\n\nhttps://github.com/a/b/blob/c/f.php#L3',
    );
});

test('uses a longer fence than any in the code, and the highlighter names of languages', () => {
    const body = selectionBody('', { ...selection, languageId: 'typescriptreact', code: 'const md = "```";' });

    assert.match(body ?? '', /^````tsx title=".*"\nconst md = "```";\n````$/);
});

test('refuses a selection longer than a commit', () => {
    assert.equal(selectionBody('', { ...selection, code: 'x'.repeat(MaxBodyLength) }), null);
});
