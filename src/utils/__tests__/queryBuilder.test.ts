import { describe, it, expect } from 'vitest';
import {
  buildQuery,
  buildSort,
  buildSelect,
  escapeSearchTerm,
} from '../queryBuilder.js';

describe('queryBuilder injection guards', () => {
  it('drops raw MongoDB operator objects', () => {
    expect(buildQuery({ email: { $gt: '' } as any })).toEqual({});
    expect(buildQuery({ email: { $where: 'sleep(1)' } as any })).toEqual({});
    expect(buildQuery({ email: { $ne: null } as any })).toEqual({});
  });

  it('blocks prototype pollution paths', () => {
    expect(buildQuery({ __proto__: { a: 1 } as any })).toEqual({});
    expect(buildQuery({ 'a.__proto__': 'x' })).toEqual({});
    expect(buildQuery({ constructor: { prototype: 1 } as any })).toEqual({});
    expect(buildQuery({ $where: 'x' })).toEqual({});
  });

  it('allows only allowlisted operators with primitive operands', () => {
    expect(buildQuery({ age: { gt: 18 } })).toEqual({ age: { $gt: 18 } });
    expect(buildQuery({ age: { gt: { $gt: 1 } } as any })).toEqual({});
    expect(buildQuery({ name: { contains: 'a.c' } })).toEqual({ name: { $regex: /a\.c/i } });
    expect(buildQuery({ name: { regex: '(a+)+$' } })).toEqual({ name: { $regex: /\(a\+\)\+\$/i } });
    expect(buildQuery({ tags: { in: ['a', { $ne: 1 }] } as any })).toEqual({});
  });

  it('sanitizes sort and select', () => {
    expect(buildSort(['-createdAt', '$where', '__proto__', 'a'.repeat(100)] as any)).toEqual({
      createdAt: -1,
    });
    expect(buildSelect(['name', '-password', '$where'])).toBe('name -password');
    expect(buildSelect(['$where'])).toBeUndefined();
  });

  it('escapes search terms', () => {
    expect(escapeSearchTerm('a.c')).toBe('a\\.c');
    expect(escapeSearchTerm('x'.repeat(500))).toHaveLength(200);
    expect(escapeSearchTerm(undefined as any)).toBe('');
  });
});
