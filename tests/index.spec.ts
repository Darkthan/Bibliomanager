import { describe, expect, it } from 'vitest';
import { hello } from '../src/index';

describe('hello()', () => {
  it('greets by name', () => {
    expect(hello('World')).toBe('Hello, World!');
  });
});
