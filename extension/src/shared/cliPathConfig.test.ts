import { describe, expect, it } from 'vitest';
import {
  MARKER_BEGIN,
  MARKER_END,
  buildEnvFishContent,
  buildEnvShContent,
  buildUnixShimContent,
  buildWindowsPathScript,
  buildWindowsShimContent,
  isDirOnPathValue,
  upsertMarkerBlock,
} from './cliPathConfig';

describe('upsertMarkerBlock', () => {
  it('appends the block to an empty file', () => {
    const result = upsertMarkerBlock('', 'export PATH="$HOME/.ontograph-editor/bin:$PATH"');
    expect(result).toBe(
      `${MARKER_BEGIN}\nexport PATH="$HOME/.ontograph-editor/bin:$PATH"\n${MARKER_END}\n`
    );
  });

  it('appends the block after existing content, separated by a blank line', () => {
    const result = upsertMarkerBlock('export FOO=bar\n', 'export PATH=baz');
    expect(result).toBe(`export FOO=bar\n\n${MARKER_BEGIN}\nexport PATH=baz\n${MARKER_END}\n`);
  });

  it('is a no-op when the identical block is already the only content', () => {
    const once = upsertMarkerBlock('', 'export PATH=baz');
    const twice = upsertMarkerBlock(once, 'export PATH=baz');
    expect(twice).toBe(once);
  });

  it('collapses duplicate blocks (e.g. from concurrent writers) into exactly one', () => {
    const withDuplicate = `${MARKER_BEGIN}\nold body\n${MARKER_END}\n${MARKER_BEGIN}\nold body\n${MARKER_END}\n`;
    const result = upsertMarkerBlock(withDuplicate, 'new body');
    const occurrences = result.split(MARKER_BEGIN).length - 1;
    expect(occurrences).toBe(1);
    expect(result).toContain('new body');
    expect(result).not.toContain('old body');
  });

  it('handles a file whose last line has no trailing newline without corrupting it', () => {
    const result = upsertMarkerBlock('export FOO=bar', 'export PATH=baz');
    expect(result.startsWith('export FOO=bar\n\n')).toBe(true);
    expect(result).not.toContain('barexport');
    expect(result).not.toContain(`bar${MARKER_BEGIN}`);
  });

  it('replaces stale block content with the new body on a version bump', () => {
    const withOldBlock = upsertMarkerBlock('', 'source "/old/path/env.sh"');
    const updated = upsertMarkerBlock(withOldBlock, 'source "/new/path/env.sh"');
    expect(updated).toContain('/new/path/env.sh');
    expect(updated).not.toContain('/old/path/env.sh');
  });

  it('leaves an unpaired BEGIN marker in place rather than misdetecting it as a match', () => {
    const malformed = `${MARKER_BEGIN}\nsome stray content\n`;
    const result = upsertMarkerBlock(malformed, 'new body');
    expect(result).toContain('some stray content');
    expect(result).toContain('new body');
  });
});

describe('buildEnvShContent / buildEnvFishContent', () => {
  it('guards against duplicate PATH entries in sh', () => {
    const content = buildEnvShContent('$HOME/.ontograph-editor/bin');
    expect(content).toContain('case ":${PATH}:" in');
    expect(content).toContain('*":$HOME/.ontograph-editor/bin:"*');
    expect(content).toContain('export PATH="$HOME/.ontograph-editor/bin:$PATH"');
  });

  it('guards against duplicate PATH entries in fish', () => {
    const content = buildEnvFishContent('$HOME/.ontograph-editor/bin');
    expect(content).toContain('if not contains $HOME/.ontograph-editor/bin $PATH');
    expect(content).toContain('set -gx PATH $HOME/.ontograph-editor/bin $PATH');
  });
});

describe('buildUnixShimContent', () => {
  it('prefers node on PATH and falls back to the Electron runtime', () => {
    const content = buildUnixShimContent('/ext/dist/cli/dist/index.js', '/Applications/Code.app/exe');
    expect(content).toContain('#!/bin/sh');
    expect(content).toContain("command -v node");
    expect(content).toContain('exec node "$CLI_JS" "$@"');
    expect(content).toContain('ELECTRON_RUN_AS_NODE=1');
    expect(content).toContain("'/Applications/Code.app/exe'");
  });

  it('safely single-quotes paths containing spaces or quotes', () => {
    const content = buildUnixShimContent("/ext dir/dist/index.js", "/Applications/Visual Studio Code.app/exe");
    expect(content).toContain("'/ext dir/dist/index.js'");
    expect(content).toContain("'/Applications/Visual Studio Code.app/exe'");
  });

  it("escapes a literal single quote in a path", () => {
    const content = buildUnixShimContent("/it's/here/index.js", '/exe');
    expect(content).toContain("'/it'\\''s/here/index.js'");
  });
});

describe('buildWindowsShimContent', () => {
  it('checks for node via `where` and falls back to the Electron runtime', () => {
    const content = buildWindowsShimContent('C:\\ext\\dist\\index.js', 'C:\\Code\\Code.exe');
    expect(content).toContain('where node');
    expect(content).toContain('node "%CLI_JS%" %*');
    expect(content).toContain('set "ELECTRON_RUN_AS_NODE=1"');
    expect(content).toContain('"C:\\Code\\Code.exe" "%CLI_JS%" %*');
    expect(content.includes('\r\n')).toBe(true);
  });
});

describe('buildWindowsPathScript', () => {
  it('resolves the bin dir from $env:USERPROFILE rather than any interpolated value', () => {
    const script = buildWindowsPathScript();
    expect(script).toContain('$env:USERPROFILE');
    expect(script).toContain("[Environment]::GetEnvironmentVariable('Path', 'User')");
    expect(script).toContain("[Environment]::SetEnvironmentVariable('Path', $newValue, 'User')");
    // Never call setx — it silently truncates PATH values over ~1024 chars.
    expect(script).not.toContain('setx');
  });
});

describe('isDirOnPathValue', () => {
  it('finds an exact match', () => {
    expect(isDirOnPathValue('/usr/bin:/home/user/.ontograph-editor/bin:/bin', '/home/user/.ontograph-editor/bin', ':')).toBe(true);
  });

  it('is false when the dir is absent', () => {
    expect(isDirOnPathValue('/usr/bin:/bin', '/home/user/.ontograph-editor/bin', ':')).toBe(false);
  });

  it('does not false-positive on a prefix/suffix substring match', () => {
    expect(isDirOnPathValue('/home/user/.ontograph-editor/bin-other:/bin', '/home/user/.ontograph-editor/bin', ':')).toBe(false);
    expect(isDirOnPathValue('/other/home/user/.ontograph-editor/bin:/bin', '/home/user/.ontograph-editor/bin', ':')).toBe(false);
  });

  it('ignores a trailing slash and is case-insensitive (Windows semantics)', () => {
    expect(isDirOnPathValue('C:\\Users\\me\\.ontograph\\bin\\;C:\\Windows', 'c:\\users\\me\\.ontograph\\bin', ';')).toBe(true);
  });

  it('handles an empty PATH value', () => {
    expect(isDirOnPathValue('', '/home/user/.ontograph-editor/bin', ':')).toBe(false);
  });
});
