import { describe, expect, test } from 'vitest';
import { getMoveByOffsetTarget, moveIdNextToTarget } from './sidenav.models';

describe('sidenav models', () => {
  describe('moveIdNextToTarget', () => {
    const ids = ['a', 'b', 'c', 'd'];

    test.each([
      { id: 'a', targetId: 'c', placement: 'before', expected: ['b', 'a', 'c', 'd'] },
      { id: 'a', targetId: 'c', placement: 'after', expected: ['b', 'c', 'a', 'd'] },
      { id: 'd', targetId: 'a', placement: 'before', expected: ['d', 'a', 'b', 'c'] },
      { id: 'd', targetId: 'b', placement: 'after', expected: ['a', 'b', 'd', 'c'] },
      { id: 'b', targetId: 'b', placement: 'after', expected: ids },
      { id: 'x', targetId: 'b', placement: 'after', expected: ids },
      { id: 'a', targetId: 'x', placement: 'before', expected: ids },
    ] as const)(
      'moving $id $placement $targetId gives $expected',
      ({ id, targetId, placement, expected }) => {
        expect(moveIdNextToTarget({ ids, id, targetId, placement })).toEqual(expected);
      },
    );

    test('the input list is not mutated', () => {
      const input = ['a', 'b'];
      moveIdNextToTarget({ ids: input, id: 'a', targetId: 'b', placement: 'after' });
      expect(input).toEqual(['a', 'b']);
    });
  });

  describe('getMoveByOffsetTarget', () => {
    const ids = ['a', 'b', 'c'];

    test('moving up targets the previous item, moving down the next one', () => {
      expect(getMoveByOffsetTarget({ ids, id: 'b', offset: -1 })).toEqual({
        targetId: 'a',
        placement: 'before',
      });
      expect(getMoveByOffsetTarget({ ids, id: 'b', offset: 1 })).toEqual({
        targetId: 'c',
        placement: 'after',
      });
    });

    test('there is no target past the edges or for unknown ids', () => {
      expect(getMoveByOffsetTarget({ ids, id: 'a', offset: -1 })).toBeUndefined();
      expect(getMoveByOffsetTarget({ ids, id: 'c', offset: 1 })).toBeUndefined();
      expect(getMoveByOffsetTarget({ ids, id: 'x', offset: 1 })).toBeUndefined();
    });
  });
});
