import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
function color(name: string) {
  const hex = css.match(new RegExp('--' + name + ':\\s*#([0-9a-f]{6})'))?.[1];
  if (!hex) throw new Error('Missing color token: ' + name);
  return [0, 2, 4]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
describe('design safeguards', () => {
  it.each(['text', 'muted', 'dim', 'accent', 'danger', 'warning'])(
    '%s text reaches 4.5:1 on every core surface',
    (token) => {
      for (const background of ['bg', 'sidebar', 'panel', 'panel-raised', 'field']) {
        const ratio =
          (Math.max(color(token), color(background)) + 0.05) /
          (Math.min(color(token), color(background)) + 0.05);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
  it('primary button text meets 4.5:1 contrast', () => {
    expect((color('accent') + 0.05) / (color('accent-ink') + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
  it('disables motion when the OS requests reduced motion', () => {
    expect(css).toMatch(
      /prefers-reduced-motion:\s*reduce[\s\S]*animation:\s*none !important;\s*transition:\s*none !important/,
    );
    expect(css).not.toMatch(/animation:[^;]*(?:pulse|ping)/);
  });
  it('defines explicit keyboard focus and responsive shell behavior', () => {
    expect(css).toContain(':focus-visible');
    expect(css).toMatch(/@media\s*\(max-width:\s*820px\)/);
    expect(css).toMatch(/height:\s*100dvh/);
  });
  it('contains screen-reader labels inside horizontally scrolling tables', () => {
    expect(css).toMatch(/\.table-scroll\s*\{\s*position:\s*relative;\s*overflow-x:\s*auto;/);
  });
});
