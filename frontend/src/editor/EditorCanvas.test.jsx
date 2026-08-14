import { describe, expect, it } from 'vitest';
import { prioritizeDropCollisions } from './dropCollision.js';

describe('editor canvas drop targets', () => {
  const state = {
    byId: {
      container: { id: 'container', parentId: null },
      child: { id: 'child', parentId: 'container' },
    },
  };

  it('prefers the inside zone when dropping onto a container', () => {
    const collisions = [{ id: 'container' }, { id: 'inside:container' }];

    expect(prioritizeDropCollisions(collisions, state)[0].id).toBe('inside:container');
  });

  it('keeps child sorting available inside a container', () => {
    const collisions = [{ id: 'inside:container' }, { id: 'child' }];

    expect(prioritizeDropCollisions(collisions, state)[0].id).toBe('child');
  });

  it('prefers the smallest nested drop zone', () => {
    const collisions = [{ id: 'inside:section' }, { id: 'inside:container' }];
    const rects = new Map([
      ['inside:section', { width: 800, height: 600 }],
      ['inside:container', { width: 500, height: 200 }],
    ]);

    expect(prioritizeDropCollisions(collisions, state, rects)[0].id).toBe('inside:container');
  });
});
